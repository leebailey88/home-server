import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import YAML from 'yaml';

const config = YAML.parse(
  fs.readFileSync(new URL('../config/sites.yaml', import.meta.url), 'utf8'),
);

function siteByKey(key) {
  return config.sites.find((site) => site.key === key);
}

test('routes Altamont Ingredients as an exact standalone hostname on port 8084', () => {
  const site = siteByKey('altamont-ingredients');

  assert.ok(site);
  assert.equal(site.enabled, true);
  assert.equal(site.kind, 'proxy');
  assert.deepEqual(site.hostnames, ['ingredients.altamontiq.com']);
  assert.equal(site.upstream, 'http://127.0.0.1:8084');
  assert.equal(site.healthUrl, 'http://127.0.0.1:8084/api/health');
  assert.equal(site.healthBodyContains, '"service":"altamont-ingredients"');
  assert.deepEqual(site.publicHealthChecks, [
    {
      url: 'https://ingredients.altamontiq.com/api/health',
      expectedStatus: 200,
      expectedBodyContains: '"service":"altamont-ingredients"',
    },
  ]);
});

test('keeps the ingredient app carve-out ahead of the Altamont IQ tenant wildcard', () => {
  const ingredientIndex = config.sites.findIndex((site) => site.key === 'altamont-ingredients');
  const altamontIndex = config.sites.findIndex((site) => site.key === 'altamont-iq');
  const altamont = siteByKey('altamont-iq');

  assert.ok(ingredientIndex >= 0);
  assert.ok(altamontIndex >= 0);
  assert.ok(ingredientIndex < altamontIndex);
  assert.ok(altamont.hostnames.includes('*.altamontiq.com'));
  assert.equal(altamont.hostnames.includes('ingredients.altamontiq.com'), false);
});
