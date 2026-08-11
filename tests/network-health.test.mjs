import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateNetworkHealth, parsePingOutput } from '../scripts/lib/network-health.mjs';

const healthyPing = `PING 192.168.1.1 (192.168.1.1) 56(84) bytes of data.
64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=1.27 ms
64 bytes from 192.168.1.1: icmp_seq=2 ttl=64 time=2.10 ms
64 bytes from 192.168.1.1: icmp_seq=3 ttl=64 time=119 ms

--- 192.168.1.1 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 1000ms
rtt min/avg/max/mdev = 1.270/40.790/119.000/55.300 ms
`;

test('parsePingOutput extracts packet, latency, and sample metrics', () => {
  const metrics = parsePingOutput(healthyPing);

  assert.deepEqual(metrics, {
    transmitted: 3,
    received: 3,
    lossPercent: 0,
    minMs: 1.27,
    avgMs: 40.79,
    maxMs: 119,
    samplesMs: [1.27, 2.1, 119],
  });
});

test('one isolated latency spike does not fail an otherwise healthy path', () => {
  const result = evaluateNetworkHealth({
    transmitted: 12,
    received: 12,
    lossPercent: 0,
    avgMs: 12,
    maxMs: 119,
    samplesMs: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 119],
  });

  assert.equal(result.status, 'ok');
});

test('sustained high average gateway latency fails', () => {
  const result = evaluateNetworkHealth({
    transmitted: 12,
    received: 12,
    lossPercent: 0,
    avgMs: 248.35,
    maxMs: 2185.8,
    samplesMs: [2, 3, 172, 281, 960, 1513, 1263, 1313, 1139, 1040, 1218, 1254],
  });

  assert.equal(result.status, 'fail');
  assert.match(result.reasons.join(' '), /average latency/);
});

test('multiple severe latency samples fail even when average is below fail threshold', () => {
  const result = evaluateNetworkHealth({
    transmitted: 12,
    received: 12,
    lossPercent: 0,
    avgMs: 80,
    maxMs: 450,
    samplesMs: [2, 2, 2, 2, 2, 2, 2, 2, 260, 330, 450, 2],
  });

  assert.equal(result.status, 'fail');
  assert.equal(result.failSampleCount, 3);
});

test('moderate repeated latency is warning-only', () => {
  const result = evaluateNetworkHealth({
    transmitted: 12,
    received: 12,
    lossPercent: 0,
    avgMs: 35,
    maxMs: 180,
    samplesMs: [2, 2, 2, 2, 2, 2, 2, 110, 125, 180, 2, 2],
  });

  assert.equal(result.status, 'warn');
});

test('material packet loss fails the network path', () => {
  const result = evaluateNetworkHealth({
    transmitted: 12,
    received: 9,
    lossPercent: 25,
    avgMs: 3,
    maxMs: 8,
    samplesMs: [3, 3, 3, 3, 3, 3, 3, 3, 8],
  });

  assert.equal(result.status, 'fail');
  assert.match(result.reasons.join(' '), /packet loss/);
});

test('missing ping summary fails closed', () => {
  const result = evaluateNetworkHealth(null);

  assert.equal(result.status, 'fail');
});
