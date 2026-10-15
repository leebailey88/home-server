import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const checkerPath = path.join(repoRoot, 'scripts/check-supabase-heartbeat-health.sh');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function runHeartbeatHealthCheck({
  nextTrigger = 'Thu 2026-10-15 08:00:00 UTC',
  ageSeconds = 0,
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supabase-heartbeat-health-'));
  const binDir = path.join(tempDir, 'bin');
  const stateDir = path.join(tempDir, 'state');
  fs.mkdirSync(binDir);
  fs.mkdirSync(stateDir);

  const systemctlPath = path.join(binDir, 'systemctl');
  fs.writeFileSync(
    systemctlPath,
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  is-enabled|is-active)
    exit 0
    ;;
  show)
    printf '%s\\n' "\${FAKE_NEXT_TRIGGER:-}"
    ;;
  *)
    printf 'unexpected systemctl invocation: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`,
    { mode: 0o755 },
  );

  const successFile = path.join(stateDir, 'supabase-heartbeat.last-success');
  fs.writeFileSync(successFile, '2026-10-15T00:00:00Z\n');
  const markerTime = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(successFile, markerTime, markerTime);

  const result = spawnSync('bash', [checkerPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      HOME_SERVER_STATE_DIR: stateDir,
      HOME_SERVER_SUPABASE_HEARTBEAT_MAX_AGE_SECONDS: '86400',
      FAKE_NEXT_TRIGGER: nextTrigger,
    },
  });

  fs.rmSync(tempDir, { recursive: true, force: true });
  return result;
}

test('Supabase heartbeat uses a persistent calendar schedule', () => {
  const timer = read('systemd/home-server-supabase-heartbeat.timer');

  assert.match(timer, /OnBootSec=\{\{ON_BOOT_SEC\}\}/);
  assert.match(timer, /OnCalendar=\{\{ON_CALENDAR\}\}/);
  assert.match(timer, /Persistent=true/);
  assert.doesNotMatch(timer, /OnUnitActiveSec/);
});

test('Supabase heartbeat installer requires an armed future trigger', () => {
  const installer = read('scripts/install-supabase-heartbeat-service.sh');

  assert.match(installer, /HOME_SERVER_SUPABASE_HEARTBEAT_CALENDAR/);
  assert.match(installer, /\*-\*-\* 00,08,16:00:00/);
  assert.match(installer, /systemctl is-enabled --quiet/);
  assert.match(installer, /systemctl is-active --quiet/);
  assert.match(installer, /NextElapseUSecRealtime/);
  assert.match(installer, /has no future activation after restart/);
  assert.doesNotMatch(installer, /HOME_SERVER_SUPABASE_HEARTBEAT_INTERVAL/);
});

test('successful heartbeats leave a freshness marker for monitoring', () => {
  const runner = read('scripts/run-supabase-heartbeat.sh');
  const checker = read('scripts/check-supabase-heartbeat-health.sh');
  const jobsCheck = read('scripts/check-jobs-health.sh');

  assert.match(runner, /supabase-heartbeat\.last-success/);
  assert.match(runner, /date -u/);

  assert.match(checker, /HOME_SERVER_SUPABASE_HEARTBEAT_MAX_AGE_SECONDS:-86400/);
  assert.match(checker, /systemctl is-enabled --quiet/);
  assert.match(checker, /systemctl is-active --quiet/);
  assert.match(checker, /NextElapseUSecRealtime/);
  assert.match(checker, /stat -c %Y/);
  assert.match(checker, /has no future activation scheduled/);

  assert.match(jobsCheck, /check-supabase-heartbeat-health\.sh/);
});

test('heartbeat health check accepts a fresh marker with a future trigger', () => {
  const result = runHeartbeatHealthCheck();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Supabase heartbeat scheduler healthy/);
});

test('heartbeat health check fails when systemd has no future trigger', () => {
  const result = runHeartbeatHealthCheck({ nextTrigger: 'n/a' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /has no future activation scheduled/);
});

test('heartbeat health check fails when the last success marker is stale', () => {
  const result = runHeartbeatHealthCheck({ ageSeconds: 90000 });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeding 86400s/);
});
