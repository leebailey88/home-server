#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import { loadSitesConfig } from './lib/sites-config.mjs';

const repoRoot = process.cwd();
const outputPath =
  process.env.CLOUDFLARED_OUTPUT_FILE || path.join(repoRoot, 'cloudflared', 'generated', 'config.yml');

const { cloudflared, enabledSites, selectedConfigPath } = loadSitesConfig({ repoRoot });
const tunnel = process.env.CLOUDFLARED_TUNNEL_ID || cloudflared.tunnel || 'REPLACE_WITH_TUNNEL_ID';
const credentialsFile =
  process.env.CLOUDFLARED_CREDENTIALS_FILE ||
  cloudflared.credentialsFile ||
  `/etc/cloudflared/${tunnel}.json`;
const service = cloudflared.service || 'http://127.0.0.1:80';

const hostnames = enabledSites
  .filter((site) => site.publishViaTunnel !== false)
  .flatMap((site) => site.hostnames);

const doc = {
  tunnel,
  'credentials-file': credentialsFile,
  ingress: [
    ...hostnames.map((hostname) => ({
      hostname,
      service,
    })),
    {
      service: 'http_status:404',
    },
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, YAML.stringify(doc, { lineWidth: 0 }));

console.log(
  `Rendered Cloudflare Tunnel config for ${hostnames.length} hostname(s) from ${selectedConfigPath} into ${outputPath}`,
);
