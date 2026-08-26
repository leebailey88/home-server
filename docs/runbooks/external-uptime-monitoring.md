# External uptime monitoring

The NUC gateway monitor checks local upstreams, local Nginx routes, public routes, and cron logs from the NUC itself. That is useful, but it cannot alert if the NUC, Cloudflare Tunnel, DNS path, internet connection, or power is unavailable.

Run the external uptime monitor from a separate host such as a small DigitalOcean droplet. It reads `config/sites.yaml` and checks enabled `publicHealthChecks` for all enabled sites.

## What it checks

The external monitor checks only public URLs from `publicHealthChecks`, including expected HTTP status and optional `expectedBodyContains`.

It does not check local Nginx routes, Docker containers, cron logs, or Supabase heartbeats. Those remain NUC-local responsibilities.

If an endpoint fails its first request, the monitor waits five seconds by default and retries only that failed endpoint. A critical firing transition requires the same endpoint to fail again. One-off failures that clear on retry are retained in the journal as transient warnings but do not trigger Discord firing/recovery noise.

For HTTP or body mismatches, response diagnostics include available `server`, `cf-ray`, `cf-error-type`, and `cf-error-origin` headers. These make Cloudflare-generated failures such as 523 responses easier to attribute after the event.

The retry delay is configurable with `HOME_SERVER_EXTERNAL_MONITOR_RETRY_DELAY_MS`; the default is `5000`.

## Install on a droplet

Clone or pull this repo on the droplet, then run:

```bash
cd /opt/home-server
sudo bash scripts/install-external-uptime-monitor.sh
```

Edit the env file and add Discord webhook URLs:

```bash
sudo nano /etc/home-server-external-uptime-monitor.env
```

Existing installs do not need the retry setting added manually unless a non-default delay is desired; the monitor falls back to five seconds when the variable is absent.

Run one check manually:

```bash
sudo systemctl start home-server-external-uptime-monitor.service
sudo journalctl -u home-server-external-uptime-monitor.service -n 200 --no-pager
```

Check the timer:

```bash
systemctl status home-server-external-uptime-monitor.timer --no-pager
systemctl list-timers | grep home-server-external-uptime-monitor
```

## State and alert behavior

The monitor stores state in `/var/lib/home-server-external-monitor/state.json` by default.

It sends Discord alerts on:

- first persistent transition into failure after the confirmation retry
- newly persistent failing endpoint while already firing
- recovery after a prior persistent failure

A first-attempt failure that clears on retry remains visible in `journalctl` but leaves monitor state healthy. Repeated failed timer runs for the same persistent outage do not resend Discord alerts.

## Updating site checks

Update `config/sites.yaml` in this repo and deploy/pull that change onto the external droplet. The monitor uses the same `publicHealthChecks` list as the NUC gateway monitor, so public endpoint inventory stays centralized in one place.
