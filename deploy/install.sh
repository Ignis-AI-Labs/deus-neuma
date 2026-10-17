#!/usr/bin/env bash
# Neuma systemd service installer
# Usage: sudo ./deploy/install.sh [install|uninstall|status]

set -euo pipefail

SERVICE_NAME="neuma"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
INSTALL_DIR="/opt/neuma"
SERVICE_USER="neuma"

usage() {
  echo "Usage: sudo $0 [install|uninstall|status]"
  echo ""
  echo "  install    Create system user, install service file, enable service"
  echo "  uninstall  Stop and disable service, remove service file"
  echo "  status     Show current service status"
  exit 1
}

require_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "Error: This script must be run as root (sudo)"
    exit 1
  fi
}

cmd_install() {
  require_root
  echo "Installing Neuma service..."

  # Create system user (no login shell, no home dir)
  if ! id -u "${SERVICE_USER}" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
    echo "Created system user: ${SERVICE_USER}"
  else
    echo "User ${SERVICE_USER} already exists"
  fi

  # Ensure install directory exists and is owned correctly
  if [[ ! -d "${INSTALL_DIR}" ]]; then
    echo "Error: ${INSTALL_DIR} does not exist. Deploy your application there first."
    exit 1
  fi

  # Create writable directories
  for dir in workspaces vault vault/dna vault/audit data data/temp data/dna-cache data/memory-store data/marketplace uploads; do
    mkdir -p "${INSTALL_DIR}/${dir}"
  done
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}/workspaces" "${INSTALL_DIR}/vault" "${INSTALL_DIR}/data" "${INSTALL_DIR}/uploads"

  # Copy service file
  cp "$(dirname "$0")/neuma.service" "${SERVICE_FILE}"
  echo "Installed service file: ${SERVICE_FILE}"

  # Reload systemd and enable service
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  echo "Service enabled. Start with: sudo systemctl start ${SERVICE_NAME}"
}

cmd_uninstall() {
  require_root
  echo "Uninstalling Neuma service..."

  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true

  if [[ -f "${SERVICE_FILE}" ]]; then
    rm "${SERVICE_FILE}"
    systemctl daemon-reload
    echo "Service file removed"
  fi

  echo "Uninstall complete. User '${SERVICE_USER}' and ${INSTALL_DIR} were NOT removed."
}

cmd_status() {
  systemctl status "${SERVICE_NAME}" --no-pager 2>/dev/null || echo "Service not found or not running"
}

case "${1:-}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  *)         usage ;;
esac
