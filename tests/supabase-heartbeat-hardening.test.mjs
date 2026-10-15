import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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
