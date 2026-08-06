import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCronLogState } from '../scripts/lib/cron-log-state.mjs';

const errorPatterns = [/\bError:/];
const successPatterns = [/Runtime data refresh complete/];

test('a newer success clears an older error', () => {
  const state = evaluateCronLogState({
    lines: ['Error: refresh failed', 'Runtime data refresh complete'],
    errorPatterns,
    successPatterns,
  });

  assert.equal(state.ok, true);
  assert.equal(state.reason, 'success-after-error');
});

test('a newer error remains firing after an older success', () => {
  const state = evaluateCronLogState({
    lines: ['Runtime data refresh complete', 'Error: refresh failed'],
    errorPatterns,
    successPatterns,
  });

  assert.equal(state.ok, false);
  assert.equal(state.reason, 'error-after-success');
  assert.equal(state.lastError?.line, 'Error: refresh failed');
});

test('configured success patterns must appear in the log tail', () => {
  const state = evaluateCronLogState({
    lines: ['refresh started'],
    errorPatterns,
    successPatterns,
  });

  assert.equal(state.ok, false);
  assert.equal(state.reason, 'missing-success');
});

test('an error without any success marker surfaces the error', () => {
  const state = evaluateCronLogState({
    lines: ['Error: refresh failed'],
    errorPatterns,
    successPatterns,
  });

  assert.equal(state.ok, false);
  assert.equal(state.reason, 'error');
  assert.equal(state.lastError?.line, 'Error: refresh failed');
});

test('jobs without success patterns retain error-tail behavior', () => {
  const state = evaluateCronLogState({
    lines: ['refresh started', 'Error: refresh failed'],
    errorPatterns,
    successPatterns: [],
  });

  assert.equal(state.ok, false);
  assert.equal(state.reason, 'error');
});
