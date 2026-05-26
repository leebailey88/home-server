#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadSitesConfig } from './lib/sites-config.mjs';

const repoRoot = process.cwd();
const outputDir = process.env.NGINX_OUTPUT_DIR || path.join(repoRoot, 'nginx', 'generated');
const proxyTemplatePath = path.join(repoRoot, 'nginx', 'templates', 'site-proxy.conf.tmpl');
const staticTemplatePath = path.join(repoRoot, 'nginx', 'templates', 'site-static.conf.tmpl');

const { defaults, enabledSites, selectedConfigPath } = loadSitesConfig({ repoRoot });
const proxyTemplate = fs.readFileSync(proxyTemplatePath, 'utf8');
const staticTemplate = fs.readFileSync(staticTemplatePath, 'utf8');

function render(template, values) {
  return template.replaceAll(/{{(\w+)}}/g, (_match, key) => {
    if (!(key in values)) {
      throw new Error(`Missing template value: ${key}`);
    }
    return String(values[key]);
  });
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

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
  if (site.kind === 'proxy') {
    rendered = render(proxyTemplate, { ...common, upstream: site.upstream });
  } else if (site.kind === 'static') {
    rendered = render(staticTemplate, {
      ...common,
      root: site.root,
      index: site.index || 'index.html',
    });
  }

  fs.writeFileSync(path.join(outputDir, `${site.key}.conf`), rendered);
}

console.log(
  `Rendered ${enabledSites.length} Nginx site config(s) from ${selectedConfigPath} into ${outputDir}`,
);
