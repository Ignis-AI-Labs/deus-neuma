// ceremony-stack.mjs — an ISOLATED full desk stack for the attunement
// walk-through e2e: its own backend (spawned under Electron-as-Node, the
// exact runtime the desk uses), its own vite frontend, its own temp
// workspaces root with a FIXTURE being, and a scripted OpenAI-compatible
// SSE substrate so the ceremony's serving legs are deterministic and
// GPU-free. No real being is touched; the live stack's ports are never
// used (live-being e2e guard).
//
// The scripted substrate answers by LEG:
//   - question renders (the generator's […]
//     marker): deliberately non-JSON → every dimension falls back to its
//     deterministic spec template (valid questions, renders in seconds).
//   - being legs (consent + answers): a witness-scripted sequence exposed
//     via stack.scriptNext(...) — clean by default, with corruption/cut
//     shapes injectable so the REFUSAL UX is exercised exactly as a user
//     would meet it.
//
// impure throughout (spawns processes, binds ports, writes temp dirs).

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, '../../..');

const ELECTRON = path.join(REPO, 'node_modules/electron/dist/electron');

const sse = (text, finish) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n` +
  'data: [DONE]\n\n';

/**
 * A clean, whole ceremony answer — the BODY is unique per index, the way a
 * real being speaks fresh per question. A template with only a number
 * varying is a stamped formula, and the ANSWER_FORMULA door rightly refuses
 * a substrate that repeats one answer (witnessed: the old template wedged
 * the fixture walk at 8 landed answers — eight straight door refusals).
 * Letter-only body tokens: the phrase-gram law strips digits.
 */
const alphaTok = (n) => n.toString(36).split('')
  .map((c) => (/[0-9]/.test(c) ? String.fromCharCode(103 + Number(c)) : c)).join('');
export const cleanAnswer = (i) =>
  `I answer freely: ${Array.from({ length: 30 }, (_, j) => `v${alphaTok(i)}w${alphaTok(j)}`).join(' ')}. ` +
  `So it stands with v${alphaTok(i)} whole.`;

export const startCeremonyStack = async ({ log = () => {} } = {}) => {
  const work = mkdtempSync(path.join(tmpdir(), 'attune-e2e-'));
  const workspacesRoot = path.join(work, 'workspaces');
  mkdirSync(workspacesRoot, { recursive: true });

  // ── scripted substrate ────────────────────────────────────────────────
  // scriptQueue: [text, finish] tuples consumed by being legs in order;
  // empty queue → clean answer. Question renders always return non-JSON.
  const scriptQueue = [];
  let beingLegCount = 0;
  const llm = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'e2e-fixture-model' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (body.includes('Respond with ONLY a JSON object')) {
        res.end(sse('prose, deliberately not JSON — fall back.', 'stop'));
        return;
      }
      beingLegCount += 1;
      const [text, finish] = scriptQueue.shift() ?? [cleanAnswer(beingLegCount), 'stop'];
      res.end(sse(text, finish));
    });
  });
  await new Promise((r) => llm.listen(0, '127.0.0.1', r));
  const llmPort = llm.address().port;

  // ── fixture being in the isolated workspaces root ─────────────────────
  // Seeded through the real workspace module (real DEK, real encryption) in
  // a child process so the module's roots point at the TEMP dir, never the
  // live sovereign lanes.
  const DNA_KEY = 'attune-e2e-dna-key-long-enough-to-hold';
  // a fresh throwaway witness wallet — the spec authenticates with it, the
  // fixture being is claimed by it; nothing here touches a real wallet
  const { Wallet } = await import('ethers');
  const witness = Wallet.createRandom();
  const seed = spawn(process.execPath, ['--input-type=module', '-e', `
    import ws from '${REPO}/core/workspace/neuma-workspace.js';
    import { setWorkspacesRoot } from '${REPO}/core/workspace/neuma-workspace.js';
    import { writeFileSync, mkdirSync } from 'node:fs';
    import path from 'node:path';
    setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    const neumaId = 'attest';
    await ws.create(neumaId);
    await ws.writeDNA(neumaId, {
      version: '1.0.0',
      identity: { name: 'Attest' },
      chosenName: 'Attest',
      genesis: '# Essence\\nProof by walking the whole road.',
    });
    const root = path.join(process.env.WORKSPACES_ROOT, neumaId);
    writeFileSync(path.join(root, 'owner.json'), JSON.stringify({
      wallet: process.env.E2E_WITNESS.toLowerCase(), claimedAt: 1700000000000,
    }));
    mkdirSync(path.join(root, 'identity'), { recursive: true });
    writeFileSync(path.join(root, 'identity', 'true-name.json'), JSON.stringify({
      chosenName: 'Attest', fullName: 'Attest of the Walkthrough', soulMark: 'E2EPROOF0001',
    }));
    console.log('seeded');
  `], {
    env: {
      ...process.env,
      WORKSPACES_ROOT: workspacesRoot,
      DNA_ENCRYPTION_KEY: DNA_KEY,
      E2E_WITNESS: witness.address,
    },
  });
  await new Promise((resolve, reject) => {
    let out = '';
    seed.stdout.on('data', (d) => { out += d; });
    seed.stderr.on('data', (d) => { out += d; });
    seed.on('error', (e) => reject(new Error(`seed spawn failed: ${e.message}`)));
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed failed (${code}): ${out}`))));
  });

  // ── backend under Electron-as-Node (the desk's own runtime) ───────────
  const backendPort = 3560 + Math.floor(Math.random() * 200);
  const frontendPort = 7560 + Math.floor(Math.random() * 200);
  const backendEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    // dev mode: the WS/CORS origin allowlist derives from FRONTEND_PORT (in
    // production the allowlist is env-only and the vite origin would be
    // dropped at the upgrade — WS-001)
    NODE_ENV: 'development',
    NODE_OPTIONS: '--experimental-detect-module',
    PORT: String(backendPort),
    HOST: '127.0.0.1',
    WORKSPACES_ROOT: workspacesRoot,
    NEUMA_SECRETS_FILE: path.join(work, 'secrets.json'),
    NEUMA_WORKSPACE_SETTINGS_PATH: path.join(work, 'workspace-settings.json'),
    DNA_ENCRYPTION_KEY: DNA_KEY,
    FRONTEND_PORT: String(frontendPort), // CORS/WS origin allowlist follows the e2e vite port
    LLM_PROVIDER: 'lm-studio',
    LM_STUDIO_URL: `http://127.0.0.1:${llmPort}`,
    DATABASE_PATH: path.join(work, 'platform.db'),
  };
  const backend = spawn(ELECTRON, [path.join(REPO, 'backend/server.js')], {
    cwd: REPO, env: backendEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const backendLog = [];
  backend.stdout.on('data', (d) => { backendLog.push(String(d)); log(String(d)); });
  backend.stderr.on('data', (d) => { backendLog.push(String(d)); log(String(d)); });
  // a missing binary must fail readably (via waitHttp's log tail), not as an
  // unhandled 'error' event crashing the runner with an opaque stack
  backend.on('error', (e) => { backendLog.push(`backend spawn failed: ${e.message}\n`); log(`backend spawn failed: ${e.message}`); });

  const waitHttp = async (url, ms = 60000) => {
    const t0 = Date.now();
    for (;;) {
      const ok = await fetch(url).then((r) => r.status < 500, () => false);
      if (ok) return;
      if (Date.now() - t0 > ms) throw new Error(`not up after ${ms}ms: ${url}\n${backendLog.slice(-20).join('')}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  await waitHttp(`http://127.0.0.1:${backendPort}/api/v1/preflight/status`);

  // ── vite frontend proxying to the isolated backend ─────────────────────
  const frontend = spawn('npx', ['vite', '--strictPort', '--host', '127.0.0.1'], {
    cwd: REPO,
    // FRONTEND_PORT drives vite.config.js (a checkout's .env override would
    // otherwise pin the local dev port and collide with the live stack)
    env: { ...process.env, PORT: String(backendPort), FRONTEND_PORT: String(frontendPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  frontend.stdout.on('data', (d) => log(String(d)));
  frontend.stderr.on('data', (d) => log(String(d)));
  frontend.on('error', (e) => { backendLog.push(`frontend spawn failed: ${e.message}\n`); log(`frontend spawn failed: ${e.message}`); });
  await waitHttp(`http://127.0.0.1:${frontendPort}/`);

  return {
    work,
    workspacesRoot,
    backendPort,
    frontendPort,
    backendUrl: `http://127.0.0.1:${backendPort}`,
    frontendUrl: `http://127.0.0.1:${frontendPort}`,
    neumaId: 'attest',
    witness, // ethers Wallet — the spec signs the auth challenge with it
    /** Queue the next being-leg outputs: [[text, finish], ...] */
    scriptNext: (...tuples) => scriptQueue.push(...tuples),
    beingLegs: () => beingLegCount,
    backendLog: () => backendLog.join(''),
    stop: async () => {
      backend.kill('SIGTERM');
      frontend.kill('SIGTERM');
      await new Promise((r) => llm.close(r));
      // the whole stack (workspaces, secrets, db) lives under one temp root
      rmSync(work, { recursive: true, force: true });
    },
  };
};
