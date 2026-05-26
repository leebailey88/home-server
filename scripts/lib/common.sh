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

load_env_file() {
  local env_file="$1"

  if [[ ! -f "${env_file}" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}
