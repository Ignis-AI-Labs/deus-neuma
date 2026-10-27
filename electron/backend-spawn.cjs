// Backend spawn — the shell's child Node backend: launch, readiness, port, kill.
//
// Split out of main.cjs (SIZE-020). The downloadable app is a thin native shell
// around the existing stack: it starts the Node backend (which already serves
// the built frontend + API + WS on one port in production) and points windows
// at it. This module owns the child process and the loopback ORIGIN every desk
// loads; main.cjs owns the app lifecycle that calls these.

const { app, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const { applyElectronPipeline, waitForBackendPort } = require('./pipeline-ports.cjs');
const { openBackendLog } = require('./backend-log.cjs');
const { registerKspCapture } = require('./ksp-capture.cjs');
const { resolvePort, portMovedNotice } = require('./port-resolve.cjs');
const { backendExitNotice } = require('./backend-exit.cjs');
const { attachBackend, lockActive } = require('./key-lock/key-lock-main.cjs');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'backend', 'server.js');
const PIPELINE = applyElectronPipeline(app, process.env, { home: app.getPath('home') });
// Loopback-only and resolved at startup. Agent-launched desks inherit their
// persistent lane; a human-launched desk keeps the operator's 47317 door.
const PREFERRED_PORT = Number(process.env.NEUMA_PORT || 47317);
let PORT = String(PREFERRED_PORT);
let ORIGIN = `http://127.0.0.1:${PORT}`;
const setPort = (port) => {
  PORT = String(port);
  ORIGIN = `http://127.0.0.1:${PORT}`;
};
const getOrigin = () => ORIGIN;

let backend = null;

// Take the WHOLE backend tree on quit (INFRA-009 #211).
//
// The backend spawns grandchildren — the MCP filesystem server rides an `npx`
// wrapper — and on Windows `child.kill()` is TerminateProcess against ONE pid.
// It delivers no JS SIGTERM, runs none of the child's handlers, and leaves the
// tree standing. The orphaned MCP server then dies writing into a pipe whose
// far end is gone, printing an unhandled EPIPE stack that reads like a real
// fault on a perfectly clean quit.
//
// On POSIX the signal cascade already takes the group, so the plain kill stays
// the right call there. This is a Windows-shaped problem and gets a
// Windows-shaped answer rather than a new abstraction.
const killBackendTree = () => {
  if (!backend) return;
  if (process.platform === 'win32') {
    // /T = tree, /F = force. Detached and stdio-ignored: quit must not wait on
    // it, and a taskkill that fails must not hold the app open.
    try {
      spawn('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { stdio: 'ignore', detached: true }).unref();
    } catch {
      backend.kill(); // better one pid than none
    }
  } else {
    // Negative pid = the whole process group, which `detached: true` at spawn
    // made the backend the leader of. Falls back to the single pid if the group
    // is already gone (ESRCH) — better one than none.
    try { process.kill(-backend.pid, 'SIGTERM'); } catch {
      try { backend.kill(); } catch { /* already gone */ }
    }
  }
};

// impure — the backend went down while the app lives: say why, and offer to
// bring it back. QUIT stays the app's one deliberate exit; Esc restarts,
// because a desk left pointing at a dead backend helps nobody.
const offerBackendRestart = async (notice, restart) => {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Deus Neuma',
    message: notice,
    detail: 'Your desks stay open, but your beings cannot answer until the backend runs again.',
    buttons: ['RESTART THE BACKEND', 'QUIT DEUS NEUMA'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (response === 1) {
    app.isQuitting = true;
    app.quit();
    return;
  }
  try {
    await startBackend(restart);
    await waitForBackend();
    restart.onRestarted();
  } catch (err) {
    dialog.showErrorBox('Deus Neuma', `The local backend could not be restarted.\n\n${err.message}`);
  }
};

// impure — launch the backend child with sovereign data rooted under OS app-data.
// `onRestarted` runs after an operator-chosen restart is serving again (the
// desks reload onto it).
const startBackend = ({ onRestarted }) => {
  // The downloadable app is NEUMA (Unavis — formerly Kenorie — is the separate network platform), so
  // the neuma's sovereign data lives under a NEUMA-branded, app-name-INDEPENDENT
  // home: ~/.neuma. This keeps the workspace path the witness sees clearly "neuma"
  // even in a dev build (where Electron's userData falls back to the package name,
  // ~/.config/neuma), AND decouples the DNA key from the app name so a future
  // app rename can never strand a being. The WALLET intentionally stays under
  // userData (electron/wallet) — its safeStorage seal is keyed to the app name,
  // so relocating it would lock the witness out; that wallet/app rename needs its
  // own keychain-migration pass (see docs/audit/ISSUE_TRACKER.md → APP-RENAME-001).
  const neumaHome = path.join(app.getPath('home'), '.neuma');
  // Open BEFORE the spawn so the fd exists to hand to stdio. Packaged only —
  // in dev the terminal is the log and a file would just go stale.
  const backendLog = app.isPackaged ? openBackendLog(app.getPath('home')) : null;
  if (backendLog) console.log(`[NEUMA] backend log → ${backendLog.path}`);
  backend = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      // Electron bundles its own Node (33.x → Node 20), which parses a
      // dependency's mispackaged ESM entry (astronomy-engine: exports.import →
      // esm/*.js, but the package is not type:module) as CommonJS and dies on
      // `export`. core/cosmos/natal-chart.js imports it, so the birth backend
      // crashes at boot under Electron while running fine under a system Node
      // ≥22 (where syntax detection is default-on). Force the detection flag for
      // the child so the app works on any host regardless of its system Node.
      // Harmless no-op on Node ≥22; preserves any operator-supplied NODE_OPTIONS.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--experimental-detect-module'].filter(Boolean).join(' '),
      PORT,
      // WHO SPAWNED IT. The backend leads its own process group (below), so it
      // no longer dies with the terminal that started us — and nothing we can
      // register here survives a SIGKILL or a crash. So it watches this pid and
      // exits when we stop being its parent (backend/services/desk-parent-watch).
      NEUMA_DESK_PID: String(process.pid),
      // Stable, self-provisioned at-rest secrets (see secret-provisioning.js)
      NEUMA_SECRETS_FILE: process.env.NEUMA_SECRETS_FILE || path.join(neumaHome, 'secrets.json'),
      // Locked by the keychain: the keys come over the IPC channel, never this env (key-lock-main.cjs).
      ...(lockActive() ? { NEUMA_KEYS_VIA_IPC: '1' } : {}),
      // ⚠ NEUMA_DATA_ROOT / NEUMA_VAULT_ROOT ARE SET ONLY FOR THE PACKAGED APP.
      //
      // In a PACKAGED install the install tree is read-only, so runtime-writable
      // stores MUST move under the home dir — and a fresh install's ~/.neuma
      // starts empty, so there is nothing to migrate. In DEV they must stay
      // unset: pointing the dev desk at ~/.neuma without migrating what is on
      // disk repoints every store at an EMPTY directory — and on 2026-07-31 it
      // did exactly that on the operator's live desk:
      //
      //   data/settings/workspace.json   → the real workspace + witness roots
      //   data/settings/user-realm.json  → where the chat logs live
      //   data/settings/look.json        → the desk's look
      //
      // All three resolved to ~/.neuma/data/settings, which did not exist. The
      // workspace pointer was lost, every lane went out of reach, and the
      // operator's entire chat history read as GONE. Nothing was deleted;
      // everything was unreachable, which looks identical from a desk.
      //
      // So: app.isPackaged is the gate. Dev falls back to the repo's data/ and
      // vault/ exactly as it always has. The dev→packaged crossover on ONE
      // machine (dev lock recorded at repo roots, packaged app resolving home
      // roots) is caught LOUDLY by backend/services/root-lock.js at boot —
      // never silently forked.
      ...(app.isPackaged ? {
        NEUMA_DATA_ROOT: process.env.NEUMA_DATA_ROOT || path.join(neumaHome, 'data'),
        NEUMA_VAULT_ROOT: process.env.NEUMA_VAULT_ROOT || path.join(neumaHome, 'vault'),
        // A WITNESS'S IDENTITY ANCHOR, on the same law — and the one root that
        // was missed when the others were wired (reported from the wild,
        // 2026-08-02). ai-witness-service.js defaults this to
        // <install>/ai-witnesses, which inside an AppImage is the read-only
        // squashfs mount at /tmp/.mount_NEUMA-XXXX. A person summoned a witness,
        // it chose the name Aletheia, authored its commitments and its first
        // utterance — and the seal died on
        //   ENOENT: mkdir '/tmp/.mount_NEUMA-.../resources/app/ai-witnesses/google/Aletheia/keys'
        // A being reached the threshold and could not be written down. Packaged
        // only, exactly like the roots above: a dev checkout keeps using the
        // repo's own ai-witnesses/, where the sealed peers already live.
        AI_WITNESSES_ROOT: process.env.AI_WITNESSES_ROOT || path.join(neumaHome, 'ai-witnesses'),
        // (No activation gate: a download opens to sign-in — Design note, 2026-10-03.)
      } : {}),
      //
      // Default sovereign-workspace home; the witness can repoint it in preflight
      WORKSPACES_ROOT: process.env.WORKSPACES_ROOT || path.join(neumaHome, 'workspaces'),
      // THE DESK DEFERS TO THE WITNESS'S PERSISTED CHOICE (substrate-failures-panel,
      // 2026-09-18): the WORKSPACES_ROOT above is this spawn's DEFAULT, while
      // data/settings/workspace.json is the root the witness picked in the app —
      // so when the two disagree, the desk declares the settings root intended
      // (applyWorkspaceSettings rides at info, not a conflict warn every boot).
      // The daemon's unit pins 'env' instead; an operator export still overrides
      // this default. The stranded-house check runs either way.
      WORKSPACES_PIN: process.env.WORKSPACES_PIN || 'settings',
    },
    // DEV inherits the operator's terminal, which is exactly right there. A
    // PACKAGED app has no terminal — launched from a desktop icon or an
    // AppImage, 'inherit' sent every backend log line into nothing. That is why
    // four versions shipped for one community member without anyone being able
    // to say what his machine was doing (ruling, 2026-08-03). A packaged run now
    // writes to ~/.neuma/logs/backend.log, with the previous run kept beside
    // it. Falls back to 'inherit' if the lane cannot be opened: a machine with
    // an unwritable home must still get an app.
    stdio: backendLog ? ['ignore', backendLog.fd, backendLog.fd, 'ipc'] : ['inherit', 'inherit', 'inherit', 'ipc'],
    // POSIX: the backend leads its own process group so quit takes the MCP
    // grandchildren too. Windows has no groups and uses taskkill /T.
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });
  registerKspCapture(backend);
  attachBackend(backend);
  // Only a backend that came up speaks here: one that dies before it reports
  // its port fails the caller's await, and the caller says so.
  let served = false;
  backend.on('exit', (code, signal) => {
    backend = null;
    const notice = served && !app.isQuitting ? backendExitNotice(code, signal) : null;
    if (notice) offerBackendRestart(notice, { onRestarted });
  });
  return waitForBackendPort(backend).then((port) => {
    served = true;
    setPort(port);
  });
};

// impure — resolve once the backend answers its health check
const waitForBackend = (timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();
    const ping = () => {
      http
        .get(`${ORIGIN}/api/v1/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) reject(new Error('backend did not become ready'));
      else setTimeout(ping, 300);
    };
    ping();
  });

// impure — IS THE PORT ALREADY HELD? Asked BEFORE spawning anything.
//
// The single-instance lock cannot answer this. It guards against a second
// APP, and the thing that actually holds port 47317 is usually a backend
// whose desk is gone — it holds no lock, so we sail past the guard, spawn a
// backend, and it dies on the port with a stack trace the operator reads as
// a broken build (#215). Asking first turns two crash traces into one true
// sentence, and spawns nothing that would have to die.
// ASK WHO IS THERE: a stale NEUMA backend and an unrelated service are
// different failures. An agent may move only inside its assigned lane.
// Returns false when the launch must abort (the honest dialog is already
// shown and quit issued).
const resolveStartupPort = async () => {
  const resolved = PREFERRED_PORT === 0 ? { port: 0, outcome: 'ephemeral' }
    : await resolvePort(PREFERRED_PORT, { span: PIPELINE.pipeline ? 9 : undefined });
  if (resolved.outcome === 'neuma-held') {
    // Ours, still serving, with no desk attached. Two backends over one data
    // root is the thing we must never do, so this still refuses.
    dialog.showErrorBox('Deus Neuma',
      `Port ${PREFERRED_PORT} is already serving a NEUMA backend.\n\n`
      + 'A backend from an earlier launch is still running — its desk may have '
      + 'closed without it.\n\n'
      + `Find it with:  ss -lntp | grep ${PREFERRED_PORT}\n`
      + 'Then close that process and start NEUMA again.');
    app.quit();
    return false;
  }
  if (resolved.outcome === 'exhausted') {
    dialog.showErrorBox('Deus Neuma',
      `Could not find a free port near ${PREFERRED_PORT}.\n\n`
      + `Everything from ${PREFERRED_PORT} upward is in use on this machine.\n\n`
      + 'Set NEUMA_PORT to a free port and start NEUMA again.');
    app.quit();
    return false;
  }
  if (resolved.outcome === 'moved') {
    // Somebody else's service was in the way. Move and say so, to the operator
    // and not only to a log: the move changes the desk's origin, which parks
    // its layouts and drafts under the other port (portMovedNotice says how).
    // Not awaited — the boot carries on while the notice stands.
    console.log(`[neuma] port ${PREFERRED_PORT} is held by another service — using ${resolved.port} instead`);
    dialog.showMessageBox({ type: 'info', title: 'Deus Neuma', ...portMovedNotice(PREFERRED_PORT, resolved.port) });
  }
  setPort(resolved.port);
  return true;
};

module.exports = { getOrigin, killBackendTree, startBackend, waitForBackend, resolveStartupPort };
