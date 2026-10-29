/* global process, setTimeout, fetch, AbortSignal, URL */
// fresh-machine — a desk stack that sees a NEW computer: its own home, data, realm and
// workspaces on disk, no repository .env, no model server, no wallet, and the platform's
// own Ollama on a port of its own. The model-server sweep is pinned to that port, so the
// machine's live servers are never seen and the walk proves what a person's first run does.
//
// impure (child processes, fs, network). Recorded PIDs only — never pattern matching.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const waitFor = async (url, timeoutMs = 120_000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(2000) }).then((r) => r.status < 500, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not answer within ${timeoutMs} ms`);
};

/**
 * Start the stack. `dir` is kept between runs when given (a re-walk reuses the downloads);
 * a fresh one is made under ~/.cache otherwise (disk, never /tmp).
 * @param {{dir?: string, budgetGB?: number}} [options]
 */
export const startFreshMachine = async ({ dir, budgetGB } = {}) => {
  const root = dir || fs.mkdtempSync(path.join(os.homedir(), '.cache', 'fresh-walk-'));
  const paths = Object.fromEntries(['home', 'data', 'workspaces', 'realm', 'logs'].map((n) => [n, path.join(root, n)]));
  for (const p of Object.values(paths)) fs.mkdirSync(p, { recursive: true });
  const emptyEnv = path.join(root, 'empty.env');
  fs.writeFileSync(emptyEnv, '');
  // the platform's model server keeps one address per machine, as it would on a real one
  const portsFile = path.join(root, 'ports.json');
  const kept = fs.existsSync(portsFile) ? JSON.parse(fs.readFileSync(portsFile, 'utf8')) : {};
  // (the frontend's port is the browser's origin: a new one would be a new browser, wallet and all)
  const [bport, fport, oport] = [kept.bport || await freePort(), kept.fport || await freePort(), kept.oport || await freePort()];
  fs.writeFileSync(portsFile, JSON.stringify({ bport, fport, oport }));
  // A new computer's environment: the OS basics and nothing of this repository's .env.
  const env = {
    PATH: process.env.PATH,
    LANG: process.env.LANG || 'en_US.UTF-8',
    USER: process.env.USER,
    HOME: paths.home,
    XDG_CONFIG_HOME: path.join(paths.home, '.config'),
    XDG_DATA_HOME: path.join(paths.home, '.local', 'share'),
    DOTENV_CONFIG_PATH: emptyEnv,
    PORT: String(bport),
    FRONTEND_PORT: String(fport),
    NEUMA_DATA_ROOT: paths.data,
    WORKSPACES_ROOT: paths.workspaces,
    NEUMA_REALM_ROOT: paths.realm,
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(paths.data, 'workspace-settings.json'),
    NEUMA_FILES_SETTINGS_PATH: path.join(paths.data, 'files-settings.json'),
    NEUMA_REALM_SETTINGS_PATH: path.join(paths.data, 'realm-settings.json'),
    NEUMA_MODEL_FOLDERS_PATH: path.join(paths.data, 'model-folders.json'),
    NEUMA_ROOT_LOCK_PATH: path.join(paths.data, 'root-lock.json'),
    NEUMA_SUBSTRATE_CLAIM_DIR: path.join(paths.home, '.neuma'),
    NEUMA_OLLAMA_ENDPOINT: `http://127.0.0.1:${oport}`,
    // the factory default route (llama.cpp on :8089) points at nothing, as on a new computer
    LLAMA_SERVER_URL: 'http://127.0.0.1:9',
    // the sweep sees only this machine's own model server port (and its next one)
    NEUMA_DISCOVERY_PORTS: `${oport},${oport + 1}`,
    ...(budgetGB ? { NEUMA_MODEL_BUDGET_GB: String(budgetGB) } : {}),
  };
  const log = (name) => fs.openSync(path.join(paths.logs, `${name}.log`), 'a');
  const backend = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: ['ignore', log('backend'), log('backend')], detached: true });
  const vite = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: ['ignore', log('vite'), log('vite')], detached: true });
  const machine = { root, paths, env, bport, fport, oport, backend, vite, url: `http://localhost:${fport}`, api: `http://localhost:${bport}` };
  await waitFor(`${machine.api}/api/v1/health`);
  await waitFor(`http://localhost:${fport}/`);
  return machine;
};

/** Stop the stack and the platform's Ollama it started (its PID is a child of the backend). impure */
export const stopFreshMachine = async (machine, { keep = false } = {}) => {
  if (!machine) return;
  for (const p of [machine.vite, machine.backend]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ }
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  for (const p of [machine.vite, machine.backend]) {
    if (p?.pid) {
      try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ }
    }
  }
  if (!keep) fs.rmSync(machine.root, { recursive: true, force: true });
};
