#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { evaluateNetworkHealth, parsePingOutput } from './lib/network-health.mjs';

const stateDir = process.env.HOME_SERVER_STATE_DIR || '/var/lib/home-server';
const metricsStateFile = path.join(stateDir, 'network-health-metrics.json');

function numberSetting(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function run(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}

function defaultRoute() {
  const result = run('ip', ['-4', 'route', 'show', 'default']);
  if (result.status !== 0) return null;

  const line = result.stdout.split(/\r?\n/).find(Boolean) || '';
  const gateway = line.match(/\bvia\s+(\S+)/)?.[1];
  const interfaceName = line.match(/\bdev\s+(\S+)/)?.[1];

  if (!gateway || !interfaceName) return null;
  return { gateway, interfaceName };
}

function valueFromOutput(output, pattern) {
  return output.match(pattern)?.[1] ?? null;
}

function wifiDiagnostics(interfaceName) {
  const linkResult = run('iw', ['dev', interfaceName, 'link']);
  if (linkResult.status !== 0 || /Not connected\./.test(linkResult.stdout)) return null;

  const powerResult = run('iw', ['dev', interfaceName, 'get', 'power_save']);
  const statsResult = run('ethtool', ['-S', interfaceName]);
  const link = linkResult.stdout;
  const stats = statsResult.status === 0 ? statsResult.stdout : '';

  return {
    ssid: valueFromOutput(link, /^\s*SSID:\s*(.+)$/m),
    bssid: valueFromOutput(link, /^Connected to\s+(\S+)/m),
    signalDbm: valueFromOutput(link, /^\s*signal:\s*([-\d.]+)\s*dBm/m),
    rxBitrate: valueFromOutput(link, /^\s*rx bitrate:\s*(.+)$/m),
    txBitrate: valueFromOutput(link, /^\s*tx bitrate:\s*(.+)$/m),
    powerSave: valueFromOutput(powerResult.stdout, /Power save:\s*(\S+)/),
    rxDropped: valueFromOutput(stats, /^\s*rx_dropped:\s*(\d+)/m),
    txRetryFailed: valueFromOutput(stats, /^\s*tx_retry_failed:\s*(\d+)/m),
  };
}

function previousCounters() {
  try {
    return JSON.parse(fs.readFileSync(metricsStateFile, 'utf8'));
  } catch {
    return null;
  }
}

function counterDelta(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }

  const currentNumber = Number(current);
  const previousNumber = Number(previous);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(previousNumber)) return null;
  if (currentNumber < previousNumber) return null;
  return currentNumber - previousNumber;
}

function saveCounters(interfaceName, wifi) {
  if (!wifi) return;

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      metricsStateFile,
      `${JSON.stringify({
        interfaceName,
        capturedAt: new Date().toISOString(),
        rxDropped: wifi.rxDropped === null ? null : Number(wifi.rxDropped),
        txRetryFailed: wifi.txRetryFailed === null ? null : Number(wifi.txRetryFailed),
      })}\n`,
    );
  } catch {
    // A direct non-root health check may not be able to update /var/lib/home-server.
  }
}

function formatNumber(value, suffix = '') {
  return value === null || value === undefined ? 'n/a' : `${value}${suffix}`;
}

function wifiSummary(wifi, previous, interfaceName) {
  if (!wifi) return '';

  const sameInterface = previous?.interfaceName === interfaceName;
  const rxDelta = sameInterface ? counterDelta(wifi.rxDropped, previous?.rxDropped) : null;
  const retryDelta = sameInterface
    ? counterDelta(wifi.txRetryFailed, previous?.txRetryFailed)
    : null;

  return [
    `wifi_ssid=${wifi.ssid || 'n/a'}`,
    `bssid=${wifi.bssid || 'n/a'}`,
    `signal=${formatNumber(wifi.signalDbm, 'dBm')}`,
    `rx_rate=${wifi.rxBitrate || 'n/a'}`,
    `tx_rate=${wifi.txBitrate || 'n/a'}`,
    `power_save=${wifi.powerSave || 'n/a'}`,
    `rx_dropped=${wifi.rxDropped || 'n/a'}`,
    `rx_dropped_delta=${rxDelta ?? 'n/a'}`,
    `tx_retry_failed=${wifi.txRetryFailed || 'n/a'}`,
    `tx_retry_failed_delta=${retryDelta ?? 'n/a'}`,
  ].join(' ');
}

if (process.env.HOME_SERVER_SKIP_NETWORK_HEALTH_CHECKS === 'true') {
  console.log('[SKIP] host network path check disabled by HOME_SERVER_SKIP_NETWORK_HEALTH_CHECKS');
  process.exit(0);
}

const route = defaultRoute();
if (!route) {
  console.error('[FAIL] host network path: no IPv4 default gateway/interface found');
  process.exit(1);
}

const count = numberSetting('HOME_SERVER_NETWORK_PING_COUNT', 12);
const interval = numberSetting('HOME_SERVER_NETWORK_PING_INTERVAL_SECONDS', 0.25);
const replyTimeout = numberSetting('HOME_SERVER_NETWORK_PING_REPLY_TIMEOUT_SECONDS', 1);
const pingResult = run('ping', [
  '-n',
  '-c',
  String(count),
  '-i',
  String(interval),
  '-W',
  String(replyTimeout),
  route.gateway,
]);
const pingOutput = `${pingResult.stdout || ''}\n${pingResult.stderr || ''}`;
const metrics = parsePingOutput(pingOutput);
const evaluation = evaluateNetworkHealth(metrics, {
  warnAvgMs: numberSetting('HOME_SERVER_NETWORK_WARN_AVG_MS', 25),
  failAvgMs: numberSetting('HOME_SERVER_NETWORK_FAIL_AVG_MS', 100),
  warnHighLatencyMs: numberSetting('HOME_SERVER_NETWORK_WARN_SAMPLE_MS', 100),
  warnHighLatencySamples: numberSetting('HOME_SERVER_NETWORK_WARN_SAMPLE_COUNT', 3),
  failHighLatencyMs: numberSetting('HOME_SERVER_NETWORK_FAIL_SAMPLE_MS', 250),
  failHighLatencySamples: numberSetting('HOME_SERVER_NETWORK_FAIL_SAMPLE_COUNT', 3),
  failLossPercent: numberSetting('HOME_SERVER_NETWORK_FAIL_LOSS_PERCENT', 25),
});

const wifi = wifiDiagnostics(route.interfaceName);
const previous = previousCounters();
const wifiText = wifiSummary(wifi, previous, route.interfaceName);

const networkText = metrics
  ? [
      `gateway=${route.gateway}`,
      `interface=${route.interfaceName}`,
      `loss=${metrics.lossPercent}%`,
      `avg=${formatNumber(metrics.avgMs, 'ms')}`,
      `max=${formatNumber(metrics.maxMs, 'ms')}`,
      `samples_over_warn=${evaluation.warnSampleCount}/${metrics.received}`,
      `samples_over_fail=${evaluation.failSampleCount}/${metrics.received}`,
    ].join(' ')
  : `gateway=${route.gateway} interface=${route.interfaceName} ping_summary=unusable`;
const details = wifiText ? `${networkText}; ${wifiText}` : networkText;

if (evaluation.status === 'fail') {
  console.error(`[FAIL] host network path degraded: ${evaluation.reasons.join('; ')}; ${details}`);
  process.exit(1);
}

saveCounters(route.interfaceName, wifi);

if (evaluation.status === 'warn') {
  console.warn(`[WARN] host network path elevated: ${evaluation.reasons.join('; ')}; ${details}`);
  process.exit(0);
}

console.log(`[OK] host network path: ${details}`);
