export const DEFAULT_CBP_DASHBOARD_MARKER = 'CEO dashboard';

export const DEFAULT_CBP_READ_ONLY_PATHS = Object.freeze([
  '/reports/balance-sheet',
  '/reports/income-statement',
  '/reports/liquidity',
  '/reports/branch-performance',
]);

export function isTenantDashboardUrl(value, expectedOrigin) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return url.origin === expectedOrigin && url.pathname === '/';
  } catch {
    return false;
  }
}

export function shouldBlockSyntheticPrefetch({ method = 'GET', headers = {}, url = '' } = {}) {
  if (String(method).toUpperCase() !== 'GET') return false;

  try {
    const parsedUrl = new URL(String(url || ''), 'https://synthetic.invalid');
    if (parsedUrl.searchParams.has('_rsc')) return true;
  } catch {
    // Fall through to header checks for malformed or unavailable URLs.
  }

  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value).toLowerCase()]),
  );

  return (
    normalized['next-router-prefetch'] === '1' ||
    normalized.purpose === 'prefetch' ||
    normalized['sec-purpose']?.includes('prefetch') === true
  );
}
