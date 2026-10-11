import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import YAML from 'yaml';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const config = YAML.parse(fs.readFileSync(path.join(root, 'config/sites.yaml'), 'utf8'));

function siteByKey(key) {
  return config.sites.find((site) => site.key === key);
}

test('Baby Bobaloo uses the shared loopback proxy and health contract', () => {
  const site = siteByKey('baby-bobaloo');

  assert.ok(site);
  assert.equal(site.enabled, true);
  assert.equal(site.kind, 'proxy');
  assert.deepEqual(site.hostnames, ['babybobaloo.com', 'www.babybobaloo.com']);
  assert.equal(site.upstream, 'http://127.0.0.1:8081');
  assert.equal(site.healthUrl, 'http://127.0.0.1:8081/api/health');
  assert.equal(site.healthBodyContains, '"service":"baby-bobaloo"');
  assert.equal(site.expectedStatus, 200);
  assert.equal(site.expectedBodyContains, 'Baby Bobaloo');
  assert.deepEqual(site.supabaseHeartbeat, {
    enabled: true,
    urlEnv: 'BABY_BOBALOO_SUPABASE_URL',
    serviceRoleKeyEnv: 'BABY_BOBALOO_SUPABASE_SERVICE_ROLE_KEY',
  });
  assert.deepEqual(site.publicHealthChecks, [
    {
      url: 'https://babybobaloo.com/api/health',
      expectedStatus: 200,
      expectedBodyContains: '"service":"baby-bobaloo"',
    },
    {
      url: 'https://babybobaloo.com/',
      expectedStatus: 200,
      expectedBodyContains: 'Baby Bobaloo',
    },
    {
      url: 'https://www.babybobaloo.com/',
      expectedStatus: 200,
      expectedBodyContains: 'Baby Bobaloo',
    },
  ]);
});

test('Baby Bobaloo Nginx route stays loopback-only and preserves normal forwarded headers', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-server-baby-bobaloo-nginx-'));

  try {
    const result = spawnSync(process.execPath, ['scripts/render-nginx-config.mjs'], {
      cwd: root,
      env: { ...process.env, NGINX_OUTPUT_DIR: outputDir },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);

    const rendered = fs.readFileSync(path.join(outputDir, 'baby-bobaloo.conf'), 'utf8');
    assert.match(rendered, /listen 127\.0\.0\.1:80;/);
    assert.match(rendered, /server_name babybobaloo\.com www\.babybobaloo\.com;/);
    assert.match(rendered, /proxy_pass http:\/\/127\.0\.0\.1:8081;/);
    assert.match(rendered, /proxy_set_header X-Real-IP \$remote_addr;/);
    assert.match(rendered, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('Baby Bobaloo hostnames are published through the existing local Cloudflare Tunnel ingress', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-server-baby-bobaloo-tunnel-'));
  const outputFile = path.join(tmpDir, 'config.yml');

  try {
    const result = spawnSync(process.execPath, ['scripts/render-cloudflared-config.mjs'], {
      cwd: root,
      env: { ...process.env, CLOUDFLARED_OUTPUT_FILE: outputFile },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const rendered = YAML.parse(fs.readFileSync(outputFile, 'utf8'));

    for (const hostname of ['babybobaloo.com', 'www.babybobaloo.com']) {
      const matches = rendered.ingress.filter((entry) => entry.hostname === hostname);
      assert.deepEqual(matches, [
        {
          hostname,
          service: 'http://127.0.0.1:80',
        },
      ]);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
