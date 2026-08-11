# NUC network path monitoring

The NUC gateway monitor includes a host-network check before it tests configured
application and public routes. This is intended to distinguish a local LAN or
Wi-Fi problem from an application, Nginx, DNS, or Cloudflare problem.

## What it checks

`scripts/check-network-health.mjs` discovers the active IPv4 default gateway and
interface, then sends a short burst of ICMP probes to that gateway. The default
sample is intentionally small enough to run every five minutes without creating
meaningful network load.

The check reports:

- packet loss to the default gateway
- average and maximum gateway latency
- the number of elevated and severe latency samples
- Wi-Fi SSID, BSSID, signal, RX/TX bitrate, and power-save state when the default
  interface is wireless
- `rx_dropped` and `tx_retry_failed` counters, plus deltas from the previous
  monitor sample when the state file is writable

The link counters are diagnostic context only. They do not independently fail a
health check because driver counter semantics vary. Gateway packet loss and
sustained latency are the alerting signals.

## Default thresholds

The defaults are designed to ignore an isolated Wi-Fi latency spike while
catching sustained local-path degradation:

```text
HOME_SERVER_NETWORK_PING_COUNT=12
HOME_SERVER_NETWORK_PING_INTERVAL_SECONDS=0.25
HOME_SERVER_NETWORK_PING_REPLY_TIMEOUT_SECONDS=1
HOME_SERVER_NETWORK_WARN_AVG_MS=25
HOME_SERVER_NETWORK_FAIL_AVG_MS=100
HOME_SERVER_NETWORK_WARN_SAMPLE_MS=100
HOME_SERVER_NETWORK_WARN_SAMPLE_COUNT=3
HOME_SERVER_NETWORK_FAIL_SAMPLE_MS=250
HOME_SERVER_NETWORK_FAIL_SAMPLE_COUNT=3
HOME_SERVER_NETWORK_FAIL_LOSS_PERCENT=25
```

A warning is written to the journal but does not fail the gateway monitor. A
failure returns non-zero, so the existing gateway retry/debounce runs the whole
check again before entering the critical firing state.

## Alert behavior

On failure, the network checker emits one `[FAIL]` line containing both the
threshold reason and current interface diagnostics. `monitor-gateway.sh`
already prioritizes `[FAIL]` and `[WARN]` lines in the Discord payload, so a
local network failure is surfaced as the likely root cause instead of only as a
list of public URL timeouts.

The external uptime monitor remains independent and continues to detect the
case where the NUC or its internet path is completely unreachable.

## State

Wi-Fi counter snapshots are stored at:

```text
/var/lib/home-server/network-health-metrics.json
```

The state file contains counters and capture time only. It is not an alert
state. If the check is run manually without permission to write the normal
state directory, monitoring still works and counter deltas are reported as
`n/a`.

## Manual validation

From the NUC checkout:

```bash
cd ~/projects/home-server
HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/check-health.sh
```

To run only the network portion:

```bash
node scripts/check-network-health.mjs
```

The healthy output starts with `[OK] host network path:`. A moderately elevated
sample starts with `[WARN]`, and sustained degradation starts with `[FAIL]` and
exits non-zero.

To inspect what the systemd gateway monitor recorded:

```bash
sudo journalctl -u home-server-gateway-monitor.service -o cat -n 200
```

## Disabling the check

The network check can be skipped without disabling the rest of gateway
monitoring:

```text
HOME_SERVER_SKIP_NETWORK_HEALTH_CHECKS=true
```

This is intended for hosts without a meaningful default-gateway probe. It
should remain `false` on the production NUC.

## Remediation policy

This monitor is deliberately observational. It does not restart NetworkManager,
reassociate Wi-Fi, restart `cloudflared`, or change routes. If repeated incidents
show a reliable self-healing action, remediation can be added separately with
its own cooldown and rollback protections.
