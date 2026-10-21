/**
 * Two houses on one install, for the cross-house pen matrix
 * (test/integration/pen-cross-house-routes.test.js). House A set the install up
 * (its being was sealed first, and it signs in first at this desk, so it is the
 * install owner); house B is a second wallet signed in at the same desk — a
 * guest. Both sign a real challenge over the real /auth routes. The app is the
 * real one: the real remote access gate, the real /r and /remote roads, and
 * every /api/v1 router through mountApiRoutes, on :0.
 *
 * Everything the install keeps lives under one temp root — the data root, the
 * realm, the workspaces and witnesses grounds, the vault, HOME itself — so the
 * matrix can photograph A's whole world before and after each request. Every
 * outward road (model server, chain RPC, social APIs) points at a port nothing
 * listens on, so a route that slips its gate fails on a closed socket instead
 * of reaching the network.
 */
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import express from 'express';
import { ethers } from 'ethers';

// impure — a loopback port nothing listens on
const deadPort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// impure — every root the install keeps, under one temp dir; HOME too, so
// nothing a route resolves from the home directory reaches the operator's.
const pinInstall = async (root) => {
  const dead = `http://127.0.0.1:${await deadPort()}`;
  const doors = {
    NEUMA_DATA_ROOT: 'data', NEUMA_REALM_ROOT: 'realm', WORKSPACES_ROOT: 'workspaces', WITNESSES_ROOT: 'witnesses',
    NEUMA_VAULT_ROOT: 'vault', NEUMA_SKILLS_ROOT: 'skills', NEUMA_VOICE_DATA_ROOT: 'voice', HOME: 'home',
    NEUMA_SUBSTRATE_CLAIM_DIR: 'claim', NEUMA_BACKUPS_ROOT: 'backups', NEUMA_BRAND_KITS_DIR: 'brand-kits',
    NEUMA_MODELS_DIR: 'models', NEUMA_BENCH_HARNESS_PATH: 'no-bench-harness',
    // the repo's real ai-witnesses/ holds live witness identities: never the matrix's to read
    AI_WITNESSES_ROOT: 'ai-witnesses',
  };
  for (const [door, rel] of Object.entries(doors)) process.env[door] = path.join(root, rel);
  // read at import, so a module some earlier test loaded is re-pointed too
  (await import('../../core/identity/ai-witness/ai-witness-service.js')).setAIWitnessesRoot(process.env.AI_WITNESSES_ROOT);
  for (const file of ['NEUMA_WORKSPACE_SETTINGS_PATH', 'NEUMA_REALM_SETTINGS_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH',
    'NEUMA_PROVIDER_CHOICE_PATH', 'NEUMA_SECRETS_FILE', 'NEUMA_ROOT_LOCK_PATH', 'NEUMA_WORKING_SET_PATH',
    'NEUMA_CHAT_TOOLS_PATH', 'NEUMA_THINK_SHAPES_PATH']) {
    process.env[file] = path.join(root, 'data', 'pinned', `${file.toLowerCase()}.json`);
  }
  for (const road of ['LLAMA_SERVER_URL', 'LM_STUDIO_URL', 'OLLAMA_URL', 'ETH_RPC_URL', 'ETH_SEPOLIA_RPC_URL',
    'BASE_SEPOLIA_RPC_URL', 'BASE_MAINNET_RPC_URL', 'NEUMA_X_API_ROOT', 'NEUMA_BLUESKY_API_ROOT', 'NEUMA_TELEGRAM_API_ROOT']) {
    process.env[road] = dead;
  }
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'LLM_API_KEY']) delete process.env[key];
  fs.mkdirSync(process.env.HOME, { recursive: true });
};

// impure — a born, sealed lane the way finalize-birth leaves one; `owned`
// false leaves it sealed but unclaimed (the lane a claim must match the seal for).
const sealLane = async (root, laneId, wallet, epochMs, { owned = true } = {}) => {
  const lane = path.join(root, laneId);
  await fsp.mkdir(path.join(lane, 'identity'), { recursive: true });
  await fsp.mkdir(path.join(lane, 'dna'), { recursive: true });
  await fsp.mkdir(path.join(lane, 'config'), { recursive: true });
  await fsp.writeFile(path.join(lane, 'dna', 'genesis.md'), `# genesis of ${laneId}\n`);
  await fsp.writeFile(path.join(lane, 'identity', 'genesis-seal.json'), JSON.stringify({
    genesisHash: 'sha256:00', record: { chosenName: laneId, witnessWallet: wallet, birthMoment: { epochMs } },
  }));
  if (owned) await fsp.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet, claimedAt: epochMs }));
};

// impure — sign in over the real routes: challenge → personal_sign → verify
const signIn = async (base, wallet) => {
  const challenge = await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}`).then((r) => r.json());
  const signature = await wallet.signMessage(challenge.challenge);
  const res = await fetch(`${base}/api/v1/auth/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, signature, challenge: challenge.challenge }),
  });
  const body = await res.json();
  if (!body.token) throw new Error(`sign-in refused: ${res.status} ${JSON.stringify(body)}`);
  return { address: body.address, token: body.token };
};

/**
 * One request against the stood app. Never throws on an HTTP status; a
 * request the route never answers within `timeoutMs` reads as status 0.
 * impure (network, loopback only).
 */
export const send = async (base, { method, url, token = null, body = undefined, timeoutMs = 4000 }) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${base}${url}`, {
      method: method.toUpperCase(), headers,
      body: body === undefined || method === 'get' ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON: kept as text */ }
    return { status: res.status, body: json ?? text };
  } catch (error) {
    return { status: 0, body: String(error?.name || error) };
  }
};

/**
 * Stand the install: pin every root, seal the two houses' lanes, mount the
 * real app on :0 and sign both wallets in (A first — the install's owner).
 * impure.
 */
export const standTwoHouses = async (root) => {
  await pinInstall(root);
  const walletA = ethers.Wallet.createRandom();
  const walletB = ethers.Wallet.createRandom();
  const lanes = { a: 'penalane', aUnclaimed: 'penaseal', b: 'penblane' };
  const ws = process.env.WORKSPACES_ROOT;
  await sealLane(ws, lanes.a, walletA.address.toLowerCase(), Date.UTC(2026, 0, 1));
  await sealLane(ws, lanes.aUnclaimed, walletA.address.toLowerCase(), Date.UTC(2026, 0, 2), { owned: false });
  await sealLane(ws, lanes.b, walletB.address.toLowerCase(), Date.UTC(2026, 5, 1));

  // A's paired phone, so a guest's device removal has something of A's to aim at
  const { mintDevice } = await import('../../backend/services/remote/pairing.js');
  const phone = mintDevice({ address: walletA.address.toLowerCase(), label: 'A phone' });
  await fsp.mkdir(path.join(process.env.NEUMA_DATA_ROOT, 'settings'), { recursive: true });
  await fsp.writeFile(path.join(process.env.NEUMA_DATA_ROOT, 'settings', 'remote.json'),
    JSON.stringify({ enabled: false, origin: null, devices: [phone.device] }));

  // server.js boots the config before it mounts anything; routes read it
  (await import('../../backend/config.js')).loadConfig();
  const { installRemoteGate, mountRemoteRoutes } = await import('../../backend/services/remote/wire.js');
  const { mountApiRoutes } = await import('../../backend/routes/route-mounts.js');
  const app = express();
  app.set('trust proxy', 'loopback');
  await installRemoteGate(app);
  // server.js's parser rule: the routers that parse their own wide bodies behind auth are skipped
  const json = express.json();
  const selfParsed = (p) => ['/api/v1/voice/forge', '/api/v1/attachments', '/api/v1/doc-press']
    .some((under) => p === under || p.startsWith(`${under}/`));
  app.use((req, res, next) => (selfParsed(req.path) ? next() : json(req, res, next)));
  mountRemoteRoutes(app);
  mountApiRoutes(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const a = { ...(await signIn(base, walletA)), wallet: walletA };
  const b = { ...(await signIn(base, walletB)), wallet: walletB };
  return { app, server, base, root, a, b, lanes, deviceA: phone.device.id };
};

const TEXT_LIMIT = 256 * 1024;

// impure — every regular file under `dir`: relative path → { hash, text }
// (text kept for files small enough to judge whose they are).
const readTree = async (dir, rel = '', out = new Map()) => {
  const entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) await readTree(dir, child, out);
    else if (entry.isFile()) {
      const bytes = await fsp.readFile(path.join(dir, child)).catch(() => null);
      out.set(child, {
        hash: bytes ? crypto.createHash('sha1').update(bytes).digest('hex') : 'unreadable',
        text: bytes && bytes.length <= TEXT_LIMIT ? bytes.toString('utf8') : null,
      });
    } else if (entry.isSymbolicLink()) {
      const target = await fsp.readlink(path.join(dir, child)).catch(() => '?');
      out.set(child, { hash: `link:${target}`, text: target });
    }
  }
  return out;
};

/**
 * A photograph of the install, minus the paths `ignore(relPath)` names.
 * impure (fs reads).
 */
export const photograph = async (root, ignore) => {
  const all = await readTree(root);
  return new Map([...all].filter(([rel]) => !ignore(rel)));
};

// pure — does this value name any of the marks (wallets, lane ids)?
const mentions = (value, marks) => {
  const text = (typeof value === 'string' ? value : JSON.stringify(value) ?? '').toLowerCase();
  return marks.some((mark) => text.includes(mark));
};

// pure — a value with every record that is B's taken out: array items and
// nested records naming B and not A (or that `isB` claims for B, for a store
// whose B record must name A, like B's follow of A), and keys that are B's marks.
const withoutB = (value, marks, isB) => {
  const bs = (v) => (mentions(v, marks.b) && !mentions(v, marks.a)) || isB(v);
  if (Array.isArray(value)) return value.filter((item) => !bs(item)).map((item) => withoutB(item, marks, isB));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, v]) => !mentions(key, marks.b) && !(v && typeof v === 'object' && bs(v)))
      .map(([key, v]) => [key, withoutB(v, marks, isB)]));
  }
  return value;
};

// pure — a store's text as data: JSON, JSON lines, or null for anything else.
const parseStore = (rel, text) => {
  if (text === null) return null;
  try {
    if (rel.endsWith('.jsonl')) return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
    if (rel.endsWith('.json')) return JSON.parse(text);
  } catch { /* torn or not a store: judged by its bytes */ }
  return null;
};

// The machine's own settings are every house's: a file there is never B's
// whole just because B's wallet is stamped in it — only B's own records are.
const MACHINE_STATE = /^data\/(settings|settings-store)\//;

// pure — A's part of one file, as comparable text; '' when nothing of it is A's.
const aPart = (rel, entry, marks, isB) => {
  if (!entry) return '';
  if (!MACHINE_STATE.test(rel) && entry.text !== null && mentions(entry.text, marks.b) && !mentions(entry.text, marks.a)) return '';
  const data = parseStore(rel, entry.text);
  if (data === null) return entry.hash;
  const kept = withoutB(data, marks, isB);
  const empty = (Array.isArray(kept) && kept.length === 0) || (kept && typeof kept === 'object' && Object.keys(kept).length === 0);
  return empty ? '' : JSON.stringify(kept);
};

/**
 * Every path whose part that is house A's appeared, vanished or changed
 * between two photographs. A shared store B wrote its own record into is not
 * a change of A's; a record naming A that B made or removed is.
 * Pure. `marks` = { a: [...], b: [...] }, lowercased wallets and lane ids;
 * `bRecords` = [{ path, isB(record) }] for the stores where B's own record
 * must name A.
 */
export const changedForA = (before, after, marks, bRecords = []) => {
  const out = [];
  for (const rel of new Set([...before.keys(), ...after.keys()])) {
    const own = bRecords.find((entry) => entry.path === rel);
    const isB = (record) => Boolean(own && record && typeof record === 'object' && own.isB(record));
    const was = aPart(rel, before.get(rel), marks, isB);
    const now = aPart(rel, after.get(rel), marks, isB);
    if (was !== now) out.push(`${!before.has(rel) ? '+' : !after.has(rel) ? '-' : '~'}${rel}`);
  }
  return out.sort();
};

/**
 * Every file whose text names one of `marks` now and did not before — run on
 * B's own zone, it shows B's house claiming something of A's (making A's being
 * its officer, pointing a ground at A's folders) without touching A's files.
 * Pure.
 */
export const newlyNaming = (before, after, marks) => [...after]
  .filter(([rel, entry]) => entry.text !== null && mentions(entry.text, marks)
    && !(before.get(rel)?.text !== null && before.has(rel) && mentions(before.get(rel).text, marks)))
  .map(([rel]) => rel).sort();

/** A fresh temp root for one install, inside the run's temp dir (swept at the end). impure. */
export const tempInstallRoot = () => {
  const parent = globalThis.__TEST_TEMP_DIR__ ?? os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, 'neuma-pen-'));
};
