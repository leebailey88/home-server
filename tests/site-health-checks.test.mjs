import assert from 'node:assert/strict';
import test from 'node:test';

import { localNginxRouteCheckForSite } from '../scripts/lib/site-health-checks.mjs';

test('local proxy route uses stable health path and identity when configured', () => {
  const check = localNginxRouteCheckForSite(
    {
      kind: 'proxy',
      expectedStatus: 200,
      expectedBodyContains: 'Altamont IQ',
      healthUrl: 'http://127.0.0.1:8082/api/health?mode=local',
      healthBodyContains: '"service":"altamont-iq"',
    },
    'http://127.0.0.1:80',
  );

  assert.deepEqual(check, {
    url: 'http://127.0.0.1:80/api/health?mode=local',
    expectedStatus: 200,
    expectedStatuses: undefined,
    expectedBodyContains: '"service":"altamont-iq"',
  });
});

test('local proxy route keeps root page assertion without a health identity', () => {
  const check = localNginxRouteCheckForSite(
    {
      kind: 'proxy',
      expectedStatus: 200,
      expectedBodyContains: 'Parcel Wing',
      healthUrl: 'http://127.0.0.1:3000/',
    },
    'http://127.0.0.1:80',
  );

  assert.deepEqual(check, {
    url: 'http://127.0.0.1:80',
    expectedStatus: 200,
    expectedStatuses: undefined,
    expectedBodyContains: 'Parcel Wing',
  });
});

test('static site local route keeps configured page assertion', () => {
  const check = localNginxRouteCheckForSite(
    {
      kind: 'static',
      expectedStatus: 200,
      expectedBodyContains: 'Preview',
    },
    'http://127.0.0.1:80',
  );

  assert.deepEqual(check, {
    url: 'http://127.0.0.1:80',
    expectedStatus: 200,
    expectedStatuses: undefined,
    expectedBodyContains: 'Preview',
  });
});
