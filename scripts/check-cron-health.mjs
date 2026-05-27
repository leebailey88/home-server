#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadSitesConfig } from './lib/sites-config.mjs';

const { config, enabledSites, selectedConfigPath } = loadSitesConfig();
const now = Date.now();
const defaultMaxAgeMinutes = Number(process.env.HOME_SERVER_CRON_MAX_AGE_MINUTES || 1500);
const logTailBytes = Number(process.env.HOME_SERVER_CRON_LOG_TAIL_BYTES || 65536);
const skipCronChecks = process.env.HOME_SERVER_SKIP_CRON_CHECKS === 'true';

const defaultErrorPatterns = [
  '\\bERROR\\b',
  '\\bError:',
  '\\bFAILED\\b',
  '\\bFailed\\b',
  '\\bfailed\\b',
  '\\bException\\b',
  '\\bTraceback\\b',
  '\\bUnhandledPromiseRejection\\b',
  '\\bERR_[A-Z0-9_]+\\b',
];

let failures = 0;

function configuredCronJobs() {
  const topLevelJobs = Array.isArray(config.cronJobs)
    ? config.cronJobs.map((job) => ({ ...job, owner: 'host' }))
    : [];

  const siteJobs = enabledSites.flatMap((site) => {
    if (!Array.isArray(site.cronJobs)) return [];
    return site.cronJobs.map((job) => ({ ...job, owner: site.key }));
  });

  return [...topLevelJobs, ...siteJobs].filter((job) => job.enabled !== false);
}

function regexesFor(patterns) {
  return patterns.map((pattern) => new RegExp(pattern, 'im'));
}

function readTail(filePath, bytes) {
  const stat = fs.statSync(filePath);
  const length = Math.min(Math.max(Number(bytes) || 65536, 1024), stat.size);
  const fd = fs.openSync(filePath, 'r');

  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, stat.size - length);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function ageMinutesForMtime(filePath) {
  const stat = fs.statSync(filePath);
  return Math.floor((now - stat.mtimeMs) / 60000);
}

function fail(label, message) {
  failures += 1;
  console.error(`[FAIL] ${label}: ${message}`);
}

function ok(label, message) {
  console.log(`[OK] ${label}: ${message}`);
}

function warn(label, message) {
  console.warn(`[WARN] ${label}: ${message}`);
}

function checkCronDaemon() {
  if (process.env.HOME_SERVER_SKIP_CRON_DAEMON_CHECK === 'true') {
    console.log('[SKIP] cron daemon check disabled by HOME_SERVER_SKIP_CRON_DAEMON_CHECK=true');
    return;
  }

  const candidates = ['cron.service', 'crond.service'];

  for (const unit of candidates) {
    try {
      const result = process.binding('spawn_sync').spawn({
        file: '/usr/bin/systemctl',
        args: ['systemctl', 'is-active', '--quiet', unit],
        stdio: [
          { type: 'ignore' },
          { type: 'pipe' },
          { type: 'pipe' },
        ],
      });

      if (result.status === 0) {
        ok('cron daemon', `${unit} is active`);
        return;
      }
    } catch {
      // Try the next option / fallback below.
    }
  }

  fail('cron daemon', 'neither cron.service nor crond.service is active');
}

function checkJob(job) {
  const label = `${job.owner}/${job.key || job.name}`;
  const maxAgeMinutes = Number(job.maxAgeMinutes ?? defaultMaxAgeMinutes);
  const logPath = job.logPath;

  if (!logPath) {
    warn(label, 'no logPath configured; skipping log freshness/error checks');
    return;
  }

  if (!fs.existsSync(logPath)) {
    fail(label, `log file does not exist: ${logPath}`);
    return;
  }

  const stat = fs.statSync(logPath);
  if (!stat.isFile()) {
    fail(label, `logPath is not a regular file: ${logPath}`);
    return;
  }

  const ageMinutes = ageMinutesForMtime(logPath);
  if (Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 && ageMinutes > maxAgeMinutes) {
    fail(label, `${logPath} has not been updated for ${ageMinutes} minute(s); maxAgeMinutes=${maxAgeMinutes}`);
  } else {
    ok(label, `${logPath} updated ${ageMinutes} minute(s) ago`);
  }

  const tail = readTail(logPath, job.logTailBytes ?? logTailBytes);
  const errorPatterns = job.errorPatterns === false ? [] : regexesFor(job.errorPatterns || defaultErrorPatterns);
  const ignorePatterns = regexesFor(job.ignorePatterns || []);
  const relevantLines = tail
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !ignorePatterns.some((pattern) => pattern.test(line)));

  const matchingLine = relevantLines.find((line) => errorPatterns.some((pattern) => pattern.test(line)));
  if (matchingLine) {
    fail(label, `recent log output matched an error pattern: ${matchingLine.slice(0, 500)}`);
  }

  const successPatterns = regexesFor(job.successPatterns || []);
  if (successPatterns.length > 0 && !successPatterns.some((pattern) => pattern.test(tail))) {
    fail(label, `recent log output did not match any configured successPatterns`);
  }
}

if (skipCronChecks) {
  console.log('[SKIP] cron checks disabled by HOME_SERVER_SKIP_CRON_CHECKS=true');
  process.exit(0);
}

const jobs = configuredCronJobs();
console.log(`Checking ${jobs.length} configured cron job(s) from ${selectedConfigPath}`);

checkCronDaemon();

if (jobs.length === 0) {
  console.log('[OK] no cron jobs configured for monitoring');
}

for (const job of jobs) {
  checkJob(job);
}

if (failures > 0) {
  process.exit(1);
}
