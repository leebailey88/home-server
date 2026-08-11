#!/usr/bin/env bash

# Extract stable identities from structured gateway failure lines. The identity
# deliberately excludes URLs, timing, and error details so the same check can be
# recognized across retries even when its diagnostic text changes.
gateway_failure_fingerprints() {
  local output="${1:-}"

  printf '%s\n' "${output}" \
    | sed -nE \
      -e 's/^\[FAIL\] ([^:]+):.*/check:\1/p' \
      -e 's/^\[home-server\]\[error\] (.*)$/error:\1/p' \
    | LC_ALL=C sort -u
}

# Intersect two newline-delimited, already-normalized fingerprint sets.
gateway_intersect_failure_fingerprints() {
  local first="${1:-}"
  local second="${2:-}"

  comm -12 \
    <(printf '%s\n' "${first}" | sed '/^$/d' | LC_ALL=C sort -u) \
    <(printf '%s\n' "${second}" | sed '/^$/d' | LC_ALL=C sort -u)
}

# Print one of:
#   persistent - at least one structured failure is present in both attempts
#   different  - both attempts are structured, but no failure identity repeats
#   unknown    - one attempt has no structured failure identity; fail closed
#
gateway_failure_correlation() {
  local first_output="${1:-}"
  local second_output="${2:-}"
  local first_fingerprints
  local second_fingerprints
  local persistent

  first_fingerprints="$(gateway_failure_fingerprints "${first_output}")"
  second_fingerprints="$(gateway_failure_fingerprints "${second_output}")"

  if [[ -z "${first_fingerprints}" || -z "${second_fingerprints}" ]]; then
    printf 'unknown\n'
    return 0
  fi

  persistent="$(
    gateway_intersect_failure_fingerprints \
      "${first_fingerprints}" \
      "${second_fingerprints}"
  )"

  if [[ -n "${persistent}" ]]; then
    printf 'persistent\n'
  else
    printf 'different\n'
  fi
}
