# Architecture

The home-server NUC uses a layered ingress model.

## Layers

1. **Cloudflare DNS / Tunnel**
   - Handles dynamic IP and avoids inbound router port forwarding.
   - Public hostnames route to local Nginx through `cloudflared`.
   - SSH remains a separate Cloudflare Access flow on `ssh.grizzlybulls.com`.

2. **Nginx local gateway**
   - Listens on `127.0.0.1:80` by default.
   - Routes by `Host` header.
   - Serves static sites directly or proxies to localhost-bound app containers.

3. **Apps / static roots**
   - Containers should bind to `127.0.0.1:<port>` only.
   - Static sites live under `/opt/nuc-web/sites/<site-key>/public`.

## Why this pattern

Cloudflare Tunnel is best at secure transport into the home network. Nginx is best at local host-based routing, static file serving, and consistent headers. Separating those concerns makes it easier to add sites without creating a new tunnel service for every app.

## Wildcard namespaces and exact app carve-outs

Wildcard hostnames may represent application-level tenant namespaces, but they do not own every possible hostname beneath the parent domain.

Altamont IQ uses `*.altamontiq.com` for tenant workspaces. `ingredients.altamontiq.com` is instead a standalone application and is modeled as its own exact `altamont-ingredients` site pointing at `127.0.0.1:8084`.

Keep exact standalone application entries separate from the wildcard site that surrounds them:

```text
ingredients.altamontiq.com → altamont-ingredients → 127.0.0.1:8084
*.altamontiq.com            → altamont-iq          → 127.0.0.1:8082
```

Nginx gives an exact `server_name` precedence over a wildcard `server_name`, so local routing sends the exact hostname to the standalone app. The site registry keeps the exact carve-out before the wildcard entry as an additional declaration of intent because generated Cloudflare Tunnel ingress rules are ordered. Today both web ingress rules terminate at the same local Nginx service, where the Host header is authoritative.

The application that owns the wildcard namespace should also reserve standalone/system subdomains at its own hostname-to-tenant boundary. Gateway routing is the primary separation; application-level reservation is defense in depth if traffic is ever misrouted around the exact Nginx server block.

## Safe rollout for a new proxied app

An enabled site immediately participates in gateway health checks, so bring up a new app in this order:

1. Deploy the application container bound to its assigned loopback port.
2. Verify its upstream health endpoint directly on `127.0.0.1`.
3. Confirm the public hostname is covered by Cloudflare DNS. An existing wildcard DNS record may already cover it; otherwise create an explicit proxied record/tunnel route.
4. Pull the `home-server` registry change onto the NUC.
5. Validate and install the generated Nginx and Cloudflare Tunnel configuration.
6. Run the gateway health check with public checks enabled.

Adding a hostname to `config/sites.yaml` generates tunnel ingress but does not itself create a Cloudflare DNS record.

## Initial site

Grizzly Bulls should begin as a preview hostname:

```text
nuc-grizzly.grizzlybulls.com → cloudflared → Nginx → http://127.0.0.1:8080
```

Only after validation should `grizzlybulls.com` and `www.grizzlybulls.com` move to the NUC.
