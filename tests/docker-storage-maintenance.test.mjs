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

test('Docker storage maintenance preserves production data and rollback images', () => {
  const script = read('scripts/docker-storage-maintenance.sh');

  assert.match(script, /docker builder prune -af --filter/);
  assert.match(script, /docker container prune -f --filter/);
  assert.match(script, /STOPPED_CONTAINER_MAX_AGE=.*720h/);
  assert.match(script, /docker image prune -f --filter/);
  assert.doesNotMatch(script, /docker image prune[^\n]*\s-a(?:\s|$)/);
  assert.doesNotMatch(script, /docker volume prune/);
  assert.doesNotMatch(script, /docker system prune/);
  assert.match(script, /Volumes and tagged unused images were intentionally preserved/);
});

test('Docker storage maintenance timer is persistent, weekly, and jittered', () => {
  const timer = read('systemd/home-server-docker-storage-maintenance.timer');

  assert.match(timer, /OnCalendar=Sun \*-\*-\* 03:30:00/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /RandomizedDelaySec=30m/);
});

test('installer enables the timer without running cleanup immediately', () => {
  const installer = read('scripts/install-docker-storage-maintenance.sh');

  assert.match(installer, /systemctl enable --now "\$\{TIMER_NAME\}"/);
  assert.match(installer, /No cleanup was run during installation/);
  assert.doesNotMatch(installer, /systemctl start "\$\{SERVICE_NAME\}"/);
});

test('bootstrap and pnpm expose Docker storage maintenance installation', () => {
  const bootstrap = read('scripts/bootstrap-nuc.sh');
  const pkg = JSON.parse(read('package.json'));

  assert.match(bootstrap, /install-docker-storage-maintenance\.sh/);
  assert.equal(
    pkg.scripts['docker:storage:maintain'],
    'sudo bash scripts/docker-storage-maintenance.sh',
  );
  assert.equal(
    pkg.scripts['install:docker-storage-maintenance'],
    'sudo bash scripts/install-docker-storage-maintenance.sh',
  );
});
