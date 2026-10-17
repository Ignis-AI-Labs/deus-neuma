// @ts-check
// THE PERF HARNESS — the desk as an operator gets it, measured on a stack no
// one else is using. Design note, 2026-09-28: […]
//
// What makes the numbers honest:
//   - a PRODUCTION build (dev-mode React re-renders twice and carries warning
//     machinery; timing it would rank dev overhead, not the product). Built
//     into a temp dir — the repo's dist/ may be serving a desk.
//   - its OWN backend on bind-probed ports with a disposable data root,
//     vault, WORKSPACES_ROOT and realm: never a live desk, never the live
//     social queue (a booted backend runs the post scheduler).
//   - the live rate ceiling LIFTED on this stack only — a measurement that
//     429s is measuring the limiter.
// Real backend, real auth, real browser. No mocks (RULE 0).
import { test } from '@playwright/test';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claimOwner } from '../../helpers/claim-owner.js';
import { mintToken } from './explorer-panel-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, '../../..');
const NEUMA_ID = 'e2e-perf';

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) {
    if (await canBind(p)) return p;
  }
  throw new Error(`no free port in [${start}, ${start + 120})`);
};
const waitFor = async (url, ms = 60000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fetch(url).then((r) => r.status < 500, () => false)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
};

export const perf = { FPORT: 0, BASE: '', token: '', addr: '', root: '' };

// PERF_GPU=igpu rasters on the machine's INTEGRATED Intel GPU (ANGLE over
// EGL/Mesa) instead of headless SwiftShader — real graphics hardware, closer
// to a desk, and it never touches the RTX card the substrate serves on.
// Unset: SwiftShader (CPU raster), which inflates every paint number.
export const PERF_LAUNCH = process.env.PERF_GPU === 'igpu'
  ? { args: ['--enable-gpu', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] }
  : {};

/**
 * Boot the isolated stack once per file; tear down by recorded PIDs only.
 * @param {{ env?: object, dev?: boolean }} [opts]
 *   env — extra backend/frontend env (e.g. the substrate a rehearsal speaks to)
 *   dev — serve the source through the Vite dev server instead of a production
 *         build (a walk that imports app modules in-page, e.g. the embedded wallet)
 */
export const setupPerfStack = ({ env: extra = {}, dev = false } = {}) => {
  let backendProc;
  let previewProc;
  let outDir;
  test.beforeAll(async () => {
    test.setTimeout(240000);
    perf.FPORT = await freePort(7931 + (process.pid % 149));
    const bport = await freePort(3931 + (process.pid % 149));
    perf.BASE = `http://localhost:${bport}`;
    perf.root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'perf-e2e-'));
    outDir = path.join(perf.root, 'dist');
    const env = {
      ...process.env,
      PORT: String(bport),
      FRONTEND_PORT: String(perf.FPORT),
      WORKSPACES_ROOT: perf.root,
      NEUMA_WORKSPACE_SETTINGS_PATH: path.join(perf.root, 'workspace-settings.json'),
      NEUMA_FILES_SETTINGS_PATH: path.join(perf.root, 'files-settings.json'),
      NEUMA_REALM_SETTINGS_PATH: path.join(perf.root, 'realm-settings.json'),
      NEUMA_REALM_ROOT: path.join(perf.root, 'realm'),
      // THE WHOLE DATA ROOT is disposable — not only the doors above. The
      // repo's data/settings holds the live social queue and channel
      // credentials, and every backend starts the post scheduler and reply
      // listener at boot: pointed at the live settings, a measuring stack
      // would be a second publisher of the operator's approved posts. The
      // vault and the root lock follow, so the boot guard compares against
      // this stack's own record and never rewrites the operator's.
      NEUMA_DATA_ROOT: path.join(perf.root, 'data'),
      NEUMA_VAULT_ROOT: path.join(perf.root, 'vault'),
      NEUMA_ROOT_LOCK_PATH: path.join(perf.root, 'root-lock.json'),
      NEUMA_RATE_GLOBAL_MAX: '100000',
      ...extra,
    };
    if (!dev) {
      const built = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir'],
        { cwd: REPO, env, encoding: 'utf8' });
      if (built.status !== 0) throw new Error(`vite build failed:\n${built.stderr.slice(-2000)}`);
    }
    backendProc = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
    previewProc = spawn('node', dev
      ? ['node_modules/vite/bin/vite.js', '--port', String(perf.FPORT), '--strictPort']
      : ['node_modules/vite/bin/vite.js', 'preview', '--outDir', outDir, '--port', String(perf.FPORT), '--strictPort'],
    { cwd: REPO, env, stdio: 'ignore', detached: true });
    await waitFor(`${perf.BASE}/api/v1/health`);
    await waitFor(`http://localhost:${perf.FPORT}/`);
    ({ token: perf.token, addr: perf.addr } = await mintToken(perf.BASE));
    await claimOwner(perf.root, NEUMA_ID, perf.addr);
  });

  test.afterAll(async () => {
    for (const p of [previewProc, backendProc]) {
      if (p?.pid) {
        try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
      }
    }
    if (perf.root) await fs.promises.rm(perf.root, { recursive: true, force: true });
  });
};

/** Seed the session so the desk opens bound to the perf lane. Impure. */
export const initPerfSession = (page) => page.addInitScript(({ t, a, id }) => {
  const w = a.toLowerCase();
  localStorage.setItem('walletAddress', a);
  localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: 'Fenna', neumaId: id }));
  sessionStorage.setItem('authToken', t);
  sessionStorage.setItem(`arrivalSeen:${w}`, '1');
}, { t: perf.token, a: perf.addr, id: NEUMA_ID });
