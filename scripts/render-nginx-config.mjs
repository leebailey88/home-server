#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { staticRouteHealthLocation } from './lib/static-route-health.mjs';
import { loadSitesConfig } from './lib/sites-config.mjs';

const repoRoot = process.cwd();
const outputDir = process.env.NGINX_OUTPUT_DIR || path.join(repoRoot, 'nginx', 'generated');
const proxyTemplatePath = path.join(repoRoot, 'nginx', 'templates', 'site-proxy.conf.tmpl');
const pathProxyTemplatePath = path.join(
  repoRoot,
  'nginx',
  'templates',
  'site-path-proxy.conf.tmpl',
);
const staticTemplatePath = path.join(repoRoot, 'nginx', 'templates', 'site-static.conf.tmpl');

const { defaults, enabledSites, selectedConfigPath } = loadSitesConfig({ repoRoot });
const proxyTemplate = fs.readFileSync(proxyTemplatePath, 'utf8');
const pathProxyTemplate = fs.readFileSync(pathProxyTemplatePath, 'utf8');
const staticTemplate = fs.readFileSync(staticTemplatePath, 'utf8');

function render(template, values) {
  return template.replaceAll(/{{(\w+)}}/g, (_match, key) => {
    if (!(key in values)) {
      throw new Error(`Missing template value: ${key}`);
    }
    return String(values[key]);
  });
}

function clientIpHeadersForSite(site) {
  if (site.trustCloudflareClientIp === true) {
    return [
      'proxy_set_header X-Real-IP $http_cf_connecting_ip;',
      'proxy_set_header X-Forwarded-For $http_cf_connecting_ip;',
    ].join('\n    ');
  }

  return [
    'proxy_set_header X-Real-IP $remote_addr;',
    'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
  ].join('\n    ');
}

const outputParentDir = path.dirname(outputDir);
const outputBaseName = path.basename(outputDir);

fs.mkdirSync(outputParentDir, { recursive: true });
const stagingDir = fs.mkdtempSync(path.join(outputParentDir, `${outputBaseName}.tmp-`));

if (enabledSites.length === 0) {
  console.warn('No enabled sites found. Generated directory will be empty.');
}

for (const site of enabledSites) {
  const listen = site.nginxListen || defaults.nginxListen || '127.0.0.1:80';
  const accessLogDir = defaults.accessLogDir || '/var/log/nginx';
  const common = {
    listen,
    serverNames: site.hostnames.join(' '),
    accessLog: `${accessLogDir}/${site.key}.access.log`,
    errorLog: `${accessLogDir}/${site.key}.error.log`,
  };

  let rendered;
  if (site.kind === 'proxy' && site.pathProxy) {
    rendered = render(pathProxyTemplate, {
      ...common,
      upstream: site.upstream.replace(/\/$/, ''),
      publicPrefix: site.pathProxy.publicPrefix,
      upstreamPrefix: site.pathProxy.upstreamPrefix,
      clientIpHeaders: clientIpHeadersForSite(site),
    });
  } else if (site.kind === 'proxy') {
    rendered = render(proxyTemplate, {
      ...common,
      upstream: site.upstream,
      clientIpHeaders: clientIpHeadersForSite(site),
    });
  } else if (site.kind === 'static') {
    rendered = render(staticTemplate, {
      ...common,
      root: site.root,
      index: site.index || 'index.html',
      healthLocation: staticRouteHealthLocation(site.key),
    });
  }

  fs.writeFileSync(path.join(stagingDir, `${site.key}.conf`), rendered);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.renameSync(stagingDir, outputDir);

console.log(
  `Rendered ${enabledSites.length} Nginx site config(s) from ${selectedConfigPath} into ${outputDir}`,
);
