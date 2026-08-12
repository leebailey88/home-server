import assert from 'node:assert/strict';
import test from 'node:test';

import {
  counterDelta,
  evaluateWifiRecoveryEvidence,
  observationIsRecent,
  parseWifiBitrateMbps,
  recoveryCooldownRemainingSeconds,
} from '../scripts/lib/wifi-recovery.mjs';

test('parseWifiBitrateMbps parses iw bitrate text', () => {
  assert.equal(parseWifiBitrateMbps('6.5 MBit/s VHT-MCS 0 VHT-NSS 1'), 6.5);
  assert.equal(parseWifiBitrateMbps('433.3 MBit/s VHT-MCS 9 80MHz short GI'), 433.3);
  assert.equal(parseWifiBitrateMbps('unknown'), null);
});

test('counterDelta ignores resets and invalid counters', () => {
  assert.equal(counterDelta(200, 150), 50);
  assert.equal(counterDelta(10, 150), null);
  assert.equal(counterDelta(null, 150), null);
});

test('degraded gateway plus collapsed receive rate is eligible for recovery', () => {
  const result = evaluateWifiRecoveryEvidence({
    networkStatus: 'warn',
    rxBitrateMbps: 6.5,
    rxDroppedDelta: 25,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.lowRxBitrate, true);
});

test('large driver drop delta can qualify a degraded gateway even with a high current rate', () => {
  const result = evaluateWifiRecoveryEvidence({
    networkStatus: 'warn',
    rxBitrateMbps: 390,
    rxDroppedDelta: 65_000,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.driverDrops, true);
});

test('low idle receive rate alone never triggers recovery on a healthy gateway', () => {
  const result = evaluateWifiRecoveryEvidence({
    networkStatus: 'ok',
    rxBitrateMbps: 6.5,
    rxDroppedDelta: 65_000,
  });

  assert.equal(result.eligible, false);
});

test('gateway degradation without receive-side evidence never triggers recovery', () => {
  const result = evaluateWifiRecoveryEvidence({
    networkStatus: 'fail',
    rxBitrateMbps: 433.3,
    rxDroppedDelta: 100,
  });

  assert.equal(result.eligible, false);
});

test('only recent observations can count as consecutive evidence', () => {
  const now = Date.parse('2026-08-12T14:00:00Z');

  assert.equal(observationIsRecent('2026-08-12T13:56:00Z', now, 300), true);
  assert.equal(observationIsRecent('2026-08-12T13:54:59Z', now, 300), false);
  assert.equal(observationIsRecent(null, now, 300), false);
});

test('recovery cooldown reports remaining seconds', () => {
  const now = Date.parse('2026-08-12T14:00:00Z');
  assert.equal(
    recoveryCooldownRemainingSeconds('2026-08-12T13:45:00Z', now, 1800),
    900,
  );
  assert.equal(
    recoveryCooldownRemainingSeconds('2026-08-12T13:00:00Z', now, 1800),
    0,
  );
});
