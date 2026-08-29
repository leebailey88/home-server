import {
  STATIC_ROUTE_HEALTH_PATH,
  staticRouteHealthBody,
} from './static-route-health.mjs';

export function localNginxRouteCheckForSite(site, nginxUrl) {
  if (site.kind === 'static') {
    return {
      url: `${nginxUrl}${STATIC_ROUTE_HEALTH_PATH}`,
      expectedStatus: 200,
      expectedStatuses: undefined,
      expectedBodyContains: staticRouteHealthBody(site.key),
    };
  }

  const fallbackCheck = {
    url: nginxUrl,
    expectedStatus: site.expectedStatus,
    expectedStatuses: site.expectedStatuses,
    expectedBodyContains: site.expectedBodyContains,
  };

  if (site.kind !== 'proxy' || !site.healthUrl || !site.healthBodyContains) {
    return fallbackCheck;
  }

  const upstreamHealthUrl = new URL(site.healthUrl);
  const localHealthUrl = `${nginxUrl}${upstreamHealthUrl.pathname}${upstreamHealthUrl.search}`;

  return {
    url: localHealthUrl,
    expectedStatus: site.expectedStatus,
    expectedStatuses: site.expectedStatuses,
    expectedBodyContains: site.healthBodyContains,
  };
}
