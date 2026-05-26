#!/usr/bin/env bash
set -euo pipefail

mapfile -t shell_files < <(find scripts -type f -name '*.sh' | sort)

if [[ ${#shell_files[@]} -eq 0 ]]; then
  echo "No shell files found."
  exit 0
fi

if command -v shellcheck > /dev/null 2>&1; then
  shellcheck "${shell_files[@]}"
else
  echo "shellcheck not installed; using bash -n fallback."
  for file in "${shell_files[@]}"; do
    bash -n "${file}"
  done
fi
