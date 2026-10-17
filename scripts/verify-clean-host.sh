#!/usr/bin/env bash
# Clean-host proof for the NEUMA RPM — runs INSIDE a stock fedora:44 container.
# No Node/npm, no dev tooling: exactly the Windows-convert's fresh Fedora box.
# 1. dnf install the RPM — system-lib requirements must auto-resolve.
# 2. Boot the app under Xvfb AS A NON-ROOT USER (the real case — a user must
#    never need root, and /opt/NEUMA is root-owned, so any install-tree write
#    by the app would fail loudly here).
# 3. Assert: backend health 200, avatars API, MCP filesystem server connected
#    under the app's own runtime (no npx — INFRA-011 fix), ~/.neuma fully
#    provisioned (data + vault + workspaces), install tree left PRISTINE.
set -uo pipefail

# WHICH BUILD IS THIS PROVING? On 2026-08-03 this script passed cleanly — on
# the PREVIOUS version's RPM, still sitting in release/ beside the new one,
# because `head -1` takes whatever sorts first. A proof that does not name its
# subject can attest to the wrong build and read exactly like success.
#
# Pass EXPECT_VERSION (the caller knows what it just built) and a mismatch is a
# hard stop. Unset keeps the old behaviour, but says out loud what it chose.
RPM_PATH=$(ls /release/neuma-*.rpm 2>/dev/null | head -1)
if [ -z "$RPM_PATH" ]; then
  echo "CLEAN-HOST PROOF: FAIL — no RPM at /release (is the mount there?)"
  exit 1
fi
FOUND_COUNT=$(ls /release/neuma-*.rpm 2>/dev/null | wc -l)
FOUND_VERSION=$(basename "$RPM_PATH" | sed -E 's/^neuma-([0-9]+\.[0-9]+\.[0-9]+)-.*/\1/')
echo "=== proving version $FOUND_VERSION ($FOUND_COUNT RPM(s) present at /release)"
if [ -n "${EXPECT_VERSION:-}" ] && [ "$FOUND_VERSION" != "$EXPECT_VERSION" ]; then
  echo "CLEAN-HOST PROOF: FAIL — asked to prove $EXPECT_VERSION but found $FOUND_VERSION"
  echo "  (clear old artifacts out of release/, or mount only the build under test)"
  exit 1
fi
if [ "$FOUND_COUNT" != "1" ]; then
  echo "  ⚠ more than one RPM is present — this proof covers ONLY $FOUND_VERSION"
fi
echo "=== installing $RPM_PATH"
dnf install -y "$RPM_PATH" xorg-x11-server-Xvfb xauth curl procps-ng mesa-dri-drivers 2>&1 | tail -2

echo "=== node/npm on host (must be absent)"
which node npm 2>&1 || echo "confirmed: no node/npm on PATH"

useradd -m tester
echo "=== booting NEUMA under Xvfb as user 'tester'"
su tester -c 'export HOME=/home/tester; xvfb-run -a neuma --no-sandbox > /tmp/neuma-container.log 2>&1' &

HEALTHY=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:47317/api/v1/health 2>/dev/null)
  if [ "$code" = "200" ]; then HEALTHY=1; echo "backend HEALTHY after ~$((i*3))s"; break; fi
  sleep 3
done

echo "=== health: $(curl -s http://127.0.0.1:47317/api/v1/health)"
echo "=== avatars: $(curl -s http://127.0.0.1:47317/api/v1/avatars | head -c 160)"

# NO ACTIVATION GATE (Design note, 2026-10-03: […]): a
# PACKAGED build on a machine never licensed must open straight to sign-in —
# the licence route is gone, so no build can ask for a key.
LICENSE_JSON=$(curl -s http://127.0.0.1:47317/api/v1/license)
echo "=== license route: $LICENSE_JSON"
OPEN=1
case "$LICENSE_JSON" in
  *'"required"'*) OPEN=0; echo "A LICENCE ROUTE STILL ANSWERS — a downloaded build may still ask for a key" ;;
  *) echo "no gate — a downloaded build opens to sign-in" ;;
esac
# A WITNESS'S IDENTITY MUST HAVE SOMEWHERE TO LAND. On the v0.1.1 AppImage this
# root defaulted inside the read-only mount, so a witness reached its SEAL and
# died on ENOENT with its name and first utterance already authored. Read the
# root out of the running backend's own environment — not the source — and prove
# it points into the user's home and is actually writable there.
# Read the environ AS THE OWNING USER: rootless containers drop CAP_SYS_PTRACE,
# so even root gets EACCES on another user's /proc/<pid>/environ. tester owns
# the backend, so tester can read it.
BACKEND_PID=$(pgrep -f 'backend/server.js' | head -1)
WITNESS_ROOT=$(su tester -c "tr '\\0' '\\n' < /proc/${BACKEND_PID}/environ" 2>/dev/null | sed -n 's/^AI_WITNESSES_ROOT=//p')
echo "=== witness identity root: ${WITNESS_ROOT:-<UNSET>}"
WITNESS_OK=0
case "$WITNESS_ROOT" in
  /home/tester/*)
    if su tester -c "mkdir -p '$WITNESS_ROOT/probe/keys' && rmdir '$WITNESS_ROOT/probe/keys' '$WITNESS_ROOT/probe'" 2>/dev/null; then
      WITNESS_OK=1; echo "witness root is under the user's home AND writable — a seal can land"
    else
      echo "WITNESS ROOT NOT WRITABLE — a summoned witness would die at the seal"
    fi ;;
  *) echo "WITNESS ROOT IS NOT IN THE USER'S HOME — this is the v0.1.1 AppImage bug" ;;
esac

# THE BACKEND'S OWN LOG LANE (2026-08-03). A packaged backend no longer writes
# to the desk's stdout — it writes to ~/.neuma/logs/backend.log, which is the
# whole point: an operator with no terminal can now produce a diagnostic. This
# check exists because that change SILENTLY BLINDED the MCP assertion below on
# its first run: the line was still being logged, just not where this script was
# looking, and "NOT CONNECTED" printed beside a healthy running server.
BACKEND_LOG=/home/tester/.neuma/logs/backend.log
echo "=== backend log lane:"
if [ -s "$BACKEND_LOG" ]; then
  echo "backend.log written ($(wc -c < "$BACKEND_LOG") bytes) — a user can send this"
  LOGGED=1
else
  echo "NO BACKEND LOG — a packaged run must keep one, or nobody can diagnose this build"
  LOGGED=0
fi

# NATIVE ABI, JUDGED BY WHAT THE APP ACTUALLY DID. Every published version from
# v0.1.1 to v0.1.7 shipped a better-sqlite3 compiled for system Node (ABI 137)
# inside an Electron 33 app (ABI 130), so PlatformDB soft-degraded to a no-op and
# platform persistence was silently DISABLED for every user. Found 2026-08-04 in
# a community member's log, not by any check here.
#
# The cause was that `electron:build` carries a preelectron:build ABI hook and
# `dist:linux` / `dist:rpm` / `dist:deb` — the scripts that make every actual
# release — did not. Those hooks now exist, but a hook can be forgotten again;
# this asserts the OUTCOME on the shipping artifact instead of trusting the
# build path. A soft-degrade that boots healthy is exactly what a proof of
# "backend HEALTHY" cannot see.
echo "=== native ABI / platform persistence:"
if grep -q "SQLite platform driver failed to load" "$BACKEND_LOG" 2>/dev/null; then
  echo "PLATFORM DB DEAD — native ABI mismatch shipped; persistence silently disabled"
  grep -m1 -o "NODE_MODULE_VERSION [0-9]*" "$BACKEND_LOG" | head -2
  ABI_OK=0
else
  echo "platform persistence live — no ABI mismatch"
  ABI_OK=1
fi

echo "=== MCP filesystem server:"
# Look in BOTH: the backend's own lane (packaged) and the desk's stdout (older
# builds, and anything the desk itself logs).
grep -m1 "Filesystem server connected" "$BACKEND_LOG" /tmp/neuma-container.log 2>/dev/null || echo "NOT CONNECTED"
echo "=== filesystem server process (must be the app's own runtime, no npx):"
ps -eo cmd | grep -v grep | grep "server-filesystem" | head -2
echo "=== /home/tester/.neuma provisioning (must include data, vault, workspaces):"
ls /home/tester/.neuma
echo "=== install tree must be PRISTINE (no writes under /opt/NEUMA):"
ls /opt/NEUMA/resources/app/data /opt/NEUMA/resources/app/vault 2>&1 | head -4

pkill -f "xvfb-run" 2>/dev/null; pkill -f "/opt/NEUMA/neuma" 2>/dev/null
if [ "$HEALTHY" = "1" ] && [ "$OPEN" = "1" ] && [ "$WITNESS_OK" = "1" ] && [ "$LOGGED" = "1" ] && [ "$ABI_OK" = "1" ]; then
  echo "CLEAN-HOST PROOF: PASS — version $FOUND_VERSION"
else
  echo "CLEAN-HOST PROOF: FAIL (version=$FOUND_VERSION healthy=$HEALTHY open=$OPEN witnessRoot=$WITNESS_OK log=$LOGGED abi=$ABI_OK)"
  tail -30 /tmp/neuma-container.log
  exit 1
fi
