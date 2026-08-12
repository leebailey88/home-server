# Wi-Fi self-healing runbook

The NUC installs a conservative Wi-Fi recovery watchdog during bootstrap. Its
purpose is to recover from a pathological receive-side wireless state without
encoding machine-specific interface names, SSIDs, BSSIDs, or router hardware in
Git.

The watchdog is intentionally independent from application health. It only
reactivates the active NetworkManager profile when both the local gateway path
and Wi-Fi receive diagnostics agree that the host network is degraded.

## What triggers recovery

`home-server-wifi-recovery.service` runs on a two-minute timer by default. Each
run discovers the IPv4 default route, then exits without action unless that
route is an associated Wi-Fi interface.

A check is considered recovery-eligible only when both conditions are true:

1. the default gateway is `warn` or `fail` under the same latency/loss policy as
   `scripts/check-network-health.mjs`; and
2. receive-side Wi-Fi evidence is abnormal: either the current RX bitrate is at
   or below the configured floor, or the driver `rx_dropped` counter increased
   by at least the configured threshold since the prior check.

The default thresholds are:

```text
HOME_SERVER_WIFI_RECOVERY_CONSECUTIVE_BAD=2
HOME_SERVER_WIFI_RECOVERY_MAX_EVIDENCE_GAP_SECONDS=300
HOME_SERVER_WIFI_RECOVERY_COOLDOWN_SECONDS=1800
HOME_SERVER_WIFI_RECOVERY_MAX_RX_MBPS=12
HOME_SERVER_WIFI_RECOVERY_MIN_RX_DROPPED_DELTA=5000
```

A low RX bitrate by itself is never enough to trigger recovery because an idle
Wi-Fi link can legitimately report a low last-frame rate. Likewise, gateway
latency without receive-side evidence does not automatically bounce Wi-Fi.
Both signals must persist across two checks. Evidence older than the configured
maximum gap is discarded, and a check that finds Ethernet or no usable Wi-Fi
default route resets the consecutive-failure counter.

## Recovery action

Once the consecutive-failure threshold is reached, the watchdog discovers the
active NetworkManager connection name and runs the equivalent of:

```bash
nmcli --wait 20 connection up <active-connection> ifname <default-route-interface>
```

Arguments are passed directly to `nmcli`; no connection name is evaluated by a
shell. After reactivation, the watchdog waits briefly, reruns gateway and Wi-Fi
diagnostics, and records whether the path recovered.

A successful or attempted recovery starts the cooldown. This prevents a broken
router, ISP path, or unrecoverable adapter from causing a reconnect loop.

## Ethernet behavior

There is no Wi-Fi-specific host identity in the configuration. If Ethernet is
the IPv4 default route, the watchdog logs a skip and performs no action. This
allows a replacement NUC to use wired networking without changing the repo.

## Install or update

Bootstrap installs and enables the watchdog automatically:

```bash
sudo bash scripts/bootstrap-nuc.sh
```

To install or refresh only the recovery units on an existing host:

```bash
sudo HOME_SERVER_ENV_FILE="$(pwd)/.env" \
  bash scripts/install-network-recovery-service.sh
```

The installed units are:

```text
home-server-wifi-recovery.service
home-server-wifi-recovery.timer
```

The installer enables the timer but deliberately does not force an immediate
profile reactivation. A normal timer run must first collect enough evidence to
meet the consecutive-failure policy.

## Verify

Check the timer:

```bash
sudo systemctl status home-server-wifi-recovery.timer --no-pager
sudo systemctl list-timers home-server-wifi-recovery.timer --all
```

Run one evaluation manually:

```bash
sudo systemctl start home-server-wifi-recovery.service
sudo journalctl -u home-server-wifi-recovery.service -o cat -n 100
```

Inspect the current default-route link directly:

```bash
ip -4 route show default
iw dev <wifi-interface> link
sudo ethtool -S <wifi-interface> | grep -E 'rx_dropped|tx_retry_failed|tx_retries'
```

Runtime state is stored at:

```text
/var/lib/home-server/wifi-self-heal.json
```

The state file contains only operational counters/timestamps and the discovered
interface name. It does not contain Wi-Fi credentials.

## Configuration

The service loads the normal home-server `.env` when present. Supported Wi-Fi
recovery settings are:

```text
HOME_SERVER_WIFI_RECOVERY_ENABLED=true
HOME_SERVER_WIFI_RECOVERY_ON_BOOT_SEC=4min
HOME_SERVER_WIFI_RECOVERY_INTERVAL=2min
HOME_SERVER_WIFI_RECOVERY_CONSECUTIVE_BAD=2
HOME_SERVER_WIFI_RECOVERY_MAX_EVIDENCE_GAP_SECONDS=300
HOME_SERVER_WIFI_RECOVERY_COOLDOWN_SECONDS=1800
HOME_SERVER_WIFI_RECOVERY_MAX_RX_MBPS=12
HOME_SERVER_WIFI_RECOVERY_MIN_RX_DROPPED_DELTA=5000
HOME_SERVER_WIFI_RECOVERY_POST_WAIT_SECONDS=5
```

Gateway evaluation uses the existing `HOME_SERVER_NETWORK_*` ping and threshold
settings so monitoring and recovery do not disagree about what degraded means.

Disable only automatic Wi-Fi recovery with:

```text
HOME_SERVER_WIFI_RECOVERY_ENABLED=false
```

Then restart the timer or wait for the next invocation. To disable the timer
entirely:

```bash
sudo systemctl disable --now home-server-wifi-recovery.timer
```

## Replacement NUC

The recovery policy is repo-managed and therefore follows the normal
replacement-host bootstrap process. Wi-Fi credentials do not belong in Git and
must still be provisioned on the replacement host before it can join the LAN or
clone the repository.

No old BSSID should be copied to a replacement host. Once the replacement has a
working NetworkManager connection, bootstrap installs the same self-healing
policy and dynamically discovers its interface, connection profile, gateway,
and active access point.
