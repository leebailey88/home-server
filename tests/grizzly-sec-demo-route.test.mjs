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

test('SEC7D5 publishes the hosted SEC Data Explorer only through loopback ingress', () => {
  const site = siteByKey('grizzly-bulls-sec-demo');

  assert.ok(site);
  assert.equal(site.enabled, true);
  assert.equal(site.kind, 'proxy');
  assert.deepEqual(site.hostnames, ['sec-demo.grizzlybulls.com']);
  assert.equal(site.upstream, 'http://127.0.0.1:3092');
  assert.equal(site.trustCloudflareClientIp, true);
  assert.equal(site.healthUrl, 'http://127.0.0.1:3092/api/health');
  assert.equal(site.healthBodyContains, '"mode":"hosted-demo"');
  assert.equal(site.expectedBodyContains, '"service":"sec-data-explorer"');
  assert.deepEqual(site.publicHealthChecks, [
    {
      url: 'https://sec-demo.grizzlybulls.com/api/health',
      expectedStatus: 200,
      expectedBodyContains: '"mode":"hosted-demo"',
    },
  ]);
});

test('SEC7D5 overwrites spoofable forwarded addresses with Cloudflare canonical client IP', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-server-sec7d5-nginx-'));

  try {
    const result = spawnSync(process.execPath, ['scripts/render-nginx-config.mjs'], {
      cwd: root,
      env: { ...process.env, NGINX_OUTPUT_DIR: outputDir },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);

    const demo = fs.readFileSync(path.join(outputDir, 'grizzly-bulls-sec-demo.conf'), 'utf8');
    assert.match(demo, /server_name sec-demo\.grizzlybulls\.com;/);
    assert.match(demo, /proxy_pass http:\/\/127\.0\.0\.1:3092;/);
    assert.match(demo, /proxy_set_header X-Real-IP \$http_cf_connecting_ip;/);
    assert.match(demo, /proxy_set_header X-Forwarded-For \$http_cf_connecting_ip;/);
    assert.doesNotMatch(demo, /proxy_set_header X-Real-IP \$remote_addr;/);
    assert.doesNotMatch(demo, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('SEC7D5 tunnel rendering publishes the demo hostname through local Nginx', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-server-sec7d5-tunnel-'));
  const outputFile = path.join(tmpDir, 'config.yml');

  try {
    const result = spawnSync(process.execPath, ['scripts/render-cloudflared-config.mjs'], {
      cwd: root,
      env: { ...process.env, CLOUDFLARED_OUTPUT_FILE: outputFile },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const rendered = YAML.parse(fs.readFileSync(outputFile, 'utf8'));
    const matches = rendered.ingress.filter(
      (entry) => entry.hostname === 'sec-demo.grizzlybulls.com',
    );

    assert.deepEqual(matches, [
      {
        hostname: 'sec-demo.grizzlybulls.com',
        service: 'http://127.0.0.1:80',
      },
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
