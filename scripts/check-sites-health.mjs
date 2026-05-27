#!/usr/bin/env node
import process from 'node:process';
import { loadSitesConfig, nginxListenToUrl } from './lib/sites-config.mjs';

const { defaults, enabledSites, selectedConfigPath } = loadSitesConfig();
const timeoutMs = Number(process.env.HEALTH_TIMEOUT_MS || 5000);
const skipPublicChecks = process.env.HOME_SERVER_SKIP_PUBLIC_HEALTH_CHECKS === 'true';

let failures = 0;

function expectedStatusesFor(check) {
  const configured = check.expectedStatus ?? check.expectedStatuses;
  if (Array.isArray(configured)) return configured.map(Number);
  if (configured) return [Number(configured)];
  return [];
}

function expectedBodyValues(check) {
  const configured = check.expectedBodyContains ?? check.expectedBodyIncludes;
  if (!configured) return [];
  return Array.isArray(configured) ? configured : [configured];
}

function normalizeCheck(input, fallback = {}) {
  if (typeof input === 'string') return { ...fallback, url: input };
  return { ...fallback, ...input };
}

async function checkUrl(label, rawCheck, init = {}) {
  const check = normalizeCheck(rawCheck);
  const expectedStatuses = expectedStatusesFor(check);
  const expectedBodyContains = expectedBodyValues(check);

  try {
    const response = await fetch(check.url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const statusOk =
      expectedStatuses.length > 0 ? expectedStatuses.includes(response.status) : response.ok;

    if (!statusOk) {
      failures += 1;
      const expected = expectedStatuses.length > 0 ? expectedStatuses.join(', ') : 'any 2xx status';
      console.error(
        `[FAIL] ${label}: ${check.url} returned ${response.status}; expected ${expected}`,
      );
      return;
    }

    if (expectedBodyContains.length > 0) {
      const body = await response.text();
      const missing = expectedBodyContains.filter((expectedText) => !body.includes(expectedText));

      if (missing.length > 0) {
        failures += 1;
        console.error(
          `[FAIL] ${label}: ${check.url} response body did not contain expected text: ${missing.join(', ')}`,
        );
        return;
      }
    }

    console.log(`[OK] ${label}: ${check.url} returned ${response.status}`);
  } catch (error) {
    failures += 1;
    console.error(`[FAIL] ${label}: ${check.url} (${error.message})`);
  }
}

function publicHealthChecksForSite(site) {
  const publicChecks = site.publicHealthChecks ?? site.publicUrls ?? [];
  return publicChecks.map((check) =>
    normalizeCheck(check, {
      expectedStatus: site.expectedStatus,
      expectedBodyContains: site.expectedBodyContains,
    }),
  );
}

console.log(`Checking ${enabledSites.length} enabled site(s) from ${selectedConfigPath}`);

for (const site of enabledSites) {
  const siteExpectations = {
    expectedStatus: site.expectedStatus,
    expectedBodyContains: site.expectedBodyContains,
  };

  if (site.healthUrl) {
    await checkUrl(`${site.key} upstream health`, {
      ...siteExpectations,
      url: site.healthUrl,
      expectedBodyContains: site.healthBodyContains ?? site.expectedBodyContains,
    });
  }

  const listen = site.nginxListen || defaults.nginxListen || '127.0.0.1:80';
  const nginxUrl = nginxListenToUrl(listen);
  const firstHostname = site.hostnames[0];

  await checkUrl(
    `${site.key} local nginx route`,
    {
      ...siteExpectations,
      url: nginxUrl,
    },
    {
      headers: {
        Host: firstHostname,
      },
    },
  );

  const publicChecks = publicHealthChecksForSite(site);
  if (publicChecks.length > 0) {
    if (skipPublicChecks) {
      console.log(
        `[SKIP] ${site.key} public health checks disabled by HOME_SERVER_SKIP_PUBLIC_HEALTH_CHECKS=true`,
      );
    } else {
      for (const [index, check] of publicChecks.entries()) {
        await checkUrl(`${site.key} public route ${index + 1}`, check);
      }
    }
  }
}

if (failures > 0) {
  process.exit(1);
}
