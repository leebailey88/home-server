#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';

import {
  correlateRetryResults,
  formatResponseDiagnostics,
} from './lib/external-uptime-monitor.mjs';

const configPath = process.env.HOME_SERVER_CONFIG || 'config/sites.yaml';
const stateFile =
  process.env.HOME_SERVER_EXTERNAL_MONITOR_STATE_FILE ||
  '/var/lib/home-server-external-monitor/state.json';
const timeoutMs = Number.parseInt(
  process.env.HOME_SERVER_EXTERNAL_MONITOR_TIMEOUT_MS || '10000',
  10,
);
const retryDelayMs = Number.parseInt(
  process.env.HOME_SERVER_EXTERNAL_MONITOR_RETRY_DELAY_MS || '5000',
  10,
);
const userAgent =
  process.env.HOME_SERVER_EXTERNAL_MONITOR_USER_AGENT ||
  'home-server-external-uptime-monitor/1.0';
const hostname = os.hostname();

function readConfig() {
  const raw = fs.readFileSync(configPath, 'utf8');
  return YAML.parse(raw);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return { status: 'unknown', failingKeys: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function getWebhook(status) {
  if (status === 'ok') {
    return (
      process.env.DISCORD_EXTERNAL_MONITOR_RECOVERY_WEBHOOK_URL ||
      process.env.DISCORD_MONITOR_RECOVERY_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      ''
    );
  }

  return (
    process.env.DISCORD_EXTERNAL_MONITOR_CRITICAL_WEBHOOK_URL ||
    process.env.DISCORD_MONITOR_CRITICAL_WEBHOOK_URL ||
    process.env.DISCORD_EXTERNAL_MONITOR_WARNING_WEBHOOK_URL ||
    process.env.DISCORD_MONITOR_WARNING_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL ||
    ''
  );
}

async function sendDiscord({ status, severity, title, details }) {
  const webhookUrl = getWebhook(status);
  if (!webhookUrl) {
    console.error('No Discord webhook configured; skipping alert.');
    return;
  }

  const emoji = status === 'ok' ? '✅' : severity === 'critical' ? '🚨' : '⚠️';
  const content = [
    `${emoji} **${title}**`,
    `Status: ${status}`,
    `Severity: ${severity}`,
    'Service: external-uptime-monitor',
    `Host: ${hostname}`,
    '',
    details.slice(0, 1800),
  ].join('\n');

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`Discord webhook failed with ${response.status}: ${body}`);
  }
}

function collectPublicChecks(config) {
  const checks = [];
  for (const site of config.sites || []) {
    if (site.enabled === false) continue;
    for (const [index, check] of (site.publicHealthChecks || []).entries()) {
      if (!check || check.enabled === false) continue;
      if (!check.url) continue;
      checks.push({
        key: `${site.key}/public-${index + 1}`,
        siteKey: site.key,
        url: check.url,
        expectedStatus: Number.parseInt(
          String(check.expectedStatus || site.expectedStatus || 200),
          10,
        ),
        expectedBodyContains: check.expectedBodyContains || '',
      });
    }
  }
  return checks;
}

async function checkOne(check) {
  const startedAt = Date.now();
  let response;
  let body = '';
  try {
    response = await fetch(check.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': userAgent },
    });
    body = await response.text();
  } catch (error) {
    return {
      ...check,
      ok: false,
      latencyMs: Date.now() - startedAt,
      reason: `fetch failed: ${error.message}`,
    };
  }

  const responseDiagnostics = formatResponseDiagnostics(response.headers);

  if (response.status !== check.expectedStatus) {
    return {
      ...check,
      ok: false,
      latencyMs: Date.now() - startedAt,
      reason: `expected HTTP ${check.expectedStatus}, got ${response.status}${responseDiagnostics}`,
    };
  }

  if (check.expectedBodyContains && !body.includes(check.expectedBodyContains)) {
    return {
      ...check,
      ok: false,
      latencyMs: Date.now() - startedAt,
      reason: `body did not contain ${JSON.stringify(check.expectedBodyContains)}${responseDiagnostics}`,
    };
  }

  return {
    ...check,
    ok: true,
    latencyMs: Date.now() - startedAt,
    reason: 'ok',
  };
}

function formatResults(results) {
  return results
    .map((result) => {
      const status = result.ok ? '[OK]' : '[FAIL]';
      return `${status} ${result.key}: ${result.url} (${result.latencyMs}ms) ${result.reason}`;
    })
    .join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

const config = readConfig();
const checks = collectPublicChecks(config);

if (checks.length === 0) {
  console.error(`No enabled publicHealthChecks found in ${configPath}.`);
  process.exit(2);
}

console.log(
  `[external-monitor] Checking ${checks.length} public endpoint(s) from ${configPath}`,
);
const initialResults = await Promise.all(checks.map(checkOne));
const initialFailures = initialResults.filter((result) => !result.ok);
console.log(formatResults(initialResults));

let results = initialResults;
let failures = initialFailures;

if (initialFailures.length > 0) {
  console.warn(
    `[external-monitor] ${initialFailures.length} endpoint(s) failed; retrying failed endpoints in ${retryDelayMs}ms`,
  );
  await sleep(retryDelayMs);

  const retryResults = await Promise.all(initialFailures.map(checkOne));
  console.log('[external-monitor] Retry results:');
  console.log(formatResults(retryResults));

  const correlated = correlateRetryResults(initialFailures, retryResults);
  failures = correlated.persistent;

  for (const { initial } of correlated.transient) {
    console.warn(
      `[WARN] transient external failure cleared on retry: ${initial.key}: ${initial.url} ${initial.reason}`,
    );
  }

  const retryByKey = new Map(retryResults.map((result) => [result.key, result]));
  results = initialResults.map((result) => retryByKey.get(result.key) || result);

  if (failures.length === 0) {
    console.warn(
      '[external-monitor] All initial failures cleared on retry; suppressing critical transition.',
    );
  }
}

const details = formatResults(results);
const previous = loadState();
const failingKeys = failures.map((failure) => failure.key).sort();
const currentStatus = failures.length > 0 ? 'firing' : 'ok';

if (failures.length > 0) {
  const previousFailingKeys = new Set(previous.failingKeys || []);
  const hasNewFailure = failingKeys.some((key) => !previousFailingKeys.has(key));
  if (previous.status !== 'firing' || hasNewFailure) {
    await sendDiscord({
      status: 'firing',
      severity: 'critical',
      title: 'External public uptime check failed',
      details,
    });
  }

  saveState({
    status: currentStatus,
    failingKeys,
    lastCheckedAt: new Date().toISOString(),
  });
  process.exit(1);
}

if (previous.status === 'firing') {
  await sendDiscord({
    status: 'ok',
    severity: 'critical',
    title: 'External public uptime recovered',
    details,
  });
}

saveState({
  status: currentStatus,
  failingKeys,
  lastCheckedAt: new Date().toISOString(),
});
