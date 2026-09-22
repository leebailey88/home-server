import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const gateway = fs.readFileSync(new URL('../scripts/monitor-gateway.sh', import.meta.url), 'utf8');
const jobs = fs.readFileSync(new URL('../scripts/monitor-jobs.sh', import.meta.url), 'utf8');
const runbook = fs.readFileSync(new URL('../docs/runbooks/monitoring.md', import.meta.url), 'utf8');

test('manual home-server monitors fail fast unless run as root', () => {
  assert.match(gateway, /source "\$\{SCRIPT_DIR\}\/lib\/common\.sh"\n\nrequire_root/);
  assert.match(jobs, /source "\$\{SCRIPT_DIR\}\/lib\/common\.sh"\n\nrequire_root/);
});

test('monitoring runbook uses sudo for direct monitor execution', () => {
  assert.match(
    runbook,
    /sudo HOME_SERVER_ENV_FILE="\$\(pwd\)\/\.env" bash scripts\/monitor-gateway\.sh/,
  );
  assert.match(
    runbook,
    /sudo HOME_SERVER_ENV_FILE="\$\(pwd\)\/\.env" bash scripts\/monitor-jobs\.sh/,
  );
});
