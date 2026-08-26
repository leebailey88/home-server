import assert from 'node:assert/strict';
import test from 'node:test';

import {
  correlateRetryResults,
  formatResponseDiagnostics,
} from '../scripts/lib/external-uptime-monitor.mjs';

test('external monitor only keeps endpoint failures that persist on retry', () => {
  const initialFailures = [
    { key: 'parcelwing/public-1', ok: false, reason: 'got 523' },
    { key: 'parcelwing/public-3', ok: false, reason: 'got 523' },
    { key: 'fed-funds-api/public-1', ok: false, reason: 'got 523' },
  ];
  const retryResults = [
    { key: 'parcelwing/public-1', ok: true, reason: 'ok' },
    { key: 'parcelwing/public-3', ok: false, reason: 'got 523 again' },
    { key: 'fed-funds-api/public-1', ok: true, reason: 'ok' },
  ];

  const correlated = correlateRetryResults(initialFailures, retryResults);

  assert.deepEqual(
    correlated.persistent.map((result) => result.key),
    ['parcelwing/public-3'],
  );
  assert.deepEqual(
    correlated.transient.map(({ initial }) => initial.key),
    ['parcelwing/public-1', 'fed-funds-api/public-1'],
  );
});

test('external monitor fails closed when a retry result is missing', () => {
  const initialFailures = [
    { key: 'parcelwing/public-3', ok: false, reason: 'got 523' },
  ];

  const correlated = correlateRetryResults(initialFailures, []);

  assert.deepEqual(correlated.persistent, initialFailures);
  assert.deepEqual(correlated.transient, []);
});

test('external monitor formats Cloudflare response diagnostics', () => {
  const headers = new Headers({
    server: 'cloudflare',
    'cf-ray': 'abc123-ATL',
    'cf-error-type': '523',
    'cf-error-origin': 'cloudflared',
  });

  assert.equal(
    formatResponseDiagnostics(headers),
    '; server=cloudflare cf-ray=abc123-ATL cf-error-type=523 cf-error-origin=cloudflared',
  );
});

test('external monitor omits unavailable response diagnostics', () => {
  assert.equal(formatResponseDiagnostics(new Headers()), '');
});
