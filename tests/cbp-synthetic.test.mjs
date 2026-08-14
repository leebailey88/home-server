import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CBP_DASHBOARD_MARKER,
  DEFAULT_CBP_READ_ONLY_PATHS,
  MAX_CBP_DOCUMENT_OBSERVATIONS,
  classifyAuthenticatedNavigationFailure,
  formatSyntheticDocumentObservation,
  formatSyntheticLocation,
  isAuthenticatedNavigationTerminal,
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

test('fails authenticated navigation immediately when an existing tenant user reaches workspace setup', () => {
  const origin = 'https://test.communitybankpilot.com';
  const baseUrl = 'https://communitybankpilot.com';
  const setupUrl = 'https://communitybankpilot.com/auth/setup-workspace?returnTo=%2Freports%2Fliquidity';

  assert.equal(isAuthenticatedNavigationTerminal(`${origin}/`, origin, baseUrl), true);
  assert.equal(isAuthenticatedNavigationTerminal(setupUrl, origin, baseUrl), true);
  assert.equal(
    isAuthenticatedNavigationTerminal(`${origin}/auth/post-login`, origin, baseUrl),
    false,
  );
  assert.deepEqual(
    classifyAuthenticatedNavigationFailure(setupUrl, origin, baseUrl),
    {
      failureStage: 'workspace_resolution',
      failureClass: 'workspace_setup_misroute',
    },
  );
});

test('classifies a tenant post-login timeout separately from a generic dashboard timeout', () => {
  const origin = 'https://test.communitybankpilot.com';
  const baseUrl = 'https://communitybankpilot.com';

  assert.deepEqual(
    classifyAuthenticatedNavigationFailure(`${origin}/auth/post-login`, origin, baseUrl),
    {
      failureStage: 'post_login',
      failureClass: 'post_login_stalled',
    },
  );
  assert.deepEqual(
    classifyAuthenticatedNavigationFailure(`${origin}/somewhere-else`, origin, baseUrl),
    {
      failureStage: 'authenticated_navigation',
      failureClass: 'dashboard_navigation_timeout',
    },
  );
});

test('document and current-location evidence strips query strings and fragments', () => {
  assert.equal(MAX_CBP_DOCUMENT_OBSERVATIONS, 12);
  const url =
    'https://test.communitybankpilot.com/auth/post-login?returnTo=%2Freports%2Fliquidity#token-like-fragment';
  const observation = formatSyntheticDocumentObservation(url, 503);
  const location = formatSyntheticLocation(url);

  assert.equal(
    observation,
    'https://test.communitybankpilot.com/auth/post-login:503',
  );
  assert.equal(location, 'https://test.communitybankpilot.com/auth/post-login');
  assert.equal(observation.includes('returnTo'), false);
  assert.equal(observation.includes('token-like-fragment'), false);
  assert.equal(location.includes('returnTo'), false);
  assert.equal(location.includes('token-like-fragment'), false);
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
