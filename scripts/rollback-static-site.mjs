#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { findSiteOrThrow, loadSitesConfig, staticDeployRootForSite } from './lib/sites-config.mjs';

function fail(message) {
  console.error(`[home-server][error] ${message}`);
  process.exit(1);
}

const [siteKey, releaseName] = process.argv.slice(2);
if (!siteKey || !releaseName) {
  fail('Usage: node scripts/rollback-static-site.mjs <site-key> <release-name>');
}

if (releaseName.includes('/') || releaseName.includes('..')) {
  fail('Release name must be a directory name from the releases list.');
}

const { defaults, sites } = loadSitesConfig();
const site = findSiteOrThrow(sites, siteKey);

if (site.kind !== 'static') {
  fail(`Site ${siteKey} is not a static site.`);
}

const deployRoot = staticDeployRootForSite(site, defaults);
const releaseDir = path.join(deployRoot, 'releases', releaseName);
const currentLink = path.join(deployRoot, 'current');

if (!fs.existsSync(releaseDir) || !fs.statSync(releaseDir).isDirectory()) {
  fail(`Release does not exist: ${releaseDir}`);
}

const indexFile = site.index || 'index.html';
if (!fs.existsSync(path.join(releaseDir, indexFile))) {
  fail(`Release is missing ${indexFile}: ${releaseDir}`);
}

const tmpLink = path.join(deployRoot, '.current.tmp');
fs.rmSync(tmpLink, { force: true });
fs.symlinkSync(releaseDir, tmpLink);
fs.renameSync(tmpLink, currentLink);

console.log(`[home-server] Rolled ${siteKey} back to ${releaseName}`);
console.log(`[home-server] ${currentLink} -> ${releaseDir}`);
