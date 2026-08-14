export const DEFAULT_CBP_DASHBOARD_MARKER = 'CEO dashboard';
export const MAX_CBP_DOCUMENT_OBSERVATIONS = 12;

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

export function classifyAuthenticatedNavigationFailure(value, expectedOrigin, baseUrl) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    const baseOrigin = new URL(baseUrl).origin;

    if (url.origin === baseOrigin && url.pathname === '/auth/setup-workspace') {
      return {
        failureStage: 'workspace_resolution',
        failureClass: 'workspace_setup_misroute',
      };
    }

    if (url.origin === expectedOrigin && url.pathname === '/auth/post-login') {
      return {
        failureStage: 'post_login',
        failureClass: 'post_login_stalled',
      };
    }

    if (url.origin === expectedOrigin && url.pathname === '/login') {
      return {
        failureStage: 'authentication',
        failureClass: 'login_not_completed',
      };
    }

    if (url.origin !== expectedOrigin) {
      return {
        failureStage: 'authenticated_navigation',
        failureClass: 'unexpected_origin',
      };
    }
  } catch {
    return {
      failureStage: 'authenticated_navigation',
      failureClass: 'invalid_navigation_url',
    };
  }

  return {
    failureStage: 'authenticated_navigation',
    failureClass: 'dashboard_navigation_timeout',
  };
}

export function isAuthenticatedNavigationTerminal(value, expectedOrigin, baseUrl) {
  if (isTenantDashboardUrl(value, expectedOrigin)) return true;
  return (
    classifyAuthenticatedNavigationFailure(value, expectedOrigin, baseUrl).failureClass ===
    'workspace_setup_misroute'
  );
}

export function formatSyntheticLocation(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(invalid URL)';
  }
}

export function formatSyntheticDocumentObservation(value, status) {
  const location = formatSyntheticLocation(value);
  if (location === '(invalid URL)') return '';
  const parsedStatus = Number(status);
  const safeStatus = Number.isInteger(parsedStatus) && parsedStatus >= 100 && parsedStatus <= 599
    ? parsedStatus
    : 'unknown';
  return `${location}:${safeStatus}`;
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
