# home-server

Infrastructure tooling for the Grizzly Bulls home-server NUC.

This repo is intended to manage the shared web gateway layer for a home-hosted NUC that runs multiple mostly-static sites and app containers behind Cloudflare Tunnel.

## Goals

- Keep all public web traffic behind Cloudflare Tunnel.
- Route multiple hostnames through one local Nginx reverse proxy.
- Keep app containers bound to `127.0.0.1` only.
- Make site routing declarative through `config/sites.yaml`.
- Provide lightweight health checks and repeatable bootstrap scripts.
- Avoid interfering with the existing `money-bot` Docker instances and IB Gateway containers.

## Target architecture

```text
Internet
  ↓
Cloudflare DNS / Access / Tunnel
  ↓
cloudflared on the NUC
  ↓
Nginx on the NUC
  ↓
localhost-bound apps and static roots
    - grizzly-bulls       127.0.0.1:8080
    - future-static-site  /opt/nuc-web/sites/<site>/public
    - future-next-site    127.0.0.1:8081
```

## Repo layout

```text
config/
  sites.example.yaml          Example declarative site registry
  cloudflared.example.yml     Example Cloudflare Tunnel ingress config
nginx/
  templates/                  Nginx server block templates
scripts/
  bootstrap-nuc.sh            Installs base host packages for the web gateway
  render-nginx-config.mjs     Generates Nginx config from sites.yaml
  install-nginx-config.sh     Installs rendered config and reloads Nginx
  check-health.sh             Checks Nginx, cloudflared, and configured upstreams
  lib/common.sh               Shared shell helpers
docs/
  architecture.md             System design notes
  runbooks/bootstrap-nuc.md   First-host setup steps
```

## Quick start

Install dependencies locally:

```bash
corepack enable
pnpm install
```

Create your real site registry from the example:

```bash
cp config/sites.example.yaml config/sites.yaml
```

Render Nginx config locally for inspection:

```bash
pnpm render:nginx
```

Validate formatting and scripts:

```bash
pnpm validate
```

On the NUC, once this repo is cloned:

```bash
sudo bash scripts/bootstrap-nuc.sh
sudo bash scripts/install-nginx-config.sh
sudo bash scripts/check-health.sh
```

## Initial production convention

Reserve ports like this unless there is a strong reason to change them:

|  Port | Service                                        |
| ----: | ---------------------------------------------- |
|  8080 | Grizzly Bulls                                  |
|  8081 | Static site / future app #1                    |
|  8082 | Static site / future app #2                    |
| 8090+ | Internal/admin tools                           |
|  400x | Existing money-bot / IB Gateway host API ports |

Keep public HTTP ports closed. Nginx should listen on localhost and receive traffic from `cloudflared`.

## Safety notes

- Do not bind app containers to `0.0.0.0` unless deliberately exposing on LAN.
- Prefer `127.0.0.1:<port>` for every app container.
- Keep SSH Cloudflare Access separate from web hostnames.
- Stage Grizzly Bulls at `nuc-grizzly.grizzlybulls.com` before moving production DNS.
- Keep the existing production droplet available until NUC hosting has run cleanly for several days.
