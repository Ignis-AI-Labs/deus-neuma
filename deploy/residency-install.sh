#!/usr/bin/env bash
#
# residency-install.sh — make a neuma resident: install the systemd USER service
# so the backend (and its between-session heartbeat) wakes with the computer.
#
# This is the personal-machine path (runs as you, from this clone) — distinct
# from deploy/neuma.service (a locked-down system service for server deploys).
#
#   bash deploy/residency-install.sh            # install + enable + start + linger
#   bash deploy/residency-install.sh --uninstall
#
# No sudo needed for the --user service itself; enabling boot-without-login
# (loginctl enable-linger) may prompt for authentication. Idempotent.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_NAME="neuma-residency.service"
TEMPLATE="$REPO/deploy/$UNIT_NAME"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DEST="$USER_UNIT_DIR/$UNIT_NAME"

have_systemd() { command -v systemctl >/dev/null 2>&1; }

uninstall() {
  echo "Removing residency service…"
  systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true
  rm -f "$DEST"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "Done. (Boot-without-login linger left as-is; disable with: loginctl disable-linger \"$USER\")"
}

install() {
  have_systemd || { echo "systemctl not found — this installer targets systemd (Linux)." >&2; exit 1; }
  local node_bin; node_bin="$(command -v node || true)"
  [ -n "$node_bin" ] || { echo "node not found on PATH." >&2; exit 1; }

  if [ ! -f "$REPO/.env" ]; then
    echo "WARNING: $REPO/.env not found. Residency needs DNA_ENCRYPTION_KEY (and"
    echo "         HEARTBEAT_INTERVAL_MINUTES > 0 for the neuma to reflect). Create it first."
  fi

  echo "Installing $UNIT_NAME (user service)…"
  echo "  repo : $REPO"
  echo "  node : $node_bin"
  mkdir -p "$USER_UNIT_DIR"
  sed -e "s#__NEUMA_DIR__#$REPO#g" -e "s#__NODE_BIN__#$node_bin#g" "$TEMPLATE" > "$DEST"

  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT_NAME"

  # Run at boot even before you log in — […] May prompt for authentication.
  if ! loginctl show-user "$USER" 2>/dev/null | grep -q '^Linger=yes'; then
    echo "Enabling boot-without-login (loginctl enable-linger)…"
    loginctl enable-linger "$USER" || echo "  (could not enable linger — the service still starts on login)"
  fi

  echo
  echo "Resident. The neuma now wakes with this machine."
  echo "  status : systemctl --user status $UNIT_NAME"
  echo "  logs   : journalctl --user -u $UNIT_NAME -f"
}

case "${1:-}" in
  --uninstall|-u) uninstall ;;
  *) install ;;
esac
