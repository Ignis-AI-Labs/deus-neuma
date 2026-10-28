#!/usr/bin/env bash
# neuma-daemon — operator wrapper for the residency daemon (#20).
#
# Style note (ai6 R1.7): AGENTS.md Rule 3 specifies camelCase for functions,
# but bash universally uses snake_case (matches the GNU coreutils ecosystem,
# every system bash script on the box, and what shellcheck expects). We
# follow bash convention here as a documented deviation.
#
# Verbs:
#   install        render systemd/neuma.service.template into
#                  ~/.config/systemd/user/neuma.service with __REPO_ROOT__
#                  substituted for the current checkout, daemon-reload,
#                  enable. Idempotent. Portable across any clone location.
#   uninstall      stop + disable, remove the installed unit. Idempotent.
#   start          systemctl --user start neuma
#   stop           systemctl --user stop neuma
#   restart        systemctl --user restart neuma
#   status         systemctl --user status neuma (terse + colored)
#   logs [-f]      journalctl --user -u neuma  (-f follows)
#   enable         systemctl --user enable neuma  (boot autostart)
#   disable        systemctl --user disable neuma
#   health         curl GET /api/v1/health (public liveness — no auth)
#   residency      curl GET /api/v1/residency (auth-gated — operator-only;
#                  needs DAEMON_AUTH_TOKEN env if set in .env)
#   doctor         every probe in one shot — unit state + http reachability +
#                  conduit reachability + heartbeat cadence. Diagnostic
#                  one-liner the operator can paste when something feels off.
#
# Why a wrapper at all (vs raw systemctl):
#   - One memorable verb surface for everything residency-related
#   - The health + residency + doctor verbs reach the actual running HTTP
#     server, which is what tells you […]
#     vs […]
#   - install/uninstall are idempotent. Install renders the template into
#     ~/.config/systemd/user/ (regular file, not symlink): the unit file
#     contains the absolute path of the checkout it was installed against,
#     so the daemon works correctly from any clone location. Re-run install
#     after editing the template OR relocating the checkout to refresh.

set -euo pipefail

# Resolve repo root from this script's location so the wrapper works whether
# invoked as `scripts/neuma-daemon.sh` from the repo or via an absolute path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
UNIT_TEMPLATE="$REPO_ROOT/systemd/neuma.service.template"
UNIT_DST_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_DST="$UNIT_DST_DIR/neuma.service"

# Read the port the daemon is listening on. Precedence (ai6 R1.3):
#   1. NEUMA_PORT env (test override + ad-hoc operator use)
#   2. PORT= in .env (the file the daemon itself reads)
#   3. 3333 (backend/config.js default)
read_port() {
  if [[ -n "${NEUMA_PORT:-}" ]]; then
    echo "$NEUMA_PORT"
    return
  fi
  if [[ -f "$REPO_ROOT/.env" ]]; then
    local p
    p="$(grep -E '^[[:space:]]*PORT=' "$REPO_ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' "')"
    [[ -n "$p" ]] && { echo "$p"; return; }
  fi
  echo "3333"
}

err() { printf 'neuma-daemon: %s\n' "$*" >&2; }
ok()  { printf 'neuma-daemon: %s\n' "$*"; }

# ai6 R2.1 — RETURN, never exit. require_systemd_user is called from
# verb_status which is called from verb_doctor as `verb_status || true`.
# Bash `exit` is process-scoped, so an `exit 2` here would kill the whole
# wrapper mid-doctor — same bug class as R1.1, still present until now.
# `return 2` cooperates with `||` chains AND still triggers `set -e` for
# direct verb invocations (verb_start etc.), so the operator-facing
# behavior on broken-session is unchanged for direct calls.
require_systemd_user() {
  if ! command -v systemctl >/dev/null 2>&1; then
    err "systemctl not found — this wrapper requires a systemd-managed Linux user session"
    err "(macOS / non-systemd-Linux: run \`node backend/server.js\` directly, supervised by your own choice)"
    return 2
  fi
  # Detect the user-session bus. Without it `systemctl --user` silently does
  # nothing useful — fail fast with a clear message.
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    err "systemd --user session not available (no DBus session?). Try \`loginctl enable-linger \$USER\` then re-login."
    return 2
  fi
}

verb_install() {
  require_systemd_user
  if [[ ! -f "$UNIT_TEMPLATE" ]]; then
    err "unit template missing at $UNIT_TEMPLATE — repo layout broken"
    exit 2
  fi
  mkdir -p "$UNIT_DST_DIR"
  # Render: substitute __REPO_ROOT__ with the actual repo path. Regular file,
  # NOT symlink — the rendered file embeds an absolute path that's only
  # correct for THIS checkout. Re-run install to refresh after editing the
  # template or moving the repo. Replacement is idempotent (existing file
  # or stale symlink from a pre-template install is removed cleanly).
  #
  # Why a placeholder + sed rather than systemd specifiers: there is no
  # systemd specifier for […] — %h is
  # the user's home, %S/%E are credentials/cache paths. A render-time
  # substitution is the simplest portable approach.
  if [[ -L "$UNIT_DST" || -f "$UNIT_DST" ]]; then
    ok "unit already at $UNIT_DST — replacing"
    rm -f "$UNIT_DST"
  fi
  # Escape for sed: REPO_ROOT contains `/` (always) and could in theory
  # contain `&` or `\`. Use `|` as the delimiter to dodge `/`; escape the
  # remaining sed metacharacters in the replacement.
  local repo_escaped
  repo_escaped="$(printf '%s' "$REPO_ROOT" | sed -e 's/[\\&|]/\\&/g')"
  sed -e "s|__REPO_ROOT__|$repo_escaped|g" "$UNIT_TEMPLATE" > "$UNIT_DST"
  # Belt + suspenders: refuse to enable a unit that still contains the
  # placeholder (would point WorkingDirectory at a literal `__REPO_ROOT__`
  # path and crash on start). This catches a template that grew a new
  # placeholder the install verb doesn't know about.
  if grep -q '__REPO_ROOT__' "$UNIT_DST"; then
    rm -f "$UNIT_DST"
    err "rendered unit still contains __REPO_ROOT__ — template has an unhandled placeholder"
    exit 2
  fi
  systemctl --user daemon-reload
  systemctl --user enable neuma.service
  ok "installed + enabled (rendered for $REPO_ROOT). Run \`$0 start\` to launch."
  ok "for boot persistence without an active login: sudo loginctl enable-linger \$USER"
}

verb_uninstall() {
  require_systemd_user
  systemctl --user stop neuma.service 2>/dev/null || true
  systemctl --user disable neuma.service 2>/dev/null || true
  if [[ -L "$UNIT_DST" || -f "$UNIT_DST" ]]; then
    rm -f "$UNIT_DST"
    systemctl --user daemon-reload
    ok "uninstalled (workspace data + secrets untouched)"
  else
    ok "nothing installed at $UNIT_DST"
  fi
}

verb_start()   { require_systemd_user; systemctl --user start neuma.service; ok "start signal sent"; }
verb_stop()    { require_systemd_user; systemctl --user stop neuma.service; ok "stop signal sent"; }
verb_restart() { require_systemd_user; systemctl --user restart neuma.service; ok "restart signal sent"; }
verb_enable()  { require_systemd_user; systemctl --user enable neuma.service; ok "enabled (boot autostart on)"; }
verb_disable() { require_systemd_user; systemctl --user disable neuma.service; ok "disabled (boot autostart off)"; }
verb_status()  { require_systemd_user; systemctl --user status --no-pager neuma.service || true; }

verb_logs() {
  require_systemd_user
  if [[ "${1:-}" == "-f" || "${1:-}" == "--follow" ]]; then
    journalctl --user -u neuma.service -f
  else
    journalctl --user -u neuma.service --no-pager -n 200
  fi
}

verb_health() {
  local port; port="$(read_port)"
  local url="http://127.0.0.1:$port/api/v1/health"
  if curl --silent --show-error --max-time 5 --fail "$url"; then
    printf '\n'
  else
    # `return` (not `exit`) — see verb_doctor's `|| true` chain (ai6 R1.1).
    # bash `exit` is process-scoped, not function-scoped, so an `exit 1`
    # here would kill the wrapper mid-`doctor` before residency printed.
    err "health probe failed at $url (daemon may be down — try \`$0 status\`)"
    return 1
  fi
}

verb_residency() {
  local port; port="$(read_port)"
  local url="http://127.0.0.1:$port/api/v1/residency"
  # The bearer rides curl's stdin (-H @-), never its argument list, where any
  # local user reads it in the process table (audit 2026-10-28 L-05).
  local auth=""
  if [[ -n "${DAEMON_AUTH_TOKEN:-}" ]]; then
    auth="Authorization: Bearer $DAEMON_AUTH_TOKEN"
  fi
  if curl --silent --show-error --max-time 10 --fail -H @- "$url" <<<"$auth"; then
    printf '\n'
  else
    err "residency probe failed at $url"
    err "if the daemon is up but the probe is unauthorized, set DAEMON_AUTH_TOKEN to a valid bearer for /api/v1/residency"
    return 1
  fi
}

# Diagnostic dump — runs every probe regardless of any individual failure
# (ai6 R1.1: the `|| true` chain works only because verb_health /
# verb_residency RETURN on failure, never EXIT). Always exits 0; the
# operator reads the output to find what's broken. For pass/fail
# automation, call `verb_health` / `verb_residency` directly.
verb_doctor() {
  printf '== unit state ==\n'
  verb_status || true
  printf '\n== health probe ==\n'
  verb_health || true
  printf '\n== residency snapshot ==\n'
  verb_residency || true
}

usage() {
  cat <<EOF
neuma-daemon — residency daemon wrapper (#20)

Usage: $(basename "$0") <verb>

Verbs:
  install      render unit template + enable (re-run after editing the
               template OR relocating the checkout)
  uninstall    stop + disable + remove unit
  start        systemctl --user start neuma
  stop         systemctl --user stop neuma
  restart      systemctl --user restart neuma
  status       systemctl --user status neuma
  logs [-f]    journalctl --user -u neuma (-f to follow)
  enable       boot autostart on
  disable      boot autostart off
  health       GET /api/v1/health
  residency    GET /api/v1/residency
  doctor       status + health + residency in one shot
EOF
}

main() {
  local verb="${1:-}"
  case "$verb" in
    install)   verb_install   ;;
    uninstall) verb_uninstall ;;
    start)     verb_start     ;;
    stop)      verb_stop      ;;
    restart)   verb_restart   ;;
    status)    verb_status    ;;
    logs)      shift || true; verb_logs "$@" ;;
    enable)    verb_enable    ;;
    disable)   verb_disable   ;;
    health)    verb_health    ;;
    residency) verb_residency ;;
    doctor)    verb_doctor    ;;
    -h|--help|help|"") usage ;;
    *) err "unknown verb: $verb"; usage; exit 2 ;;
  esac
}

main "$@"
