import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';
import { evaluateCronLogState } from '../scripts/lib/cron-log-state.mjs';

test('Grizzly runtime terminal status is monitored for freshness only by home-server', () => {
  const config = YAML.parse(readFileSync('config/sites.yaml', 'utf8'));
  const grizzly = config.sites.find(site => site.key === 'grizzly-bulls');
  assert.ok(grizzly, 'expected grizzly-bulls site config');

  const runtimeJob = grizzly.cronJobs?.find(job => job.key === 'runtime-data-refresh');
  assert.ok(runtimeJob, 'expected runtime-data-refresh job monitor');
  assert.equal(runtimeJob.logPath, '/opt/grizzly-bulls/data/runtime-data-refresh.status');
  assert.equal(runtimeJob.errorPatterns, false);
  assert.equal(runtimeJob.successPatterns, undefined);
  assert.ok(Number(runtimeJob.maxAgeMinutes) > 0);
});

test('freshness-only cron semantics do not reinterpret a FAILED terminal marker', () => {
  const state = evaluateCronLogState({
    lines: [
      'Runtime data refresh FAILED',
      'status=failed',
      'failedStage=billionaires',
      'exitCode=1',
    ],
    errorPatterns: [],
    successPatterns: [],
  });

  assert.equal(state.ok, true);
  assert.equal(state.reason, 'no-error');
});

test('content-aware cron jobs retain existing failure semantics', () => {
  const state = evaluateCronLogState({
    lines: ['Health check completed successfully', 'ERROR: provider failed'],
    errorPatterns: [/\bERROR\b/m],
    successPatterns: [/Health check completed successfully/m],
  });

  assert.equal(state.ok, false);
  assert.equal(state.reason, 'error-after-success');
});
