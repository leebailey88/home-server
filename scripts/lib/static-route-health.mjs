export const STATIC_ROUTE_HEALTH_PATH = '/_home-server-health';

export function staticRouteHealthBody(siteKey) {
  return `home-server-static:${siteKey}`;
}

export function staticRouteHealthLocation(siteKey) {
  return `  location = ${STATIC_ROUTE_HEALTH_PATH} {\n    default_type text/plain;\n    return 200 '${staticRouteHealthBody(siteKey)}';\n  }\n`;
}
