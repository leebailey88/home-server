# Community Bank Pilot SFTP Endpoint

This NUC exposes a restricted SFTP dropbox for EvaBank's Banker's Dashboard parallel pilot.

## Purpose

EvaBank's existing nightly Banker's Dashboard process generates these files:

- `GL DASH`
- `CD DASH`
- `LN DASH`

The bank uploads a parallel copy of those files to this endpoint. The NUC then spools complete three-file batches into:

```text
/opt/community-bank-pilot/sftp-spool/evabank/<UTC batch id>/
```

Each complete batch includes:

- `GL DASH`
- `CD DASH`
- `LN DASH`
- `SHA256SUMS.txt`
- `manifest.json`

## Install or re-install

From the home-server repo:

```bash
sudo bash scripts/setup-cbp-sftp.sh
```

With EvaBank's public key:

```bash
sudo CBP_EVABANK_PUBLIC_KEY='ssh-ed25519 AAAA... evabank-dashboard-upload' bash scripts/setup-cbp-sftp.sh
```

With EvaBank source-IP restriction:

```bash
sudo CBP_EVABANK_SOURCE_CIDR='x.x.x.x/32' \
  CBP_EVABANK_PUBLIC_KEY='ssh-ed25519 AAAA... evabank-dashboard-upload' \
  bash scripts/setup-cbp-sftp.sh
```

## Defaults

```text
User: cbp-evabank-upload
Port: 2222
Chroot: /srv/cbp-sftp
Upload folder visible to client: /incoming/evabank
Authorized keys: /etc/ssh/cbp-sftp/cbp-evabank-upload/authorized_keys
Spool directory: /opt/community-bank-pilot/sftp-spool/evabank
```

## Router and firewall

For direct NUC SFTP, forward external TCP `2222` to the NUC's TCP `2222`.

Prefer restricting the source to EvaBank's outbound IP address if the router or firewall supports it.

Cloudflare Tunnel is usually not enough for a normal bank SFTP client because this is plain TCP SFTP, not an HTTP site.

## Status checks

```bash
sudo systemctl status ssh --no-pager
sudo systemctl status cbp-sftp-spool.timer --no-pager
sudo tail -f /var/log/cbp-sftp/spool.log
```

## Host key fingerprints

Give EvaBank the server host key fingerprint shown by:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

## Local test

After adding a client public key, test from the NUC:

```bash
sftp -P 2222 cbp-evabank-upload@127.0.0.1
```

A successful login should land in `/incoming/evabank` and should not provide shell access.

## External test

Before sending anything to EvaBank, test from outside the LAN using the public host/IP and port `2222`.

## Operational note

The SFTP account is chrooted, key-only, and has no shell, TTY, tunnel, agent-forwarding, X11, or TCP-forwarding access. The writable directory is still a dropbox-style directory, so do not treat it as a general-purpose file share. The spooler copies complete batches and removes the three uploaded files after they have been archived.
