#!/usr/bin/env bash
set -euo pipefail

SFTP_USER="${CBP_SFTP_USER:-cbp-evabank-upload}"
SFTP_GROUP="${CBP_SFTP_GROUP:-cbp-sftp}"
SFTP_PORT="${CBP_SFTP_PORT:-2222}"
CHROOT_DIR="${CBP_SFTP_CHROOT:-/srv/cbp-sftp}"
BANK_SLUG="${CBP_BANK_SLUG:-evabank}"
SPOOL_DIR="${CBP_SFTP_SPOOL_DIR:-/opt/community-bank-pilot/sftp-spool/${BANK_SLUG}}"
AUTHORIZED_KEYS_DIR="${CBP_AUTHORIZED_KEYS_DIR:-/etc/ssh/cbp-sftp/${SFTP_USER}}"
PUBLIC_KEY="${CBP_EVABANK_PUBLIC_KEY:-}"
SOURCE_CIDR="${CBP_EVABANK_SOURCE_CIDR:-}"
SSHD_DROPIN="/etc/ssh/sshd_config.d/70-cbp-sftp.conf"
LOG_DIR="/var/log/cbp-sftp"

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "ERROR: run this script with sudo." >&2
    echo "Example:" >&2
    echo "  sudo CBP_EVABANK_PUBLIC_KEY='ssh-ed25519 AAAA... evabank-dashboard-upload' bash scripts/setup-cbp-sftp.sh" >&2
    exit 1
  fi
}

install_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server coreutils findutils
}

create_user_and_dirs() {
  getent group "${SFTP_GROUP}" >/dev/null || groupadd --system "${SFTP_GROUP}"

  if ! id "${SFTP_USER}" >/dev/null 2>&1; then
    useradd \
      --system \
      --gid "${SFTP_GROUP}" \
      --home-dir "${CHROOT_DIR}" \
      --shell /usr/sbin/nologin \
      "${SFTP_USER}"
  else
    usermod --gid "${SFTP_GROUP}" --home "${CHROOT_DIR}" --shell /usr/sbin/nologin "${SFTP_USER}"
  fi

  passwd -l "${SFTP_USER}" >/dev/null || true

  # OpenSSH requires the chroot and each parent component to be root-owned and not writable by the SFTP user.
  install -d -o root -g root -m 0755 "${CHROOT_DIR}"
  install -d -o root -g root -m 0755 "${CHROOT_DIR}/incoming"
  install -d -o "${SFTP_USER}" -g "${SFTP_GROUP}" -m 0750 "${CHROOT_DIR}/incoming/${BANK_SLUG}"

  install -d -o root -g root -m 0755 "${SPOOL_DIR}"
  install -d -o root -g root -m 0755 "${LOG_DIR}"

  install -d -o root -g root -m 0755 "${AUTHORIZED_KEYS_DIR}"
  touch "${AUTHORIZED_KEYS_DIR}/authorized_keys"
  chown root:root "${AUTHORIZED_KEYS_DIR}/authorized_keys"
  chmod 0644 "${AUTHORIZED_KEYS_DIR}/authorized_keys"

  if [[ -n "${PUBLIC_KEY}" ]]; then
    if ! grep -qxF "${PUBLIC_KEY}" "${AUTHORIZED_KEYS_DIR}/authorized_keys"; then
      printf '%s\n' "${PUBLIC_KEY}" >>"${AUTHORIZED_KEYS_DIR}/authorized_keys"
    fi
  elif ! grep -q "PASTE_EVABANK_PUBLIC_KEY_HERE" "${AUTHORIZED_KEYS_DIR}/authorized_keys"; then
    cat >>"${AUTHORIZED_KEYS_DIR}/authorized_keys" <<'KEYNOTE'
# PASTE_EVABANK_PUBLIC_KEY_HERE
# Example:
# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... evabank-dashboard-upload
KEYNOTE
  fi
}

write_sshd_config() {
  local match_line

  if [[ -n "${SOURCE_CIDR}" ]]; then
    match_line="Match User ${SFTP_USER} Address ${SOURCE_CIDR}"
  else
    match_line="Match User ${SFTP_USER}"
  fi

  cat >"${SSHD_DROPIN}" <<CONF
# Managed by home-server/scripts/setup-cbp-sftp.sh
# Community Bank Pilot restricted SFTP endpoint.

Port 22
Port ${SFTP_PORT}

${match_line}
    ChrootDirectory ${CHROOT_DIR}
    ForceCommand internal-sftp -d /incoming/${BANK_SLUG} -u 007
    AuthorizedKeysFile ${AUTHORIZED_KEYS_DIR}/authorized_keys
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PubkeyAuthentication yes
    PermitTunnel no
    AllowAgentForwarding no
    AllowTcpForwarding no
    X11Forwarding no
    PermitTTY no
CONF

  sshd -t
  systemctl enable ssh
  systemctl restart ssh
}

write_spooler() {
  cat >/usr/local/bin/cbp-sftp-spool.sh <<'SPOOL'
#!/usr/bin/env bash
set -euo pipefail

BANK_SLUG="${CBP_BANK_SLUG:-evabank}"
CHROOT_DIR="${CBP_SFTP_CHROOT:-/srv/cbp-sftp}"
INCOMING_DIR="${CHROOT_DIR}/incoming/${BANK_SLUG}"
SPOOL_DIR="${CBP_SFTP_SPOOL_DIR:-/opt/community-bank-pilot/sftp-spool/${BANK_SLUG}}"
LOG_FILE="/var/log/cbp-sftp/spool.log"

mkdir -p "${SPOOL_DIR}" "$(dirname "${LOG_FILE}")"

required_files=("GL DASH" "CD DASH" "LN DASH")

for file_name in "${required_files[@]}"; do
  if [[ ! -f "${INCOMING_DIR}/${file_name}" ]]; then
    exit 0
  fi
done

# Avoid copying while the client may still be uploading.
now_epoch="$(date +%s)"
for file_name in "${required_files[@]}"; do
  modified_epoch="$(stat -c %Y "${INCOMING_DIR}/${file_name}")"
  age_seconds=$((now_epoch - modified_epoch))
  if ((age_seconds < 90)); then
    exit 0
  fi
done

batch_id="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${SPOOL_DIR}/${batch_id}"
mkdir -p "${destination}"

for file_name in "${required_files[@]}"; do
  cp -p "${INCOMING_DIR}/${file_name}" "${destination}/${file_name}"
done

(
  cd "${destination}"
  sha256sum "GL DASH" "CD DASH" "LN DASH" >SHA256SUMS.txt
)

cat >"${destination}/manifest.json" <<JSON
{
  "bank": "${BANK_SLUG}",
  "received_at_utc": "${batch_id}",
  "source": "evabank-bankers-dashboard-parallel-sftp",
  "files": ["GL DASH", "CD DASH", "LN DASH"]
}
JSON

rm -f "${INCOMING_DIR}/GL DASH" "${INCOMING_DIR}/CD DASH" "${INCOMING_DIR}/LN DASH"

echo "$(date -Is) spooled complete batch ${batch_id} to ${destination}" >>"${LOG_FILE}"
SPOOL

  chmod 0755 /usr/local/bin/cbp-sftp-spool.sh

  cat >/etc/systemd/system/cbp-sftp-spool.service <<SERVICE
[Unit]
Description=Community Bank Pilot SFTP spooler

[Service]
Type=oneshot
Environment=CBP_BANK_SLUG=${BANK_SLUG}
Environment=CBP_SFTP_CHROOT=${CHROOT_DIR}
Environment=CBP_SFTP_SPOOL_DIR=${SPOOL_DIR}
ExecStart=/usr/local/bin/cbp-sftp-spool.sh
SERVICE

  cat >/etc/systemd/system/cbp-sftp-spool.timer <<'TIMER'
[Unit]
Description=Run Community Bank Pilot SFTP spooler every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Unit=cbp-sftp-spool.service

[Install]
WantedBy=timers.target
TIMER

  systemctl daemon-reload
  systemctl enable --now cbp-sftp-spool.timer
}

configure_ufw_if_active() {
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    if [[ -n "${SOURCE_CIDR}" ]]; then
      ufw allow from "${SOURCE_CIDR}" to any port "${SFTP_PORT}" proto tcp comment "CBP EvaBank SFTP"
    else
      ufw allow "${SFTP_PORT}/tcp" comment "CBP EvaBank SFTP"
    fi
  fi
}

print_summary() {
  echo
  echo "CBP SFTP setup complete."
  echo
  echo "SFTP user:        ${SFTP_USER}"
  echo "SFTP port:        ${SFTP_PORT}"
  echo "Chroot:           ${CHROOT_DIR}"
  echo "Upload directory: /incoming/${BANK_SLUG}"
  echo "Server path:      ${CHROOT_DIR}/incoming/${BANK_SLUG}"
  echo "Spool directory:  ${SPOOL_DIR}"
  echo "Authorized keys:  ${AUTHORIZED_KEYS_DIR}/authorized_keys"
  echo
  echo "Server host key fingerprints to give EvaBank:"
  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256 || true
  ssh-keygen -lf /etc/ssh/ssh_host_rsa_key.pub -E sha256 || true
  echo
  echo "Status checks:"
  echo "  sudo systemctl status ssh --no-pager"
  echo "  sudo systemctl status cbp-sftp-spool.timer --no-pager"
  echo "  sudo tail -f /var/log/cbp-sftp/spool.log"
  echo
  echo "Local connection test after adding a client public key:"
  echo "  sftp -P ${SFTP_PORT} ${SFTP_USER}@127.0.0.1"
}

main() {
  require_root
  install_packages
  create_user_and_dirs
  write_sshd_config
  write_spooler
  configure_ufw_if_active
  print_summary
}

main "$@"
