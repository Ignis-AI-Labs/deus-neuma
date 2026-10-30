#!/bin/sh
# The AppImage's launcher: the program AppRun starts ($APPDIR/neuma). The app's
# own binary sits beside it as neuma-bin (scripts/appimage-launcher-hook.cjs
# puts both there when the AppImage is built).
#
# The renderer sandbox stays ON. An AppImage runs from a nosuid mount, so its
# chrome-sandbox can never be setuid and Chromium's only sandbox is the
# user-namespace one. Where the system refuses unprivileged user namespaces
# (Ubuntu's AppArmor restriction, a Debian userns_clone of 0, a namespace
# limit of 0, a container that blocks them) Chromium aborts before the app's
# main script runs, so the app cannot choose for itself:
# app.commandLine.appendSwitch('no-sandbox') comes too late (the abort has
# already happened) and on a host that has namespaces it leaves renderers
# half-sandboxed. The choice is made here, before Electron starts, and only
# there does the AppImage run without the sandbox, saying so. The rpm and deb
# install a setuid chrome-sandbox instead and never pass through this file
# with APPIMAGE set.
here="$(dirname "$(readlink -f "$0")")"

userns_blocked() {
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] && return 0
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = 0 ] && return 0
  [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = 0 ] && return 0
  command -v unshare >/dev/null 2>&1 && ! unshare --user --map-root-user true >/dev/null 2>&1 && return 0
  return 1
}

if [ -n "$APPIMAGE" ] && userns_blocked; then
  echo "[neuma] this system does not allow unprivileged user namespaces, so the AppImage runs without Chromium's sandbox; the .deb or .rpm keeps it on" >&2
  exec "$here/neuma-bin" --no-sandbox "$@"
fi
exec "$here/neuma-bin" "$@"
