#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

function fail(message) {
  console.error(`[home-server][error] ${message}`);
  process.exit(1);
}

const existingPath = process.env.CLOUDFLARED_EXISTING_CONFIG_FILE || process.argv[2];
const managedPath = process.env.CLOUDFLARED_MANAGED_CONFIG_FILE || process.argv[3];
const outputPath = process.env.CLOUDFLARED_MERGED_CONFIG_FILE || process.argv[4];

if (!managedPath || !outputPath) {
  fail('Usage: node scripts/merge-cloudflared-config.mjs <existing-config|-> <managed-config> <output-config>');
}

function readYamlIfExists(filePath) {
  if (!filePath || filePath === '-' || !fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(raw) || {};
}

const existingConfig = readYamlIfExists(existingPath);
const managedConfig = readYamlIfExists(managedPath);

if (!Array.isArray(managedConfig.ingress)) {
  fail(`Managed Cloudflare Tunnel config must define an ingress array: ${managedPath}`);
}

const managedIngress = managedConfig.ingress;
const managedHostnames = new Set(
  managedIngress
    .filter((entry) => entry && typeof entry === 'object' && entry.hostname)
    .map((entry) => String(entry.hostname).toLowerCase()),
);

if (!managedHostnames.has('ssh.grizzlybulls.com')) {
  fail('Refusing to install Cloudflare Tunnel config without managed ssh.grizzlybulls.com ingress.');
}

const existingIngress = Array.isArray(existingConfig.ingress) ? existingConfig.ingress : [];
const preservedIngress = existingIngress.filter((entry) => {
  if (!entry || typeof entry !== 'object') return false;
  if (!entry.hostname) return false;
  return !managedHostnames.has(String(entry.hostname).toLowerCase());
});

const fallbackIngress = managedIngress.find((entry) => entry && entry.service && !entry.hostname) || {
  service: 'http_status:404',
};

const mergedConfig = {
  ...existingConfig,
  ...managedConfig,
  ingress: [
    ...managedIngress.filter((entry) => entry && entry.hostname),
    ...preservedIngress,
    fallbackIngress,
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, YAML.stringify(mergedConfig, { lineWidth: 0 }));

console.log(
  `[home-server] Merged ${managedHostnames.size} managed ingress hostname(s) and preserved ${preservedIngress.length} existing ingress entr${preservedIngress.length === 1 ? 'y' : 'ies'} into ${outputPath}`,
);
