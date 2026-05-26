#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { findSiteOrThrow, loadSitesConfig, staticDeployRootForSite } from './lib/sites-config.mjs';

function fail(message) {
  console.error(`[home-server][error] ${message}`);
  process.exit(1);
}

const siteKey = process.argv[2];
if (!siteKey) {
  fail('Usage: node scripts/list-static-releases.mjs <site-key>');
}

const { defaults, sites } = loadSitesConfig();
const site = findSiteOrThrow(sites, siteKey);

if (site.kind !== 'static') {
  fail(`Site ${siteKey} is not a static site.`);
}

const deployRoot = staticDeployRootForSite(site, defaults);
const releasesDir = path.join(deployRoot, 'releases');
const currentLink = path.join(deployRoot, 'current');
const currentTarget = fs.existsSync(currentLink) ? fs.realpathSync(currentLink) : null;

if (!fs.existsSync(releasesDir)) {
  console.log(`[home-server] No releases found for ${siteKey} at ${releasesDir}`);
  process.exit(0);
}

const releases = fs
  .readdirSync(releasesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const releasePath = path.join(releasesDir, entry.name);
    const metadataPath = path.join(releasePath, '.home-server-release.json');
    let metadata = {};

    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      } catch {
        metadata = {};
      }
    }

    return {
      name: entry.name,
      path: releasePath,
      current: currentTarget === releasePath,
      deployedAt: metadata.deployedAt || '',
      sourceDir: metadata.sourceDir || '',
    };
  })
  .sort((a, b) => b.name.localeCompare(a.name));

console.log(`Releases for ${siteKey}:`);
for (const release of releases) {
  const marker = release.current ? '*' : ' ';
  const deployedAt = release.deployedAt ? ` deployedAt=${release.deployedAt}` : '';
  const sourceDir = release.sourceDir ? ` source=${release.sourceDir}` : '';
  console.log(`${marker} ${release.name}${deployedAt}${sourceDir}`);
}
