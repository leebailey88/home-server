#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[home-server] %s\n' "$*"
}

warn() {
  printf '[home-server][warn] %s\n' "$*" >&2
}

fail() {
  printf '[home-server][error] %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Please run as root: sudo bash $0"
  fi
}

repo_root() {
  git rev-parse --show-toplevel 2> /dev/null || pwd
}
