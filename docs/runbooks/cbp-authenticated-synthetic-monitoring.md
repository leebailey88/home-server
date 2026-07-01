# Community Bank Pilot authenticated synthetic monitoring

This monitor verifies that Community Bank Pilot is not merely reachable, but usable by a synthetic banker user through the public production path.

It should run from a non-NUC host, such as a DigitalOcean droplet. The NUC-local gateway monitor checks containers, Nginx, Cloudflared, cron logs, and local/public routes. The external uptime monitor checks public URLs. This synthetic monitor adds an authenticated browser workflow.

## What it checks

The default smoke flow:

1. Opens the tenant login page.
2. Signs in with a dedicated synthetic user.
3. Confirms the dashboard contains `Executive command center`.
4. Visits read-only report pages:
   - `/reports/balance-sheet`
   - `/reports/income-statement`
   - `/reports/packages`
   - `/reports/import`

The monitor intentionally avoids mutating production data. Do not add request-demo submission, imports, data edits, or billing actions to the recurring monitor.

## Install on the droplet

From the `home-server` repo on the droplet:

```bash
git checkout main
git pull --ff-only origin main
pnpm install --frozen-lockfile

sudo bash scripts/install-cbp-synthetic-monitor.sh
```

The installer creates:

- `/etc/home-server-cbp-synthetic-monitor.env`
- `/etc/systemd/system/home-server-cbp-synthetic-monitor.service`
- `/etc/systemd/system/home-server-cbp-synthetic-monitor.timer`
- `/var/lib/home-server-synthetic-monitor`
- `/var/log/home-server-synthetic-monitor`

It also installs Playwright Chromium.

## Configure

```bash
sudo nano /etc/home-server-cbp-synthetic-monitor.env
```

Required values:

```bash
CBP_SYNTHETIC_BASE_URL=https://communitybankpilot.com
CBP_SYNTHETIC_TENANT_SLUG=REPLACE_WITH_TENANT_SLUG
CBP_SYNTHETIC_EMAIL=REPLACE_WITH_SYNTHETIC_USER_EMAIL
CBP_SYNTHETIC_PASSWORD=REPLACE_WITH_SYNTHETIC_USER_PASSWORD
DISCORD_MONITOR_CRITICAL_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_MONITOR_RECOVERY_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_MONITOR_WARNING_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

If tenant routing needs a fully explicit origin, set:

```bash
CBP_SYNTHETIC_TENANT_URL=https://tenant.communitybankpilot.com
```

## Test

```bash
sudo systemctl start home-server-cbp-synthetic-monitor.service
sudo journalctl -u home-server-cbp-synthetic-monitor.service -n 200 --no-pager
```

## Timer

```bash
systemctl status home-server-cbp-synthetic-monitor.timer --no-pager
systemctl list-timers | grep cbp-synthetic
```

Default cadence is every 15 minutes. Override during install:

```bash
sudo CBP_SYNTHETIC_MONITOR_INTERVAL=30min bash scripts/install-cbp-synthetic-monitor.sh
```

## Alert behavior

The monitor keeps state in:

```text
/var/lib/home-server-synthetic-monitor/cbp-authenticated-smoke-state.json
```

It sends Discord alerts on first failure, changed failure message, and recovery.

Screenshots from failed browser runs are written to:

```text
/var/log/home-server-synthetic-monitor
```

## Safe failure test

Temporarily set an impossible expected dashboard text:

```bash
sudo sed -i 's/^CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=.*/CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=THIS_TEXT_SHOULD_NOT_EXIST/' /etc/home-server-cbp-synthetic-monitor.env
sudo systemctl start home-server-cbp-synthetic-monitor.service
```

Confirm a Discord failure alert, then restore:

```bash
sudo sed -i 's/^CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=.*/CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=Executive command center/' /etc/home-server-cbp-synthetic-monitor.env
sudo systemctl start home-server-cbp-synthetic-monitor.service
```

Confirm a Discord recovery alert.
