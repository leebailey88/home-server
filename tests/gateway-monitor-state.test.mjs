import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const helperPath = fileURLToPath(
  new URL('../scripts/lib/gateway-monitor-state.sh', import.meta.url),
);

function runHelper(command, env = {}) {
  return execFileSync('bash', ['-c', `source "$HELPER"; ${command}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HELPER: helperPath,
      ...env,
    },
  }).trim();
}

function correlate(first, second) {
  return runHelper('gateway_failure_correlation "$FIRST" "$SECOND"', {
    FIRST: first,
    SECOND: second,
  });
}

test('same structured gateway failure persists across retries', () => {
  const first =
    '[FAIL] grizzly-bulls public route 1: https://grizzlybulls.com/api/health (timeout)';
  const second =
    '[FAIL] grizzly-bulls public route 1: https://grizzlybulls.com/api/health returned 502';

  assert.equal(correlate(first, second), 'persistent');
});

test('different public route failures across retries are transient', () => {
  const first =
    '[FAIL] grizzly-bulls public route 1: https://grizzlybulls.com/api/health (The operation was aborted due to timeout)';
  const second = [
    '[FAIL] altamont-iq public route 2: https://altamontiq.com/api/health (The operation was aborted due to timeout)',
    '[FAIL] fed-funds-api public route 1: https://fed-funds-api.grizzlybulls.com/healthz (The operation was aborted due to timeout)',
  ].join('\n');

  assert.equal(correlate(first, second), 'different');
});

test('one repeated failure remains persistent when other retry failures change', () => {
  const first = [
    '[FAIL] grizzly-bulls public route 1: https://grizzlybulls.com/api/health (timeout)',
    '[FAIL] parcelwing public route 3: https://www.parcelwing.com/ (timeout)',
  ].join('\n');
  const second = [
    '[FAIL] parcelwing public route 3: https://www.parcelwing.com/ returned 502',
    '[FAIL] altamont-iq public route 2: https://altamontiq.com/api/health (timeout)',
  ].join('\n');

  assert.equal(correlate(first, second), 'persistent');
});

test('unstructured non-zero output remains fail-closed', () => {
  const structured = '[FAIL] parcelwing public route 3: https://www.parcelwing.com/ (timeout)';
  const unstructured = 'nginx: configuration file /etc/nginx/nginx.conf test failed';

  assert.equal(correlate(structured, unstructured), 'unknown');
  assert.equal(correlate(unstructured, structured), 'unknown');
});

test('failure fingerprints ignore volatile diagnostic details', () => {
  const output = [
    '[FAIL] altamont-iq public route 2: https://altamontiq.com/api/health (timeout)',
    '[FAIL] altamont-iq public route 2: https://altamontiq.com/api/health returned 504',
    '[home-server][error] cloudflared service is not active',
  ].join('\n');

  const fingerprints = runHelper('gateway_failure_fingerprints "$OUTPUT"', {
    OUTPUT: output,
  }).split('\n');

  assert.deepEqual(fingerprints, [
    'check:altamont-iq public route 2',
    'error:cloudflared service is not active',
  ]);
});
