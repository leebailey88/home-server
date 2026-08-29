export function localNginxRouteCheckForSite(site, nginxUrl) {
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
