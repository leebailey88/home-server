import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CBP_DASHBOARD_MARKER,
  DEFAULT_CBP_READ_ONLY_PATHS,
  isTenantDashboardUrl,
  shouldBlockSyntheticPrefetch,
} from '../scripts/lib/cbp-synthetic.mjs';

test('uses a stable current dashboard marker', () => {
  assert.equal(DEFAULT_CBP_DASHBOARD_MARKER, 'CEO dashboard');
});

test('uses current banker-facing report routes by default', () => {
  assert.deepEqual(DEFAULT_CBP_READ_ONLY_PATHS, [
    '/reports/balance-sheet',
    '/reports/income-statement',
    '/reports/liquidity',
    '/reports/branch-performance',
  ]);
  assert.equal(DEFAULT_CBP_READ_ONLY_PATHS.includes('/reports/packages'), false);
  assert.equal(DEFAULT_CBP_READ_ONLY_PATHS.includes('/reports/import'), false);
});

test('accepts only the tenant dashboard root as the completed post-login destination', () => {
  const origin = 'https://test.communitybankpilot.com';

  assert.equal(isTenantDashboardUrl(`${origin}/`, origin), true);
  assert.equal(isTenantDashboardUrl(`${origin}/?period=latest`, origin), true);
  assert.equal(isTenantDashboardUrl(`${origin}/auth/post-login`, origin), false);
  assert.equal(isTenantDashboardUrl(`${origin}/login`, origin), false);
  assert.equal(isTenantDashboardUrl(`${origin}/reports/balance-sheet`, origin), false);
  assert.equal(isTenantDashboardUrl('https://evabank.communitybankpilot.com/', origin), false);
});

test('blocks speculative browser prefetches but not real navigations', () => {
  assert.equal(
    shouldBlockSyntheticPrefetch({
      method: 'GET',
      headers: { 'next-router-prefetch': '1' },
    }),
    true,
  );
  assert.equal(
    shouldBlockSyntheticPrefetch({
      method: 'GET',
      headers: { purpose: 'prefetch' },
    }),
    true,
  );
  assert.equal(
    shouldBlockSyntheticPrefetch({
      method: 'GET',
      headers: { 'sec-purpose': 'prefetch;prerender' },
    }),
    true,
  );
  assert.equal(
    shouldBlockSyntheticPrefetch({
      method: 'GET',
      url: 'https://test.communitybankpilot.com/reports/liquidity?_rsc=abc123',
    }),
    true,
  );
  assert.equal(
    shouldBlockSyntheticPrefetch({
      method: 'GET',
      url: 'https://test.communitybankpilot.com/reports/liquidity',
      headers: {},
    }),
    false,
  );
  assert.equal(
    shouldBlockSyntheticPrefetch({
      method: 'POST',
      url: 'https://test.communitybankpilot.com/login?_rsc=abc123',
      headers: { purpose: 'prefetch' },
    }),
    false,
  );
});
