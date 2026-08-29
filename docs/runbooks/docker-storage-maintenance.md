# Docker storage maintenance

The NUC and Linux development machines can accumulate Docker build cache,
stopped containers, and dangling image layers over time. `home-server` installs
a conservative systemd timer that reclaims those categories without deleting
persistent volumes or tagged rollback images.

## Safety contract

The maintenance job intentionally limits itself to:

- unused build cache older than 7 days;
- stopped containers older than 30 days; and
- dangling images older than 7 days.

It intentionally does **not** run any of the following:

- `docker volume prune`;
- `docker system prune`;
- `docker image prune -a`; or
- direct deletion under `/var/lib/docker` or `/var/lib/containerd`.

This preserves named and anonymous volumes, tagged images that may be useful for
rollback, running containers, and images referenced by any container. The
30-day stopped-container retention also leaves a recovery window for recently
stopped workloads.

## Install the timer

On the NUC, `scripts/bootstrap-nuc.sh` installs the timer automatically. To
install or refresh it independently on any systemd-based Linux host or WSL
machine, run:

```bash
pnpm install:docker-storage-maintenance
```

The installer only installs and enables the timer. It does not run an immediate
cleanup.

Verify the timer with:

```bash
systemctl status home-server-docker-storage-maintenance.timer --no-pager
systemctl list-timers home-server-docker-storage-maintenance.timer --all
```

The default schedule is Sunday at 03:30 local time with up to 30 minutes of
randomized delay. `Persistent=true` means a host that was powered off at the
scheduled time runs the missed timer after systemd starts again.

## Run maintenance manually

Run the same production-safe maintenance policy immediately with:

```bash
pnpm docker:storage:maintain
```

The command prints `docker system df` before and after cleanup. It exits
successfully without changing anything if Docker is not installed or the daemon
is unavailable.

## Retention overrides

The defaults can be overridden for a one-off manual run or through the service
environment if a host needs a different policy:

```bash
sudo \
  HOME_SERVER_DOCKER_BUILD_CACHE_MAX_AGE=336h \
  HOME_SERVER_DOCKER_STOPPED_CONTAINER_MAX_AGE=1440h \
  HOME_SERVER_DOCKER_DANGLING_IMAGE_MAX_AGE=336h \
  bash scripts/docker-storage-maintenance.sh
```

Defaults are:

| Setting                                        | Default | Meaning                      |
| ---------------------------------------------- | ------: | ---------------------------- |
| `HOME_SERVER_DOCKER_BUILD_CACHE_MAX_AGE`       |  `168h` | unused build cache retention |
| `HOME_SERVER_DOCKER_STOPPED_CONTAINER_MAX_AGE` |  `720h` | stopped container retention  |
| `HOME_SERVER_DOCKER_DANGLING_IMAGE_MAX_AGE`    |  `168h` | dangling image retention     |

## Inspect a run

```bash
sudo journalctl -u home-server-docker-storage-maintenance.service -o cat -n 200
```

For a current Docker storage breakdown:

```bash
docker system df
sudo du -sh /var/lib/docker /var/lib/containerd 2> /dev/null || true
```

If disk usage remains unexpectedly high, inspect it before widening the prune
policy. Production cleanup should stay biased toward preserving volumes and
tagged images rather than reclaiming every theoretically unused Docker object.
