#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

BUILD_CACHE_MAX_AGE="${HOME_SERVER_DOCKER_BUILD_CACHE_MAX_AGE:-168h}"
STOPPED_CONTAINER_MAX_AGE="${HOME_SERVER_DOCKER_STOPPED_CONTAINER_MAX_AGE:-720h}"
DANGLING_IMAGE_MAX_AGE="${HOME_SERVER_DOCKER_DANGLING_IMAGE_MAX_AGE:-168h}"
LOCK_FILE="${HOME_SERVER_DOCKER_STORAGE_LOCK_FILE:-/run/lock/home-server-docker-storage-maintenance.lock}"

if ! command -v docker > /dev/null 2>&1; then
  warn "Docker CLI is not installed; skipping storage maintenance."
  exit 0
fi

if ! docker info > /dev/null 2>&1; then
  warn "Docker daemon is unavailable; skipping storage maintenance."
  exit 0
fi

if command -v flock > /dev/null 2>&1; then
  exec 9> "${LOCK_FILE}"
  if ! flock -n 9; then
    log "Docker storage maintenance is already running; skipping duplicate invocation."
    exit 0
  fi
fi

log "Docker storage before maintenance:"
docker system df || true

log "Pruning unused build cache older than ${BUILD_CACHE_MAX_AGE}..."
docker builder prune -af --filter "until=${BUILD_CACHE_MAX_AGE}"

log "Pruning stopped containers older than ${STOPPED_CONTAINER_MAX_AGE}..."
docker container prune -f --filter "until=${STOPPED_CONTAINER_MAX_AGE}"

log "Pruning dangling images older than ${DANGLING_IMAGE_MAX_AGE}..."
docker image prune -f --filter "until=${DANGLING_IMAGE_MAX_AGE}"

log "Docker storage after maintenance:"
docker system df || true

log "Docker storage maintenance complete. Volumes and tagged unused images were intentionally preserved."
