import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import YAML from 'yaml';

import { validateSitesConfig } from '../scripts/lib/sites-config.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const config = YAML.parse(fs.readFileSync(path.join(root, 'config/sites.yaml'), 'utf8'));

function siteByKey(key) {
  return config.sites.find((site) => site.key === key);
}

test('AIR6E1 registers an exact dark aircraft API hostname with one public path prefix', () => {
  const site = siteByKey('grizzly-bulls-aircraft-api');

  assert.ok(site);
  assert.equal(site.enabled, true);
  assert.equal(site.kind, 'proxy');
  assert.deepEqual(site.hostnames, ['api.grizzlybulls.com']);
  assert.equal(site.upstream, 'http://127.0.0.1:8080');
  assert.deepEqual(site.pathProxy, {
    publicPrefix: '/v1/',
    upstreamPrefix: '/api/v1/',
  });
  assert.equal(site.localCheckPath, '/v1/openapi');
  assert.equal(site.expectedStatus, 404);
  assert.equal(site.expectedBodyContains, '"code":"not_found"');
  assert.equal(site.publicHealthChecks, undefined);
});

test('AIR6E1 renders only /v1/* to the Grizzly Bulls internal API namespace', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-server-air6e1-nginx-'));

  try {
    const result = spawnSync(process.execPath, ['scripts/render-nginx-config.mjs'], {
      cwd: root,
      env: { ...process.env, NGINX_OUTPUT_DIR: outputDir },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const rendered = fs.readFileSync(
      path.join(outputDir, 'grizzly-bulls-aircraft-api.conf'),
      'utf8',
    );

    assert.match(rendered, /server_name api\.grizzlybulls\.com;/);
    assert.match(rendered, /location \^~ \/v1\/ \{/);
    assert.match(rendered, /proxy_pass http:\/\/127\.0\.0\.1:8080\/api\/v1\/;/);
    assert.match(rendered, /location \/ \{\s*return 404;\s*\}/s);
    assert.doesNotMatch(rendered, /location \/ \{[\s\S]*proxy_pass/);
    assert.doesNotMatch(rendered, /proxy_pass http:\/\/127\.0\.0\.1:8080;/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('AIR6E1 tunnel rendering sends api.grizzlybulls.com only to local Nginx', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-server-air6e1-tunnel-'));
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
      (entry) => entry.hostname === 'api.grizzlybulls.com',
    );

    assert.deepEqual(matches, [
      {
        hostname: 'api.grizzlybulls.com',
        service: 'http://127.0.0.1:80',
      },
    ]);
    assert.deepEqual(rendered.ingress.at(-1), { service: 'http_status:404' });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('restricted path proxy validation rejects broad or unsafe path authorities', () => {
  const base = {
    sites: [
      {
        key: 'aircraft-api',
        enabled: true,
        kind: 'proxy',
        hostnames: ['api.example.com'],
        upstream: 'http://127.0.0.1:8080',
        pathProxy: {
          publicPrefix: '/v1/',
          upstreamPrefix: '/api/v1/',
        },
        localCheckPath: '/v1/openapi',
      },
    ],
  };

  assert.doesNotThrow(() => validateSitesConfig(structuredClone(base)));

  for (const publicPrefix of ['/', '/v1', '/v1/../', '/v1//']) {
    const candidate = structuredClone(base);
    candidate.sites[0].pathProxy.publicPrefix = publicPrefix;
    assert.throws(() => validateSitesConfig(candidate));
  }

  const staticCandidate = structuredClone(base);
  staticCandidate.sites[0].kind = 'static';
  staticCandidate.sites[0].root = '/opt/example';
  delete staticCandidate.sites[0].upstream;
  assert.throws(() => validateSitesConfig(staticCandidate), /cannot configure pathProxy/);
});
