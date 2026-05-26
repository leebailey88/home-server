#!/usr/bin/env node
import process from 'node:process';
import { loadSitesConfig, nginxListenToUrl } from './lib/sites-config.mjs';

const { defaults, enabledSites, selectedConfigPath } = loadSitesConfig();

let failures = 0;

async function checkUrl(label, url, init = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(Number(process.env.HEALTH_TIMEOUT_MS || 5000)),
    });

    if (!response.ok) {
      failures += 1;
      console.error(`[FAIL] ${label}: ${url} returned ${response.status}`);
      return;
    }

    console.log(`[OK] ${label}: ${url}`);
  } catch (error) {
    failures += 1;
    console.error(`[FAIL] ${label}: ${url} (${error.message})`);
  }
}

console.log(`Checking ${enabledSites.length} enabled site(s) from ${selectedConfigPath}`);

for (const site of enabledSites) {
  if (site.healthUrl) {
    await checkUrl(`${site.key} upstream health`, site.healthUrl);
  }

  const listen = site.nginxListen || defaults.nginxListen || '127.0.0.1:80';
  const nginxUrl = nginxListenToUrl(listen);
  const firstHostname = site.hostnames[0];

  await checkUrl(`${site.key} nginx route`, nginxUrl, {
    headers: {
      Host: firstHostname,
    },
  });
}

if (failures > 0) {
  process.exit(1);
}
