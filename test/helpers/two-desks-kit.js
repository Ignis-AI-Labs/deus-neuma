/**
 * TWO DESKS, ONE MACHINE — the live box's shape for a real two-process proof
 * (house-isolation slice A, 2026-10-16). Two real `backend/server.js`
 * processes on their own ports, each serving its own house's workspaces root,
 * SHARING one data root (data/settings), one realm and one vault:
 *   - desk A is Founder's Electron shape: WORKSPACES_PIN=settings, its root read
 *     from the machine's one `data/settings/workspace.json`;
 *   - desk B is Claude's house shape: WORKSPACES_PIN=env, its root from env.
 *
 * Every door a desk could reach the operator's real machine through is
 * pinned under the temp root: settings, realm, vault, skills, secrets, voice,
 * root lock, the substrate claim (vitest's setup copy). The model is a real
 * loopback OpenAI-wire provider per desk; llama-server's URL points at a
 * closed loopback port, so nothing ever probes the live model server; chain
 * reads are killed; the bench watch sees no harness; X has no keys.
 *
 * impure — child processes, temp disk, sockets.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

/** A free loopback port, asked of the kernel. impure. */
export const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

/**
 * The env both desks share: one data root, one realm, one vault.
 * @param {string} base - the temp root of the whole box
 * @param {string} closedModelServer - a loopback URL nothing listens on
 */
export const sharedBoxEnv = (base, closedModelServer) => ({
  NEUMA_DATA_ROOT: path.join(base, 'data'),
  NEUMA_REALM_ROOT: path.join(base, 'realm'),
  NEUMA_REALM_SETTINGS_PATH: path.join(base, 'data', 'settings', 'user-realm.json'),
  NEUMA_VAULT_ROOT: path.join(base, 'vault'),
  NEUMA_SKILLS_ROOT: path.join(base, 'skills'),
  NEUMA_SECRETS_FILE: path.join(base, 'secrets.json'),
  NEUMA_VOICE_DATA_ROOT: path.join(base, 'voice'),
  NEUMA_BENCH_HARNESS_PATH: path.join(base, 'no-harness'),
  NEUMA_CHAIN_ACCESS: '0',
  LLAMA_SERVER_URL: closedModelServer,
  LLM_PROVIDER: 'lm-studio',
  LLM_MODEL: 'test-model',
  SUBSTRATE_IDLE_MINUTES: '0',
  NEUMA_RATE_GLOBAL_MAX: '5000',
  X_API_KEY: '', X_API_SECRET: '', X_ACCESS_TOKEN: '', X_ACCESS_SECRET: '',
  // The box's temp dir sits beside the houses, so the houses read as durable
  // homes to the desks (a home under the OS temp dir is refused by law).
  TMPDIR: path.join(base, 'os-tmp'),
});

/**
 * Spawn one desk. impure.
 * @param {{name: string, base: string, shared: Object, env: Object, providerEndpoint: string}} desk
 * @returns {Promise<{name: string, port: number, url: string, child: import('child_process').ChildProcess, log: string}>}
 */
export const spawnDesk = async ({ name, base, shared, env, providerEndpoint }) => {
  const port = await freePort();
  const log = path.join(base, `${name}.log`);
  fs.mkdirSync(shared.TMPDIR, { recursive: true });
  const out = fs.openSync(log, 'a');
  const child = spawn(process.execPath, ['backend/server.js'], {
    cwd: REPO,
    env: {
      ...process.env,
      ...shared,
      ...env,
      PORT: String(port),
      LM_STUDIO_URL: providerEndpoint,
      NEUMA_ROOT_LOCK_PATH: path.join(base, `${name}-root-lock.json`),
    },
    stdio: ['ignore', out, out],
    detached: true,
  });
  fs.closeSync(out);
  return { name, port, url: `http://127.0.0.1:${port}`, child, log };
};

/** Resolves when the desk answers its health route. impure. */
export const waitHealthy = async (desk, ms = 60000) => {
  const end = Date.now() + ms;
  for (;;) {
    if (desk.child.exitCode !== null) throw new Error(`${desk.name} exited ${desk.child.exitCode}: ${fs.readFileSync(desk.log, 'utf8').slice(-2000)}`);
    try {
      const res = await fetch(`${desk.url}/api/v1/health`);
      if (res.status < 500) return;
    } catch { /* not listening yet */ }
    if (Date.now() > end) throw new Error(`${desk.name} never answered: ${fs.readFileSync(desk.log, 'utf8').slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

/** Kill a desk by its own recorded process group — never by pattern. impure. */
export const stopDesk = (desk) => {
  if (!desk?.child?.pid || desk.child.exitCode !== null) return;
  try { process.kill(-desk.child.pid, 'SIGKILL'); } catch { try { desk.child.kill('SIGKILL'); } catch { /* gone */ } }
};

/** Poll until `check` answers truthy. impure. */
export const until = async (check, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};
