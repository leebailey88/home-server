# Static site lifecycle runbook

Static sites are deployed atomically using release directories and a `current` symlink.

## Site registry shape

A static site should look like this in `config/sites.yaml`:

```yaml
sites:
  - key: example-static
    enabled: true
    kind: static
    hostnames:
      - example.grizzlybulls.com
    deployRoot: /opt/nuc-web/sites/example-static
    root: /opt/nuc-web/sites/example-static/current
    index: index.html
```

Nginx serves `root`, while deploy tooling writes releases under `deployRoot`:

```text
/opt/nuc-web/sites/example-static/
  current -> releases/20260526024512-lee
  releases/
    20260526024512-lee/
      index.html
      assets/...
      .home-server-release.json
```

## Deploy a static build

Build the static site first in its own repo, then deploy the build output from the NUC or from a checkout that has access to the build directory:

```bash
pnpm static:deploy example-static /path/to/build-output --keep=5
```

The source directory must contain the configured `index` file, usually `index.html`.

The deploy command:

1. validates the site registry
2. confirms the site is enabled and `kind: static`
3. creates a timestamped release directory
4. copies the build output into the release
5. writes `.home-server-release.json`
6. atomically moves `current` to the new release
7. prunes old releases beyond `--keep`

## List releases

```bash
pnpm static:list example-static
```

The current release is marked with `*`.

## Roll back

Choose a release name from the list, then run:

```bash
pnpm static:rollback example-static 20260526024512-lee
```

Rollback only moves the `current` symlink. It does not modify old release directories.

## Validate after deploy or rollback

```bash
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/install-nginx-config.sh
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/check-health.sh
curl -fsS -H 'Host: example.grizzlybulls.com' http://127.0.0.1/
```

If the site is already in Nginx and only static files changed, a Nginx reinstall is usually unnecessary. Run the health check either way.

## Permissions

If deploying into `/opt/nuc-web/sites`, the deploy user needs write access to the specific site's deploy root. One simple pattern is:

```bash
sudo mkdir -p /opt/nuc-web/sites/example-static
sudo chown -R "$USER:$USER" /opt/nuc-web/sites/example-static
```

Do not make the whole `/opt/nuc-web` tree world-writable.
