import assert from 'node:assert/strict';
import test from 'node:test';

import { localNginxRouteCheckForSite } from '../scripts/lib/site-health-checks.mjs';
import {
  STATIC_ROUTE_HEALTH_PATH,
  staticRouteHealthBody,
  staticRouteHealthLocation,
} from '../scripts/lib/static-route-health.mjs';

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

test('static site local route uses the generated virtual-host sentinel', () => {
  const check = localNginxRouteCheckForSite(
    {
      key: 'altamont-previews',
      kind: 'static',
      expectedStatus: 200,
      expectedBodyContains: 'Preview',
    },
    'http://127.0.0.1:80',
  );

  assert.deepEqual(check, {
    url: `http://127.0.0.1:80${STATIC_ROUTE_HEALTH_PATH}`,
    expectedStatus: 200,
    expectedStatuses: undefined,
    expectedBodyContains: 'home-server-static:altamont-previews',
  });
});

test('static virtual-host sentinel is exact, stable, and site-specific', () => {
  assert.equal(
    staticRouteHealthBody('altamont-previews'),
    'home-server-static:altamont-previews',
  );
  assert.match(staticRouteHealthLocation('altamont-previews'), /location = \/_home-server-health/);
  assert.match(staticRouteHealthLocation('altamont-previews'), /home-server-static:altamont-previews/);
});
