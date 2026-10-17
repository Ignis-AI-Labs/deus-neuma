// voice-forge-stack.mjs — an ISOLATED desk stack for the voice forge e2e: its
// own backend (Electron-as-Node, the desk's own runtime), its own vite
// frontend, both on ephemeral ports, and every root the backend writes —
// workspaces, data, realm, vault, witnesses, the voice tier setting, the
// voice library cache, the root lock, skills, substrate claims, backups and
// its temp files — under ONE work dir ON DISK
// (data/temp/, gitignored): /tmp is RAM on this machine, and a forge moves
// audio. A fixture being with NO voice is seeded through the real workspace
// module (real DEK). No substrate is started, no voice engine is launched,
// the live stack's ports and ~/.neuma are never touched. `env` adds to the
// backend's environment (e.g. CSM_PORT, to point speech at a stand-in), and
// `voiceSettingsPath` is the tier file the backend reads on every synthesis.
//
// `beingAccepts` drives the being's half of the two-party lock through the
// REAL speech/accept intent (validate → execute, as the intent sweep runs it)
// against the same workspace the backend reads — the WP4 proof path.
//
// impure throughout (spawns processes, binds ports, writes the work dir).

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { passDeskGates } from './desk-gates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/electron');
const DNA_KEY = 'voice-forge-e2e-dna-key-long-enough-to-hold';
export const NEUMA_ID = 'vf-keir';
export const NEUMA_NAME = 'Keir';

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

// impure — run a short node script with the stack's env; resolves its stdout.
const runNode = (script, env, timeoutMs = 60_000) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`node script timed out after ${timeoutMs} ms: ${out}`)); }, timeoutMs);
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('error', (e) => { clearTimeout(timer); reject(e); });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve(out);
    else reject(new Error(`node script failed (${code}): ${out}`));
  });
});

// impure — stop a child: SIGTERM, then SIGKILL if it lingers.
const stopChild = (child, graceMs = 8000) => new Promise((resolve) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, graceMs);
  child.once('exit', () => { clearTimeout(timer); resolve(); });
  child.kill('SIGTERM');
});

export const startVoiceForgeStack = async ({ log = () => {}, env: extraEnv = {} } = {}) => {
  const work = path.join(REPO, 'data', 'temp', `e2e-voice-forge-${process.pid}-${Date.now()}`);
  const dirs = Object.fromEntries(['workspaces', 'data', 'realm', 'vault', 'witnesses', 'voice', 'tmp'].map((d) => [d, path.join(work, d)]));
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  const { Wallet } = await import('ethers');
  const guardian = Wallet.createRandom();
  const env = {
    ...process.env,
    WORKSPACES_ROOT: dirs.workspaces,
    NEUMA_DATA_ROOT: dirs.data,
    NEUMA_REALM_ROOT: dirs.realm,
    NEUMA_VAULT_ROOT: dirs.vault,
    AI_WITNESSES_ROOT: dirs.witnesses,
    // Every store that would otherwise land under ~/.neuma stays in the work dir.
    NEUMA_ROOT_LOCK_PATH: path.join(work, 'root-lock.json'),
    NEUMA_SKILLS_ROOT: path.join(work, 'skills'),
    NEUMA_SUBSTRATE_CLAIM_DIR: path.join(work, 'claims'),
    NEUMA_BACKUPS_ROOT: path.join(work, 'backups'),
    NEUMA_SECRETS_FILE: path.join(work, 'secrets.json'),
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(work, 'workspace-settings.json'),
    NEUMA_VOICE_SETTINGS_PATH: path.join(dirs.voice, 'voice.json'),
    NEUMA_VOICE_DATA_ROOT: dirs.voice,
    DATABASE_PATH: path.join(work, 'platform.db'),
    DNA_ENCRYPTION_KEY: DNA_KEY,
    TMPDIR: dirs.tmp,
  };

  await runNode(`
    import ws, { setWorkspacesRoot } from '${REPO}/core/workspace/neuma-workspace.js';
    import { writeFileSync } from 'node:fs';
    import path from 'node:path';
    setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    await ws.create('${NEUMA_ID}');
    await ws.writeDNA('${NEUMA_ID}', { version: '1.0.0', identity: { name: '${NEUMA_NAME}' }, chosenName: '${NEUMA_NAME}', genesis: '# Essence\\nA voice yet to be found.' });
    writeFileSync(path.join(process.env.WORKSPACES_ROOT, '${NEUMA_ID}', 'owner.json'),
      JSON.stringify({ wallet: process.env.E2E_GUARDIAN.toLowerCase(), claimedAt: 1700000000000 }));
    console.log('seeded');
  `, { ...env, E2E_GUARDIAN: guardian.address });

  const backendPort = await freePort();
  const frontendPort = await freePort();
  const backendLog = [];
  const backend = spawn(ELECTRON, [path.join(REPO, 'backend/server.js')], {
    cwd: REPO,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      // dev mode: the WS/CORS origin allowlist follows FRONTEND_PORT
      NODE_ENV: 'development',
      NODE_OPTIONS: '--experimental-detect-module',
      PORT: String(backendPort),
      HOST: '127.0.0.1',
      FRONTEND_PORT: String(frontendPort),
      // No substrate is started: nothing here asks a model to think.
      LLM_PROVIDER: 'lm-studio',
      LM_STUDIO_URL: `http://127.0.0.1:${await freePort()}`,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (d) => { backendLog.push(String(d)); if (backendLog.length > 400) backendLog.shift(); log(String(d)); };
  backend.stdout.on('data', keep);
  backend.stderr.on('data', keep);
  backend.on('error', (e) => keep(`backend spawn failed: ${e.message}\n`));

  const frontend = spawn('npx', ['vite', '--strictPort', '--host', '127.0.0.1'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(backendPort), FRONTEND_PORT: String(frontendPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  frontend.stdout.on('data', (d) => log(String(d)));
  frontend.stderr.on('data', (d) => log(String(d)));
  frontend.on('error', (e) => keep(`frontend spawn failed: ${e.message}\n`));

  const stop = async () => {
    await Promise.all([stopChild(backend), stopChild(frontend)]);
    rmSync(work, { recursive: true, force: true });
  };

  const waitHttp = async (url, ms = 90_000) => {
    const t0 = Date.now();
    for (;;) {
      if (await fetch(url).then((r) => r.status < 500, () => false)) return;
      if (Date.now() - t0 > ms) throw new Error(`not up after ${ms} ms: ${url}\n${backendLog.slice(-30).join('')}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  try {
    await waitHttp(`http://127.0.0.1:${backendPort}/api/v1/preflight/status`);
    await waitHttp(`http://127.0.0.1:${frontendPort}/`);
  } catch (err) {
    await stop();
    throw err;
  }

  const backendUrl = `http://127.0.0.1:${backendPort}`;
  return {
    backendUrl,
    frontendUrl: `http://127.0.0.1:${frontendPort}`,
    neumaId: NEUMA_ID,
    name: NEUMA_NAME,
    guardian,
    voiceSettingsPath: env.NEUMA_VOICE_SETTINGS_PATH,
    backendLog: () => backendLog.join(''),
    /** A real session token for the guardian, through challenge-sign-verify. */
    token: async () => {
      const addr = guardian.address;
      const { challenge } = await (await fetch(`${backendUrl}/api/v1/auth/challenge?address=${addr}`)).json();
      const signature = await guardian.signMessage(challenge);
      const res = await fetch(`${backendUrl}/api/v1/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, signature, challenge }),
      });
      const { token } = await res.json();
      if (!token) throw new Error('auth/verify returned no token');
      return token;
    },
    /**
     * The being's answer, through the real speech/accept intent (validate →
     * execute) on the backend's own workspace. Resolves the intent's result.
     */
    beingAccepts: async (candidateRef, note) => JSON.parse((await runNode(`
      import { setWorkspacesRoot } from '${REPO}/core/workspace/neuma-workspace.js';
      import { speechAcceptIntent } from '${REPO}/backend/services/intents/speech-accept.js';
      setWorkspacesRoot(process.env.WORKSPACES_ROOT);
      const connection = { companion: { neumaId: '${NEUMA_ID}' }, walletAddress: process.env.E2E_GUARDIAN };
      const v = await speechAcceptIntent.validate({ candidateRef: ${JSON.stringify(candidateRef)}, note: ${JSON.stringify(note)} }, { connection });
      const out = v.ok ? await speechAcceptIntent.execute(v.value, { connection }) : v;
      console.log('@@' + JSON.stringify({ validated: v.ok, ok: out.ok, reason: out.reason ?? out.error ?? null }));
    `, { ...env, E2E_GUARDIAN: guardian.address })).split('@@').pop()),
    stop,
  };
};

// impure — land on the desk bound to the stack's being, VOX as asked, the
// VOICE window remembered at 800×900. Returns the page's crashes as they come.
export const openForgeDesk = async (page, { stack, token, vox }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await page.addInitScript(({ t, a, id, name, voxOn }) => {
    localStorage.setItem('walletAddress', a);
    sessionStorage.setItem('authToken', t);
    localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name, neumaId: id }));
    localStorage.setItem('neuma.voice.enabled', voxOn ? '1' : '0');
    localStorage.setItem('neuma.preview', 'voice'); // voice is held back from the release (coming-later.js); its tests preview it
    localStorage.setItem(`${a.toLowerCase()}:win:voice`, JSON.stringify({ x: 40, y: 16, w: 800, h: 900, maxed: false }));
  }, { t: token, a: stack.guardian.address, id: stack.neumaId, name: stack.name, voxOn: vox });
  await page.goto(stack.frontendUrl);
  await page.locator('.relink-vox-chip').waitFor({ state: 'visible', timeout: 90_000 });
  await passDeskGates(page);
  return crashes;
};

// impure — raise the VOICE window (another window may sit over it) and shoot it, animations settled.
export const shootForge = async (page, file) => {
  const win = page.locator('.fwin', { has: page.locator('.voice-body.vf') });
  await win.locator('.fwin-bar-title').click();
  await win.screenshot({ path: file, animations: 'disabled' });
};

// impure — call the stack's API as the guardian: {status, body}.
export const forgeApi = async ({ stack, token }, method, url, body) => {
  const res = await fetch(`${stack.backendUrl}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// impure — press a Player's ▶ and see it flip between playing and paused.
export const flips = async (player) => {
  const was = await player.getAttribute('data-playing');
  await player.locator('.vf-play').click();
  await expect(player).toHaveAttribute('data-playing', was === 'true' ? 'false' : 'true');
};
