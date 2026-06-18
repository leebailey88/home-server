import { loadSitesConfig } from './lib/sites-config.mjs';

const DEFAULT_TABLE = 'keepalive_heartbeat';
const DEFAULT_ID = 'supabase-free-plan-heartbeat';
const DEFAULT_SOURCE = 'home-server-nuc';

function activeHeartbeatConfig(defaults, site) {
  if (site.supabaseHeartbeat === undefined || site.supabaseHeartbeat === false) {
    return null;
  }

  if (site.supabaseHeartbeat.enabled === false) {
    return null;
  }

  const defaultHeartbeat =
    defaults.supabaseHeartbeat && typeof defaults.supabaseHeartbeat === 'object'
      ? defaults.supabaseHeartbeat
      : {};

  return {
    table: DEFAULT_TABLE,
    id: DEFAULT_ID,
    source: DEFAULT_SOURCE,
    ...defaultHeartbeat,
    ...site.supabaseHeartbeat,
  };
}

function envValue(name, label) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${label} references ${name}, but that environment variable is not set.`);
  }

  return value;
}

function buildHeartbeatUrl(projectUrl, table) {
  const normalizedUrl = projectUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ on_conflict: 'id' });
  return `${normalizedUrl}/rest/v1/${encodeURIComponent(table)}?${params.toString()}`;
}

async function upsertHeartbeat({ site, heartbeat }) {
  const supabaseUrl = envValue(heartbeat.urlEnv, `${site.key}.supabaseHeartbeat.urlEnv`);
  const serviceRoleKey = envValue(
    heartbeat.serviceRoleKeyEnv,
    `${site.key}.supabaseHeartbeat.serviceRoleKeyEnv`,
  );

  const response = await fetch(buildHeartbeatUrl(supabaseUrl, heartbeat.table), {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      {
        id: heartbeat.id,
        last_seen_at: new Date().toISOString(),
        source: heartbeat.source,
      },
    ]),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase returned HTTP ${response.status}: ${body}`);
  }
}

const { defaults, enabledSites } = loadSitesConfig();
const heartbeatJobs = enabledSites
  .map((site) => ({ site, heartbeat: activeHeartbeatConfig(defaults, site) }))
  .filter((job) => job.heartbeat);

if (heartbeatJobs.length === 0) {
  console.log('No enabled Supabase heartbeat sites configured.');
  process.exit(0);
}

let failures = 0;

for (const job of heartbeatJobs) {
  try {
    await upsertHeartbeat(job);
    console.log(`[${job.site.key}] Supabase heartbeat ok`);
  } catch (error) {
    failures += 1;
    console.error(`[${job.site.key}] Supabase heartbeat failed: ${error.message}`);
  }
}

if (failures > 0) {
  process.exit(1);
}
