#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findSiteOrThrow, loadSitesConfig, staticDeployRootForSite } from './lib/sites-config.mjs';

function usage() {
  console.error('Usage: node scripts/deploy-static-site.mjs <site-key> <source-dir> [--keep=N]');
  console.error('Example: node scripts/deploy-static-site.mjs example-static ./dist --keep=5');
}

function fail(message) {
  console.error(`[home-server][error] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function parseKeep(args) {
  const keepArg = args.find((arg) => arg.startsWith('--keep='));
  if (!keepArg) return 5;

  const value = Number(keepArg.split('=')[1]);
  if (!Number.isInteger(value) || value < 1) {
    fail('--keep must be a positive integer.');
  }

  return value;
}

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const [siteKey, sourceDirInput] = positional;

if (!siteKey || !sourceDirInput) {
  usage();
  process.exit(1);
}

const keep = parseKeep(process.argv.slice(2));
const sourceDir = path.resolve(sourceDirInput);

if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
  fail(`Source directory does not exist or is not a directory: ${sourceDir}`);
}

const { defaults, sites } = loadSitesConfig();
const site = findSiteOrThrow(sites, siteKey);

if (site.enabled === false) {
  fail(`Site ${siteKey} is disabled in the site registry.`);
}

if (site.kind !== 'static') {
  fail(`Site ${siteKey} is not a static site.`);
}

const indexFile = site.index || 'index.html';
if (!fs.existsSync(path.join(sourceDir, indexFile))) {
  fail(`Source directory must contain ${indexFile}: ${sourceDir}`);
}

const deployRoot = staticDeployRootForSite(site, defaults);
const releasesDir = path.join(deployRoot, 'releases');
const currentLink = path.join(deployRoot, 'current');
const timestamp = new Date()
  .toISOString()
  .replaceAll(/[-:.TZ]/g, '')
  .slice(0, 14);
const releaseName = `${timestamp}-${process.env.USER || 'deploy'}`;
const releaseDir = path.join(releasesDir, releaseName);

fs.mkdirSync(releaseDir, { recursive: true });

console.log(`[home-server] Deploying ${siteKey} from ${sourceDir} to ${releaseDir}`);
run('rsync', ['-a', `${sourceDir}/`, `${releaseDir}/`]);

const metadata = {
  siteKey,
  releaseName,
  deployedAt: new Date().toISOString(),
  sourceDir,
  hostnames: site.hostnames,
};
fs.writeFileSync(
  path.join(releaseDir, '.home-server-release.json'),
  `${JSON.stringify(metadata, null, 2)}\n`,
);

const tmpLink = path.join(deployRoot, '.current.tmp');
fs.rmSync(tmpLink, { force: true });
fs.symlinkSync(releaseDir, tmpLink);
fs.renameSync(tmpLink, currentLink);

const releases = fs
  .readdirSync(releasesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .reverse();

for (const oldRelease of releases.slice(keep)) {
  const oldReleasePath = path.join(releasesDir, oldRelease);
  console.log(`[home-server] Pruning old release ${oldReleasePath}`);
  fs.rmSync(oldReleasePath, { recursive: true, force: true });
}

console.log(`[home-server] ${siteKey} now points to ${releaseDir}`);
console.log(`[home-server] Nginx root should be ${currentLink}`);
