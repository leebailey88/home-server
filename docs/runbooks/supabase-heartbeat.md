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

From the production checkout, run:

```bash
sudo bash scripts/install-supabase-heartbeat-service.sh
```

The production default is every eight hours. An explicit override remains
available:

```bash
sudo HOME_SERVER_SUPABASE_HEARTBEAT_INTERVAL=12h \
  bash scripts/install-supabase-heartbeat-service.sh
```

Before changing systemd, the installer requires a readable env file and runs a
real heartbeat for every configured project. A missing or incorrect env file
therefore cannot replace a working installation. After the preflight succeeds,
the installer:

- renders the service and timer into a temporary directory
- installs the base units
- installs persistent service and timer drop-ins for the env path and cadence
- runs the installed service and fails if any heartbeat fails
- restarts the timer and prints its next scheduled run

The generated drop-ins are:

```text
/etc/systemd/system/home-server-supabase-heartbeat.service.d/10-production-settings.conf
/etc/systemd/system/home-server-supabase-heartbeat.timer.d/10-production-settings.conf
```

## 6. Inspect status

```bash
systemctl status home-server-supabase-heartbeat.timer --no-pager
systemctl list-timers home-server-supabase-heartbeat.timer --all
journalctl -u home-server-supabase-heartbeat.service -o cat -n 100
```

A oneshot service is normally `inactive (dead)` between runs. The timer should
be both `enabled` and `active`.

## Disaster recovery

On a replacement NUC:

1. Clone the repository into the intended production path.
2. Restore `config/sites.yaml` and the untracked `.env` from a secure backup.
3. Install dependencies and validate the site registry.
4. Run the installer without production flags:

```bash
cd ~/projects/home-server
pnpm install
pnpm validate:sites
sudo bash scripts/install-supabase-heartbeat-service.sh
```

The installer derives the checkout path, defaults to that checkout's `.env`,
uses the eight-hour production cadence, recreates the protective drop-ins, and
proves all configured heartbeats before completing. Secrets must still be
restored separately because they are intentionally excluded from Git.

## Troubleshooting

- `No enabled Supabase heartbeat sites configured.` means no enabled site has
  `supabaseHeartbeat.enabled: true`.
- `Supabase heartbeat env file does not exist` means the expected `.env` has not
  been restored or `HOME_SERVER_ENV_FILE` points to the wrong location.
- `environment variable is not set` means the site references an env var name
  that is missing from the service env file.
- `HTTP 404` usually means the heartbeat table does not exist or the table name
  in YAML is wrong.
- `HTTP 401/403` usually means the service role key is wrong or missing.
