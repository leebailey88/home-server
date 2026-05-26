#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import { loadSitesConfig } from './lib/sites-config.mjs';

const repoRoot = process.cwd();
const outputPath =
  process.env.CLOUDFLARED_OUTPUT_FILE ||
  path.join(repoRoot, 'cloudflared', 'generated', 'config.yml');

const { cloudflared, enabledSites, selectedConfigPath } = loadSitesConfig({ repoRoot });
const tunnel = process.env.CLOUDFLARED_TUNNEL_ID || cloudflared.tunnel || 'REPLACE_WITH_TUNNEL_ID';
const credentialsFile =
  process.env.CLOUDFLARED_CREDENTIALS_FILE ||
  cloudflared.credentialsFile ||
  `/etc/cloudflared/${tunnel}.json`;
const service = cloudflared.service || 'http://127.0.0.1:80';
const ssh = cloudflared.ssh || {};
const sshEnabled = ssh.enabled !== false;
const sshHostname = process.env.CLOUDFLARED_SSH_HOSTNAME || ssh.hostname || 'ssh.grizzlybulls.com';
const sshService = process.env.CLOUDFLARED_SSH_SERVICE || ssh.service || 'ssh://localhost:22';

const webHostnames = enabledSites
  .filter((site) => site.publishViaTunnel !== false)
  .flatMap((site) => site.hostnames);

const managedIngress = [
  ...(sshEnabled
    ? [
        {
          hostname: sshHostname,
          service: sshService,
        },
      ]
    : []),
  ...webHostnames.map((hostname) => ({
    hostname,
    service,
  })),
];

const doc = {
  tunnel,
  'credentials-file': credentialsFile,
  ingress: [
    ...managedIngress,
    {
      service: 'http_status:404',
    },
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, YAML.stringify(doc, { lineWidth: 0 }));

console.log(
  `Rendered Cloudflare Tunnel config for ${managedIngress.length} managed hostname(s) from ${selectedConfigPath} into ${outputPath}`,
);
