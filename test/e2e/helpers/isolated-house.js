// isolated-house.js — a whole desk stack of its own for the HOUSE and RECORD
// specs: its own backend child and vite on PID-derived bind-probed ports, a
// disposable WORKSPACES_ROOT with realm and settings routed into it, a data
// root of its own (a fresh install, so the wallet that signs in at its desk
// is its install owner by the real first-local-sign-in rule), real
// challenge-sign-verify auth, and members seeded as their births sealed them
// (a real forged genesis seal + true name, and the soul color and scale the
// birth's own write-once writers derive from that seal; `seedless` = no moment
// seed, as a being born before 2026-07-24). No mock anywhere (RULE 0).
// SAFETY LAW: never a live stack; only the recorded PIDs are ever killed.
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { passDeskGates } from './desk-gates.js';
import { claimOwner } from '../../helpers/claim-owner.js';
import { forgeBirthIdentity } from '../../../core/birth/identity-forge.js';
import { ensureSoulScale } from '../../../core/birth/soul-scale.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** A window alone, once its light has settled (a window rises over time). */
export const settledShot = async (win, name) => {
  await win.page().waitForTimeout(1200);
  await win.screenshot({ path: path.join(REPO, `test/e2e/shots/${name}.png`) });
};

const canBind = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, () => srv.close(() => resolve(true)));
});
const freePort = async (start) => {
  for (let p = start; p < start + 120; p += 1) if (await canBind(p)) return p;
  throw new Error(`no free port in [${start}, ${start + 120})`);
};
const waitFor = async (urls, ms = 90000) => {
  const t0 = Date.now();
  for (;;) {
    for (const url of urls) {
      try { if ((await fetch(url)).status < 500) return; } catch { /* not yet */ }
    }
    if (Date.now() - t0 > ms) throw new Error(`stack never answered: ${urls.join(' | ')}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

// impure — a member as its birth sealed it: owner, genesis seal, true name
const seedMember = async (wsRoot, m, wallet) => {
  await claimOwner(wsRoot, m.id, wallet);
  const forged = forgeBirthIdentity({
    chosenName: m.name, witnessWallet: wallet, soulPublicKey: `04a3f1b2c4d5e6f7${Buffer.from(m.id).toString('hex')}`,
    birthCycle: 1, birthMoment: { utc: m.utc, epochMs: Date.parse(m.utc), zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { model: 'test' }, momentSeed: m.seedless ? undefined : Buffer.from(m.id.padEnd(32, '.')).toString('hex').slice(0, 64),
  });
  const dir = path.join(wsRoot, m.id, 'identity');
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(forged.seal));
  await fs.promises.writeFile(path.join(dir, 'true-name.json'), JSON.stringify(forged.trueName));
  // its color and scale, written once by the birth's own writers (finalize
  // does the same): a re-watch film is drawn only from written records
  const lane = { root: wsRoot, readGenesisSeal: async () => forged.seal, readBirthTranscript: async () => null };
  await ensureSoulScale(lane, m.id);
};

/**
 * Register the stack's lifecycle for a spec file. Returns live getters.
 * @param {Array<{id: string, name: string, utc: string, seedless?: boolean}>} members
 * @param {number} base a spec's own port base (frontend = base + 4000 apart from the backend)
 */
export const setupIsolatedHouse = (members, base) => {
  const ctx = { root: null, dataRoot: null, api: null, backend: null, vite: null, token: null, addr: null, fport: null };
  test.beforeAll(async () => {
    ctx.fport = await freePort(base + 4000 + (process.pid % 149));
    const bport = await freePort(base + (process.pid % 149));
    const api = `http://localhost:${bport}`;
    ctx.api = api;
    ctx.root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'isolated-house-e2e-'));
    ctx.dataRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'isolated-house-data-'));
    const env = {
      ...process.env,
      PORT: String(bport),
      FRONTEND_PORT: String(ctx.fport),
      WORKSPACES_ROOT: ctx.root,
      NEUMA_WORKSPACE_SETTINGS_PATH: path.join(ctx.root, 'workspace-settings.json'),
      NEUMA_FILES_SETTINGS_PATH: path.join(ctx.root, 'files-settings.json'),
      NEUMA_REALM_SETTINGS_PATH: path.join(ctx.root, 'realm-settings.json'),
      NEUMA_REALM_ROOT: path.join(ctx.root, 'realm'),
      // the machine's model folders are the operator's — a spec never touches them
      NEUMA_MODEL_FOLDERS_PATH: path.join(ctx.root, 'model-folders.json'),
      // its own install: the machine's owner record and settings are never read or written
      NEUMA_DATA_ROOT: ctx.dataRoot,
      NEUMA_ROOT_LOCK_PATH: path.join(ctx.root, 'root-lock.json'),
      NEUMA_RATE_GLOBAL_MAX: '5000',
    };
    ctx.backend = spawn('node', ['backend/server.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
    ctx.vite = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: REPO, env, stdio: 'ignore', detached: true });
    await waitFor([`${api}/api/v1/health`]);
    await waitFor([`http://127.0.0.1:${ctx.fport}/`, `http://[::1]:${ctx.fport}/`]);

    const w = new ethers.Wallet(fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8').match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)[1]);
    ctx.addr = w.address;
    const { challenge } = await (await fetch(`${api}/api/v1/auth/challenge?address=${ctx.addr}`)).json();
    const res = await fetch(`${api}/api/v1/auth/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: ctx.addr, signature: await w.signMessage(challenge), challenge }),
    });
    ({ token: ctx.token } = await res.json());
    const standing = await (await fetch(`${api}/api/v1/install-owner`, { headers: { Authorization: `Bearer ${ctx.token}` } })).json();
    expect(standing.standing, 'the wallet that signed in at the desk owns this fresh install').toBe('owner');
    const sec = await (await fetch(`${api}/api/v1/security/status`, { headers: { Authorization: `Bearer ${ctx.token}` } })).json().catch(() => null);
    const roots = [...new Set([ctx.root, sec?.roots?.active].filter(Boolean))];
    for (const r of roots) for (const m of members) await seedMember(r, m, ctx.addr);
  });
  test.afterAll(async () => {
    // PROCESS-SAFETY LAW: recorded PIDs ONLY — never pattern matching.
    for (const p of [ctx.vite, ctx.backend]) {
      if (p?.pid) {
        try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch { /* gone */ } }
      }
    }
    for (const dir of [ctx.root, ctx.dataRoot]) if (dir) await fs.promises.rm(dir, { recursive: true, force: true });
  });
  return ctx;
};

/** Land on the desk bound to `member`, past its gates. */
export const openDesk = async (page, ctx, member) => {
  await page.addInitScript(({ t, a, m }) => {
    globalThis.localStorage.setItem('walletAddress', a);
    globalThis.localStorage.setItem(`${a.toLowerCase()}:neuma-companion`, JSON.stringify({ name: m.name, neumaId: m.id }));
    globalThis.sessionStorage.setItem('authToken', t);
  }, { t: ctx.token, a: ctx.addr, m: member });
  await page.goto(`http://localhost:${ctx.fport}/`);
  await expect(page.locator('.relink')).toBeVisible({ timeout: 30000 });
  await passDeskGates(page);
};
