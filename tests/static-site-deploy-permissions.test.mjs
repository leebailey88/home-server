import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');

test('static deploys normalize web-readable release permissions', () => {
  const script = fs.readFileSync(path.join(repoRoot, 'scripts/deploy-static-site.mjs'), 'utf8');

  assert.match(script, /fs\.chmodSync\(deployRoot, 0o755\)/);
  assert.match(script, /fs\.chmodSync\(releasesDir, 0o755\)/);
  assert.match(script, /fs\.mkdirSync\(releaseDir, \{ mode: 0o755 \}\)/);
  assert.match(script, /'--chmod=D755,F644'/);
});
