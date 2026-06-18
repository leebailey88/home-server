# Supabase Heartbeat

Free Supabase projects can pause after inactivity. The home-server Supabase
heartbeat keeps selected projects active by running one tiny database upsert
per configured site on a systemd timer.

## 1. Create the heartbeat table

Run this once in each Supabase project that should receive a heartbeat:

```sql
create table if not exists public.keepalive_heartbeat (
  id text primary key,
  last_seen_at timestamptz not null default now(),
  source text not null default 'home-server-nuc'
);

insert into public.keepalive_heartbeat (id, source)
values ('supabase-free-plan-heartbeat', 'home-server-nuc')
on conflict (id)
do update set
  last_seen_at = now(),
  source = excluded.source;
```

## 2. Configure a site

In `config/sites.yaml`, add `supabaseHeartbeat` only for sites that use
Supabase:

```yaml
defaults:
  supabaseHeartbeat:
    table: keepalive_heartbeat
    id: supabase-free-plan-heartbeat
    source: home-server-nuc

sites:
  - key: altamont-iq
    enabled: true
    kind: proxy
    hostnames:
      - altamontiq.com
    upstream: http://127.0.0.1:3001
    supabaseHeartbeat:
      enabled: true
      urlEnv: ALTAMONT_IQ_SUPABASE_URL
      serviceRoleKeyEnv: ALTAMONT_IQ_SUPABASE_SERVICE_ROLE_KEY
```

Keep secrets out of YAML. YAML stores env var names only.

## 3. Add secrets to the NUC env file

The installer defaults to the repo `.env` file unless `HOME_SERVER_ENV_FILE`
is set.

```bash
ALTAMONT_IQ_SUPABASE_URL=https://example.supabase.co
ALTAMONT_IQ_SUPABASE_SERVICE_ROLE_KEY=replace-me
```

The service role key is intentionally used only on the NUC so the heartbeat
table can remain private and does not need an unauthenticated RLS policy.

## 4. Test manually

```bash
pnpm heartbeat:supabase
```

Expected output:

```text
[altamont-iq] Supabase heartbeat ok
```

## 5. Install the systemd timer

```bash
sudo bash scripts/install-supabase-heartbeat-service.sh
```

Optional interval overrides:

```bash
sudo HOME_SERVER_SUPABASE_HEARTBEAT_INTERVAL=12h \
  bash scripts/install-supabase-heartbeat-service.sh
```

## 6. Inspect status

```bash
systemctl status home-server-supabase-heartbeat.timer --no-pager
journalctl -u home-server-supabase-heartbeat.service -o cat -n 100
```

## Troubleshooting

- `No enabled Supabase heartbeat sites configured.` means no enabled site has
  `supabaseHeartbeat.enabled: true`.
- `environment variable is not set` means the site references an env var name
  that is missing from the service env file.
- `HTTP 404` usually means the heartbeat table does not exist or the table
  name in YAML is wrong.
- `HTTP 401/403` usually means the service role key is wrong or missing.
