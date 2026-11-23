// dev-refresh.cjs — THE DEV REFRESH (Design note, 2026-11-20: […]).
//
// A development run only (never a packaged app): main watches the source. When a file changes, every desk is told
// what is waiting and offered REFRESH:
//   desk    (frontend/, public/, index.html, vite.config.js) — the desk is rebuilt (vite build)
//   server  (backend/, core/, voice-engines/*.json)          — the server restarts in place on its port
//   app     (electron/, package.json, package-lock.json)     — needs the app itself restarted; the bar says so
// Then every desk reloads onto what changed. A reply in progress is kept by turn-keep and continues after; the image
// engine and dictation are the server's children and start again on their next use.
// Main is the one owner of what is shown, like the update bar (update-bar.cjs).

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const WATCHED = Object.freeze(['backend', 'core', 'frontend', 'public', 'electron', 'voice-engines']);
const ROOT_FILES = Object.freeze({ 'index.html': 'desk', 'vite.config.js': 'desk', 'package.json': 'app', 'package-lock.json': 'app' });
const DEBOUNCE_MS = 400;
const KEEP_FILES = 6;

/**
 * Which part of the running app a changed file belongs to, or null when nothing running reads it. Pure.
 * @param {string} rel a path relative to the repository root, '/'-separated
 * @returns {'server'|'desk'|'app'|null}
 */
const kindOf = (rel) => {
  const p = String(rel ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || /(^|\/)(node_modules|\.git|dist|__pycache__|\.venv)(\/|$)/.test(p) || /(~|\.swp|\.tmp)$/.test(p)) return null;
  if (Object.prototype.hasOwnProperty.call(ROOT_FILES, p)) return ROOT_FILES[p];
  const [top] = p.split('/');
  if (top === 'backend' || top === 'core') return /\.(c?js|mjs|json)$/.test(p) ? 'server' : null;
  if (top === 'voice-engines') return /\.json$/.test(p) ? 'server' : null;
  if (top === 'frontend' || top === 'public') return 'desk';
  if (top === 'electron') return /\.(c?js|json|html)$/.test(p) ? 'app' : null;
  return null;
};

/**
 * What a refresh does for what is waiting. Pure.
 * @param {{server: number, desk: number, app: number}} waiting
 */
const planOf = (waiting) => ({
  build: waiting.desk > 0,
  restartServer: waiting.server > 0,
  reload: waiting.desk > 0 || waiting.server > 0,
  appRestart: waiting.app > 0,
});

const emptyWaiting = () => ({ server: 0, desk: 0, app: 0 });

/**
 * The bar's view of the state. Pure.
 * @param {{waiting: object, files: string[], since: number|null, phase: string, error: string|null}} state
 */
const viewOf = (state) => ({
  waiting: { ...state.waiting },
  files: [...state.files],
  since: state.since,
  phase: state.phase,
  error: state.error,
  plan: planOf(state.waiting),
});

/**
 * impure (fs.watch) — watch the source under `root` and call `onChange(rel, kind)` for every change a running part
 * reads. Returns stop().
 */
const watchSource = (root, onChange, log = console) => {
  const watchers = [];
  const hear = (rel) => { const kind = kindOf(rel); if (kind) onChange(rel, kind); };
  for (const dir of WATCHED) {
    const at = path.join(root, dir);
    if (!fs.existsSync(at)) continue;
    try {
      watchers.push(fs.watch(at, { recursive: true }, (_event, name) => { if (name) hear(`${dir}/${String(name).replace(/\\/g, '/')}`); }));
    } catch (err) {
      log.warn(`[neuma] dev refresh cannot watch ${dir}: ${err.message}`);
    }
  }
  try {
    watchers.push(fs.watch(root, (_event, name) => { if (name && Object.prototype.hasOwnProperty.call(ROOT_FILES, String(name))) hear(String(name)); }));
  } catch (err) {
    log.warn(`[neuma] dev refresh cannot watch the root: ${err.message}`);
  }
  return () => { for (const w of watchers) { try { w.close(); } catch { /* gone */ } } };
};

// impure — rebuild the desk with the repository's own vite; resolves with the tail of its output on failure
const buildDesk = (root) => new Promise((resolve) => {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn('node', [vite, 'build'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  const keep = (chunk) => { tail = (tail + chunk.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', (err) => resolve({ ok: false, detail: err.message }));
  child.on('exit', (code) => resolve(code === 0 ? { ok: true } : { ok: false, detail: tail.trim().split('\n').slice(-12).join('\n') }));
});

/**
 * Register the dev refresh in a development run. Returns null in a packaged app (nothing is watched there).
 * impure (fs.watch, ipcMain, windows, child processes)
 * @param {{ ipcMain: object, BrowserWindow: object, app: object, isDesk: (event: object) => boolean, root: string,
 *   restartServer: () => Promise<void>, reloadDesks: () => void, log?: object }} deps
 */
const registerDevRefresh = ({ ipcMain, BrowserWindow, app, isDesk, root, restartServer, reloadDesks, log = console }) => {
  const enabled = !app.isPackaged && process.env.NEUMA_DEV_REFRESH !== '0';
  const state = { waiting: emptyWaiting(), files: [], since: null, phase: enabled ? 'idle' : 'off', error: null };
  let timer = null;

  const publish = () => {
    const view = viewOf(state);
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('devRefresh:changed', view);
  };
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!isDesk(event)) throw new Error(`${channel} refused: not the desk`);
    return fn(event, ...args);
  });
  handle('devRefresh:state', () => viewOf(state));
  if (!enabled) {
    handle('devRefresh:act', () => ({ ok: false, reason: 'the dev refresh runs only in a development run' }));
    return null;
  }

  watchSource(root, (rel, kind) => {
    if (state.phase === 'building' || state.phase === 'restarting') return; // the refresh's own writes (dist/) are not watched, but a save mid-refresh waits for the next
    state.waiting[kind] += 1;
    state.files = [rel, ...state.files.filter((f) => f !== rel)].slice(0, KEEP_FILES);
    state.since ??= Date.now();
    if (state.phase === 'failed') state.phase = 'idle';
    clearTimeout(timer);
    timer = setTimeout(publish, DEBOUNCE_MS);
  }, log);

  const refresh = async () => {
    const plan = planOf(state.waiting);
    if (!plan.reload) return { ok: false, reason: plan.appRestart ? 'only the app itself changed: quit and start it again to load it' : 'nothing is waiting' };
    if (state.phase === 'building' || state.phase === 'restarting') return { ok: false, reason: 'a refresh is already under way' };
    const taken = { ...state.waiting };
    state.error = null;
    if (plan.build) {
      state.phase = 'building'; publish();
      const built = await buildDesk(root);
      if (!built.ok) { state.phase = 'failed'; state.error = `The desk did not build:\n${built.detail}`; publish(); return { ok: false, reason: state.error }; }
    }
    if (plan.restartServer) {
      state.phase = 'restarting'; publish();
      try {
        await restartServer();
      } catch (err) {
        state.phase = 'failed'; state.error = `The server did not come back: ${err.message}`; publish(); return { ok: false, reason: state.error };
      }
    }
    // What changed while the refresh ran stays waiting; what it took is done. The app's own part waits for the app.
    state.waiting = { server: Math.max(0, state.waiting.server - taken.server), desk: Math.max(0, state.waiting.desk - taken.desk), app: state.waiting.app };
    if (!state.waiting.server && !state.waiting.desk && !state.waiting.app) { state.files = []; state.since = null; }
    state.phase = 'idle';
    publish();
    reloadDesks();
    return { ok: true };
  };

  handle('devRefresh:act', (_event, action) => {
    if (action === 'refresh') return refresh();
    if (action === 'later') { state.waiting = emptyWaiting(); state.files = []; state.since = null; state.error = null; state.phase = 'idle'; publish(); return { ok: true }; }
    return { ok: false, reason: 'unknown act' };
  });
  log.log('[neuma] dev refresh is watching the source: changes wait on the desk for REFRESH');
  return { publish, refresh };
};

module.exports = { kindOf, planOf, viewOf, watchSource, registerDevRefresh };
