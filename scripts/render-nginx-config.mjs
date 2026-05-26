#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

const repoRoot = process.cwd();
const configPath = process.env.HOME_SERVER_CONFIG || path.join(repoRoot, 'config', 'sites.yaml');
const fallbackConfigPath = path.join(repoRoot, 'config', 'sites.example.yaml');
const outputDir = process.env.NGINX_OUTPUT_DIR || path.join(repoRoot, 'nginx', 'generated');
const proxyTemplatePath = path.join(repoRoot, 'nginx', 'templates', 'site-proxy.conf.tmpl');
const staticTemplatePath = path.join(repoRoot, 'nginx', 'templates', 'site-static.conf.tmpl');

const selectedConfigPath = fs.existsSync(configPath) ? configPath : fallbackConfigPath;
const rawConfig = fs.readFileSync(selectedConfigPath, 'utf8');
const config = YAML.parse(rawConfig);

const proxyTemplate = fs.readFileSync(proxyTemplatePath, 'utf8');
const staticTemplate = fs.readFileSync(staticTemplatePath, 'utf8');

const defaults = config.defaults || {};
const sites = Array.isArray(config.sites) ? config.sites : [];

function render(template, values) {
  return template.replaceAll(/{{(\w+)}}/g, (_match, key) => {
    if (!(key in values)) {
      throw new Error(`Missing template value: ${key}`);
    }
    return String(values[key]);
  });
}

function assertSafeKey(key) {
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(key)) {
    throw new Error(`Invalid site key "${key}". Use lowercase letters, numbers, and hyphens.`);
  }
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const enabledSites = sites.filter((site) => site.enabled !== false);

if (enabledSites.length === 0) {
  console.warn('No enabled sites found. Generated directory will be empty.');
}

for (const site of enabledSites) {
  assertSafeKey(site.key);

  if (!Array.isArray(site.hostnames) || site.hostnames.length === 0) {
    throw new Error(`Site ${site.key} must define at least one hostname.`);
  }

  const listen = site.nginxListen || defaults.nginxListen || '127.0.0.1:80';
  const accessLogDir = defaults.accessLogDir || '/var/log/nginx';
  const common = {
    listen,
    serverNames: site.hostnames.join(' '),
    accessLog: `${accessLogDir}/${site.key}.access.log`,
    errorLog: `${accessLogDir}/${site.key}.error.log`,
  };

  let rendered;
  if (site.kind === 'proxy') {
    if (!site.upstream) {
      throw new Error(`Proxy site ${site.key} must define upstream.`);
    }
    rendered = render(proxyTemplate, { ...common, upstream: site.upstream });
  } else if (site.kind === 'static') {
    if (!site.root) {
      throw new Error(`Static site ${site.key} must define root.`);
    }
    rendered = render(staticTemplate, {
      ...common,
      root: site.root,
      index: site.index || 'index.html',
    });
  } else {
    throw new Error(`Site ${site.key} has unsupported kind: ${site.kind}`);
  }

  fs.writeFileSync(path.join(outputDir, `${site.key}.conf`), rendered);
}

console.log(
  `Rendered ${enabledSites.length} Nginx site config(s) from ${selectedConfigPath} into ${outputDir}`,
);
