#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { evaluateNetworkHealth, parsePingOutput } from './lib/network-health.mjs';
import {
  counterDelta,
  evaluateWifiRecoveryEvidence,
  observationIsRecent,
  parseWifiBitrateMbps,
  recoveryCooldownRemainingSeconds,
} from './lib/wifi-recovery.mjs';

const stateDir = process.env.HOME_SERVER_STATE_DIR || '/var/lib/home-server';
const stateFile = path.join(stateDir, 'wifi-self-heal.json');

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

function activeWifi(interfaceName) {
  const linkResult = run('iw', ['dev', interfaceName, 'link']);
  if (linkResult.status !== 0 || /Not connected\./.test(linkResult.stdout)) return null;

  const connectionResult = run('nmcli', [
    '-g',
    'GENERAL.CONNECTION',
    'device',
    'show',
    interfaceName,
  ]);
  const statsResult = run('ethtool', ['-S', interfaceName]);
  const link = linkResult.stdout;
  const rxBitrateText = valueFromOutput(link, /^\s*rx bitrate:\s*(.+)$/m);

  return {
    connectionName: connectionResult.status === 0 ? connectionResult.stdout.trim() : '',
    signalDbm: valueFromOutput(link, /^\s*signal:\s*([-\d.]+)\s*dBm/m),
    rxBitrateText,
    rxBitrateMbps: parseWifiBitrateMbps(rxBitrateText),
    txBitrateText: valueFromOutput(link, /^\s*tx bitrate:\s*(.+)$/m),
    rxDropped:
      statsResult.status === 0
        ? valueFromOutput(statsResult.stdout, /^\s*rx_dropped:\s*(\d+)/m)
        : null,
  };
}

function gatewayHealth(gateway) {
  const count = numberSetting('HOME_SERVER_NETWORK_PING_COUNT', 12);
  const interval = numberSetting('HOME_SERVER_NETWORK_PING_INTERVAL_SECONDS', 0.25);
  const replyTimeout = numberSetting('HOME_SERVER_NETWORK_PING_REPLY_TIMEOUT_SECONDS', 1);
  const result = run('ping', [
    '-n',
    '-c',
    String(count),
    '-i',
    String(interval),
    '-W',
    String(replyTimeout),
    gateway,
  ]);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const metrics = parsePingOutput(output);
  const evaluation = evaluateNetworkHealth(metrics, {
    warnAvgMs: numberSetting('HOME_SERVER_NETWORK_WARN_AVG_MS', 25),
    failAvgMs: numberSetting('HOME_SERVER_NETWORK_FAIL_AVG_MS', 100),
    warnHighLatencyMs: numberSetting('HOME_SERVER_NETWORK_WARN_SAMPLE_MS', 100),
    warnHighLatencySamples: numberSetting('HOME_SERVER_NETWORK_WARN_SAMPLE_COUNT', 3),
    failHighLatencyMs: numberSetting('HOME_SERVER_NETWORK_FAIL_SAMPLE_MS', 250),
    failHighLatencySamples: numberSetting('HOME_SERVER_NETWORK_FAIL_SAMPLE_COUNT', 3),
    failLossPercent: numberSetting('HOME_SERVER_NETWORK_FAIL_LOSS_PERCENT', 25),
  });
  return { metrics, evaluation };
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const tempFile = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tempFile, stateFile);
}

function metric(value, suffix = '') {
  return value === null || value === undefined ? 'n/a' : `${value}${suffix}`;
}

function snapshotText(route, wifi, gateway) {
  return [
    `gateway=${route.gateway}`,
    `interface=${route.interfaceName}`,
    `status=${gateway.evaluation.status}`,
    `loss=${metric(gateway.metrics?.lossPercent, '%')}`,
    `avg=${metric(gateway.metrics?.avgMs, 'ms')}`,
    `max=${metric(gateway.metrics?.maxMs, 'ms')}`,
    `connection=${wifi.connectionName || 'n/a'}`,
    `signal=${metric(wifi.signalDbm, 'dBm')}`,
    `rx_rate=${wifi.rxBitrateText || 'n/a'}`,
    `tx_rate=${wifi.txBitrateText || 'n/a'}`,
    `rx_dropped=${metric(wifi.rxDropped)}`,
  ].join(' ');
}

function currentSnapshot() {
  const route = defaultRoute();
  if (!route) return { route: null, wifi: null, gateway: null };
  const wifi = activeWifi(route.interfaceName);
  if (!wifi) return { route, wifi: null, gateway: null };
  return { route, wifi, gateway: gatewayHealth(route.gateway) };
}

if (process.env.HOME_SERVER_WIFI_RECOVERY_ENABLED === 'false') {
  console.log('[SKIP] Wi-Fi self-healing disabled by HOME_SERVER_WIFI_RECOVERY_ENABLED=false');
  process.exit(0);
}

const previous = loadState();
const nowMs = Date.now();
const snapshot = currentSnapshot();
if (!snapshot.route) {
  saveState({
    interfaceName: null,
    rxDropped: null,
    consecutiveBad: 0,
    lastRecoveryAt: previous.lastRecoveryAt ?? null,
    checkedAt: new Date(nowMs).toISOString(),
  });
  console.warn('[WARN] Wi-Fi self-healing skipped: no IPv4 default route found');
  process.exit(0);
}
if (!snapshot.wifi) {
  saveState({
    interfaceName: snapshot.route.interfaceName,
    rxDropped: null,
    consecutiveBad: 0,
    lastRecoveryAt: previous.lastRecoveryAt ?? null,
    checkedAt: new Date(nowMs).toISOString(),
  });
  console.log(
    `[SKIP] Wi-Fi self-healing inactive: default route interface ${snapshot.route.interfaceName} is not an associated Wi-Fi interface`,
  );
  process.exit(0);
}

const sameInterface = previous.interfaceName === snapshot.route.interfaceName;
const maxEvidenceGapSeconds = Math.max(
  1,
  numberSetting('HOME_SERVER_WIFI_RECOVERY_MAX_EVIDENCE_GAP_SECONDS', 300),
);
const previousRecent = observationIsRecent(previous.checkedAt, nowMs, maxEvidenceGapSeconds);
const comparablePrevious = sameInterface && previousRecent;
const rxDroppedDelta = comparablePrevious
  ? counterDelta(snapshot.wifi.rxDropped, previous.rxDropped)
  : null;
const evidence = evaluateWifiRecoveryEvidence(
  {
    networkStatus: snapshot.gateway.evaluation.status,
    rxBitrateMbps: snapshot.wifi.rxBitrateMbps,
    rxDroppedDelta,
  },
  {
    maxRxBitrateMbps: numberSetting('HOME_SERVER_WIFI_RECOVERY_MAX_RX_MBPS', 12),
    minRxDroppedDelta: numberSetting('HOME_SERVER_WIFI_RECOVERY_MIN_RX_DROPPED_DELTA', 5000),
  },
);
const requiredConsecutive = Math.max(
  1,
  Math.floor(numberSetting('HOME_SERVER_WIFI_RECOVERY_CONSECUTIVE_BAD', 2)),
);
const cooldownSeconds = Math.max(
  0,
  numberSetting('HOME_SERVER_WIFI_RECOVERY_COOLDOWN_SECONDS', 1800),
);
if (!evidence.eligible) {
  saveState({
    interfaceName: snapshot.route.interfaceName,
    rxDropped: snapshot.wifi.rxDropped === null ? null : Number(snapshot.wifi.rxDropped),
    consecutiveBad: 0,
    lastRecoveryAt: previous.lastRecoveryAt ?? null,
    checkedAt: new Date(nowMs).toISOString(),
  });
  console.log(
    `[OK] Wi-Fi self-healing check: ${snapshotText(snapshot.route, snapshot.wifi, snapshot.gateway)}`,
  );
  process.exit(0);
}

const consecutiveBad = comparablePrevious ? Number(previous.consecutiveBad || 0) + 1 : 1;
const evidenceText = evidence.reasons.join('; ');
const baseState = {
  interfaceName: snapshot.route.interfaceName,
  rxDropped: snapshot.wifi.rxDropped === null ? null : Number(snapshot.wifi.rxDropped),
  consecutiveBad,
  lastRecoveryAt: previous.lastRecoveryAt ?? null,
  checkedAt: new Date(nowMs).toISOString(),
};

if (consecutiveBad < requiredConsecutive) {
  saveState(baseState);
  console.warn(
    `[WARN] Wi-Fi receive degradation observed ${consecutiveBad}/${requiredConsecutive}; waiting for confirmation before recovery: ${evidenceText}; ${snapshotText(snapshot.route, snapshot.wifi, snapshot.gateway)}`,
  );
  process.exit(0);
}

const cooldownRemaining = recoveryCooldownRemainingSeconds(
  previous.lastRecoveryAt,
  nowMs,
  cooldownSeconds,
);
if (cooldownRemaining > 0) {
  saveState({ ...baseState, consecutiveBad: requiredConsecutive });
  console.warn(
    `[WARN] Wi-Fi remains degraded, but automatic recovery is rate-limited for another ${cooldownRemaining}s: ${evidenceText}; ${snapshotText(snapshot.route, snapshot.wifi, snapshot.gateway)}`,
  );
  process.exit(0);
}

if (!snapshot.wifi.connectionName || snapshot.wifi.connectionName === '--') {
  saveState(baseState);
  console.error(
    `[FAIL] Wi-Fi recovery required but NetworkManager did not report an active connection for ${snapshot.route.interfaceName}`,
  );
  process.exit(1);
}

const recoveryAt = new Date(nowMs).toISOString();
saveState({ ...baseState, consecutiveBad: 0, lastRecoveryAt: recoveryAt });
console.warn(
  `[RECOVERY] Reactivating NetworkManager connection ${snapshot.wifi.connectionName} on ${snapshot.route.interfaceName}: ${evidenceText}; ${snapshotText(snapshot.route, snapshot.wifi, snapshot.gateway)}`,
);

const activation = run('nmcli', [
  '--wait',
  '20',
  'connection',
  'up',
  snapshot.wifi.connectionName,
  'ifname',
  snapshot.route.interfaceName,
]);
if (activation.status !== 0) {
  const errorText = (activation.stderr || activation.stdout || 'unknown nmcli error').trim();
  console.error(`[FAIL] NetworkManager Wi-Fi recovery failed: ${errorText}`);
  process.exit(1);
}

const postWaitSeconds = Math.max(
  0,
  numberSetting('HOME_SERVER_WIFI_RECOVERY_POST_WAIT_SECONDS', 5),
);
if (postWaitSeconds > 0) run('sleep', [String(postWaitSeconds)]);

const recovered = currentSnapshot();
if (!recovered.route || !recovered.wifi || !recovered.gateway) {
  console.warn('[WARN] Wi-Fi profile was reactivated, but post-recovery diagnostics are unavailable');
  process.exit(0);
}

saveState({
  interfaceName: recovered.route.interfaceName,
  rxDropped: recovered.wifi.rxDropped === null ? null : Number(recovered.wifi.rxDropped),
  consecutiveBad: 0,
  lastRecoveryAt: recoveryAt,
  checkedAt: new Date().toISOString(),
});

if (recovered.gateway.evaluation.status === 'ok') {
  console.log(
    `[RECOVERED] Wi-Fi path healthy after NetworkManager profile reactivation: ${snapshotText(recovered.route, recovered.wifi, recovered.gateway)}`,
  );
} else {
  console.warn(
    `[WARN] Wi-Fi profile reactivated, but the gateway path is still ${recovered.gateway.evaluation.status}: ${snapshotText(recovered.route, recovered.wifi, recovered.gateway)}`,
  );
}
