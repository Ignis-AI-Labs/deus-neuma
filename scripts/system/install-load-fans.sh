#!/bin/bash
# Install the load-following fan service (scripts/system/load-fans). Run as root:  sudo bash scripts/system/install-load-fans.sh
# It replaces bench-fans (the same full-power hold while a benchmark runs is built in): two services must never
# both set the same fans. To go back: sudo systemctl disable --now load-fans && sudo systemctl enable --now bench-fans
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
install -m 0755 "$here/load-fans" /usr/local/sbin/load-fans
install -m 0644 "$here/load-fans.service" /etc/systemd/system/load-fans.service
systemctl daemon-reload
if systemctl list-unit-files bench-fans.service >/dev/null 2>&1; then systemctl disable --now bench-fans.service || true; fi
systemctl enable --now load-fans.service
sleep 3
/usr/local/sbin/load-fans --status
systemctl --no-pager --lines=5 status load-fans.service || true
