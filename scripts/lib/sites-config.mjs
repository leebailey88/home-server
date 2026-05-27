import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const DEFAULT_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function assertNoNginxControlChars(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }

  if (/[\n\r;{}]/.test(value)) {
    throw new Error(`${label} contains characters that are not safe in generated Nginx config.`);
  }
}

function assertSafePath(value, label) {
  assertNoNginxControlChars(value, label);

  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
}

function assertSafeKey(key) {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(key)) {
    throw new Error(`Invalid site key "${key}". Use lowercase letters, numbers, and hyphens.`);
  }
}

function assertSafeHostname(hostname, label) {
  assertNoNginxControlChars(hostname, label);

  if (hostname.includes('/') || hostname.includes(':')) {
    throw new Error(`${label} must be a hostname only, not a URL or host:port value.`);
  }

  if (
    !/^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      hostname,
    )
  ) {
    throw new Error(`${label} is not a valid DNS hostname: ${hostname}`);
  }
}

function assertSafeListen(value, label) {
  assertNoNginxControlChars(value, label);

  if (!/^(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}$/.test(value)) {
    throw new Error(
      `${label} must bind to a loopback address like 127.0.0.1:80 or [::1]:80. ` +
        `Received: ${value}`,
    );
  }

  const port = Number(value.split(':').at(-1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} contains an invalid port: ${value}`);
  }
}

function assertSafeUrl(
  value,
  label,
  { requireLoopback = false, allowedProtocols = ['http:', 'https:'] } = {},
) {
  assertNoNginxControlChars(value, label);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL. Received: ${value}`);
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${label} must use one of ${allowedProtocols.join(', ')}. Received: ${value}`);
  }

  if (requireLoopback && !DEFAULT_LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `${label} must point at localhost/127.0.0.1 by default. ` +
        `Set allowNonLoopbackUpstreams: true only for a deliberate non-loopback target. Received: ${value}`,
    );
  }
}

function assertExpectedStatuses(value, label) {
  if (value === undefined) return;
  const values = Array.isArray(value) ? value : [value];

  if (values.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  for (const status of values) {
    if (!Number.isInteger(Number(status)) || Number(status) < 100 || Number(status) > 599) {
      throw new Error(`${label} must contain valid HTTP status codes. Received: ${status}`);
    }
  }
}

function assertExpectedBodyContains(value, label) {
  if (value === undefined) return;
  const values = Array.isArray(value) ? value : [value];

  if (values.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  for (const expectedText of values) {
    assertNoNginxControlChars(String(expectedText), label);
  }
}

function assertPublicHealthChecks(value, label) {
  if (value === undefined) return;

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of URLs or health check objects.`);
  }

  for (const [index, check] of value.entries()) {
    const checkLabel = `${label}[${index}]`;

    if (typeof check === 'string') {
      assertSafeUrl(check, checkLabel, { requireLoopback: false });
      continue;
    }

    if (!check || typeof check !== 'object') {
      throw new Error(`${checkLabel} must be a URL string or object.`);
    }

    assertSafeUrl(check.url, `${checkLabel}.url`, { requireLoopback: false });
    assertExpectedStatuses(check.expectedStatus ?? check.expectedStatuses, `${checkLabel}.expectedStatus`);
    assertExpectedBodyContains(
      check.expectedBodyContains ?? check.expectedBodyIncludes,
      `${checkLabel}.expectedBodyContains`,
    );
  }
}

export function resolveConfigPath({
  repoRoot = process.cwd(),
  configPath = process.env.HOME_SERVER_CONFIG,
  fallback = true,
} = {}) {
  const primaryPath = configPath || path.join(repoRoot, 'config', 'sites.yaml');
  const fallbackPath = path.join(repoRoot, 'config', 'sites.example.yaml');

  if (fs.existsSync(primaryPath)) return primaryPath;
  if (fallback && fs.existsSync(fallbackPath)) return fallbackPath;

  throw new Error(`Site config not found: ${primaryPath}`);
}

export function loadSitesConfig(options = {}) {
  const selectedConfigPath = resolveConfigPath(options);
  const rawConfig = fs.readFileSync(selectedConfigPath, 'utf8');
  const config = YAML.parse(rawConfig);

  if (!config || typeof config !== 'object') {
    throw new Error(`Site config must be a YAML object: ${selectedConfigPath}`);
  }

  validateSitesConfig(config);

  return {
    config,
    selectedConfigPath,
    defaults: config.defaults || {},
    cloudflared: config.cloudflared || {},
    sites: Array.isArray(config.sites) ? config.sites : [],
    enabledSites: Array.isArray(config.sites)
      ? config.sites.filter((site) => site.enabled !== false)
      : [],
  };
}

export function validateSitesConfig(config) {
  const defaults = config.defaults || {};
  const cloudflared = config.cloudflared || {};
  const sites = Array.isArray(config.sites) ? config.sites : null;

  if (!sites) {
    throw new Error('Site config must define a sites array.');
  }

  if (defaults.nginxListen) {
    assertSafeListen(defaults.nginxListen, 'defaults.nginxListen');
  }

  if (defaults.accessLogDir) {
    assertSafePath(defaults.accessLogDir, 'defaults.accessLogDir');
  }

  if (defaults.staticRootBase) {
    assertSafePath(defaults.staticRootBase, 'defaults.staticRootBase');
  }

  if (cloudflared.service) {
    assertSafeUrl(cloudflared.service, 'cloudflared.service', { requireLoopback: true });
  }

  if (cloudflared.credentialsFile) {
    assertSafePath(cloudflared.credentialsFile, 'cloudflared.credentialsFile');
  }

  if (cloudflared.ssh?.enabled !== false) {
    const sshHostname = cloudflared.ssh?.hostname || 'ssh.grizzlybulls.com';
    const sshService = cloudflared.ssh?.service || 'ssh://localhost:22';
    assertSafeHostname(sshHostname, 'cloudflared.ssh.hostname');
    assertSafeUrl(sshService, 'cloudflared.ssh.service', {
      requireLoopback: true,
      allowedProtocols: ['ssh:'],
    });
  }

  const enabledKeys = new Set();
  const enabledHostnames = new Map();

  for (const [index, site] of sites.entries()) {
    if (!site || typeof site !== 'object') {
      throw new Error(`sites[${index}] must be an object.`);
    }

    assertSafeKey(site.key);

    if (site.enabled === false) continue;

    if (enabledKeys.has(site.key)) {
      throw new Error(`Duplicate enabled site key: ${site.key}`);
    }
    enabledKeys.add(site.key);

    if (!['proxy', 'static'].includes(site.kind)) {
      throw new Error(`Site ${site.key} has unsupported kind: ${site.kind}`);
    }

    if (site.nginxListen) {
      assertSafeListen(site.nginxListen, `${site.key}.nginxListen`);
    }

    if (!Array.isArray(site.hostnames) || site.hostnames.length === 0) {
      throw new Error(`Site ${site.key} must define at least one hostname.`);
    }

    for (const hostname of site.hostnames) {
      assertSafeHostname(hostname, `${site.key}.hostnames[]`);
      const normalizedHostname = hostname.toLowerCase();

      if (enabledHostnames.has(normalizedHostname)) {
        throw new Error(
          `Hostname ${hostname} is assigned to both ${enabledHostnames.get(normalizedHostname)} and ${site.key}.`,
        );
      }

      enabledHostnames.set(normalizedHostname, site.key);
    }

    if (site.kind === 'proxy') {
      if (!site.upstream) {
        throw new Error(`Proxy site ${site.key} must define upstream.`);
      }

      assertSafeUrl(site.upstream, `${site.key}.upstream`, {
        requireLoopback: site.allowNonLoopbackUpstreams !== true,
      });
    }

    if (site.kind === 'static') {
      if (!site.root) {
        throw new Error(`Static site ${site.key} must define root.`);
      }

      assertSafePath(site.root, `${site.key}.root`);

      if (site.deployRoot) {
        assertSafePath(site.deployRoot, `${site.key}.deployRoot`);
      }

      if (site.index) {
        assertNoNginxControlChars(site.index, `${site.key}.index`);
        if (site.index.includes('/')) {
          throw new Error(`${site.key}.index must be a file name, not a path.`);
        }
      }
    }

    if (site.healthUrl) {
      assertSafeUrl(site.healthUrl, `${site.key}.healthUrl`, {
        requireLoopback: site.allowNonLoopbackUpstreams !== true,
      });
    }

    assertExpectedStatuses(site.expectedStatus ?? site.expectedStatuses, `${site.key}.expectedStatus`);
    assertExpectedBodyContains(site.expectedBodyContains, `${site.key}.expectedBodyContains`);
    assertExpectedBodyContains(site.healthBodyContains, `${site.key}.healthBodyContains`);
    assertPublicHealthChecks(site.publicHealthChecks ?? site.publicUrls, `${site.key}.publicHealthChecks`);
  }
}

export function findSiteOrThrow(sites, key) {
  const site = sites.find((candidate) => candidate.key === key);

  if (!site) {
    throw new Error(`No site found with key: ${key}`);
  }

  return site;
}

export function staticDeployRootForSite(site, defaults = {}) {
  if (site.kind !== 'static') {
    throw new Error(`Site ${site.key} is not a static site.`);
  }

  if (site.deployRoot) return site.deployRoot;

  const staticRootBase = defaults.staticRootBase || '/opt/nuc-web/sites';
  return path.join(staticRootBase, site.key);
}

export function nginxListenToUrl(listen) {
  const normalized = listen.startsWith('localhost:')
    ? listen.replace('localhost:', '127.0.0.1:')
    : listen;
  return `http://${normalized}`;
}
