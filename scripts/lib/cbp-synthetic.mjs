export const DEFAULT_CBP_DASHBOARD_MARKER = 'CEO dashboard';

export function isTenantDashboardUrl(value, expectedOrigin) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return url.origin === expectedOrigin && url.pathname === '/';
  } catch {
    return false;
  }
}

export function shouldBlockSyntheticPrefetch({ method = 'GET', headers = {} } = {}) {
  if (String(method).toUpperCase() !== 'GET') return false;

  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value).toLowerCase()]),
  );

  return (
    normalized['next-router-prefetch'] === '1' ||
    normalized.purpose === 'prefetch' ||
    normalized['sec-purpose']?.includes('prefetch') === true
  );
}
