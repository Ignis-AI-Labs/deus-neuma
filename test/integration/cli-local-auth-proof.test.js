// P6-44 / P6-146 — real local auth, and a real hostile relay on another port.
// No auth, signature, filesystem, or network boundary is replaced. The relay
// returns the genuine backend's challenge and HMAC; only the origin changes.
import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { Wallet } from 'ethers';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createAuthRouter, verifySessionToken } from '../../backend/services/auth.js';
import { createAccessGuard } from '../../backend/services/remote/access-guard.js';
import { createRemoteStore } from '../../backend/services/remote/remote-store.js';
import { prepareOwnerClaim, readInstallOwner } from '../../backend/services/install-owner.js';
import { mintToken } from '../../cli/lib/auth.js';
import { signInSitting, sittingOrigin, validateSittingChallenge } from '../../scripts/lib/sitting-auth.mjs';

const ENV_KEYS = ['NEUMA_DATA_ROOT', 'WORKSPACES_ROOT', 'AUTH_SECRET', 'APP_DOMAIN', 'AUTH_CHAIN_ID', 'NEUMA_CLI_CACHE_DIR'];
const roots = [];
const servers = [];
let saved;

const listen = (app) => new Promise((resolve) => {
  const server = http.createServer(app);
  servers.push(server);
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const realBackend = async (label) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `neuma-${label}-`));
  roots.push(root);
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
  process.env.AUTH_SECRET = 'cli-local-auth-proof-test-secret';
  delete process.env.APP_DOMAIN;
  delete process.env.AUTH_CHAIN_ID;
  await prepareOwnerClaim();
  const app = express();
  app.use(createAccessGuard({ store: createRemoteStore({ path: path.join(root, 'remote.json') }) }).middleware);
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  const server = await listen(app);
  return { root, dataRoot: process.env.NEUMA_DATA_ROOT, base: `http://127.0.0.1:${server.address().port}` };
};

const relay = async (target) => {
  const verifyHits = [];
  const server = await listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.url.startsWith('/api/v1/auth/verify')) verifyHits.push({ headers: req.headers, body });
    const upstream = await fetch(`${target}${req.url}`, {
      method: req.method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(req.headers['x-neuma-owner-claim'] ? { 'x-neuma-owner-claim': req.headers['x-neuma-owner-claim'] } : {}),
      },
      ...(body ? { body } : {}),
    });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
    res.end(await upstream.text());
  });
  return { base: `http://127.0.0.1:${server.address().port}`, verifyHits };
};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('origin-bound local backend proof', () => {
  test('the genuine CLI sign-in seats the owner, and a witness can sign after the claim is spent', async () => {
    const backend = await realBackend('local-auth-valid');
    const operator = Wallet.createRandom();
    const minted = await mintToken({ backend: backend.base, privateKey: operator.privateKey });
    expect(verifySessionToken(minted.token)?.address).toBe(operator.address.toLowerCase());
    expect((await readInstallOwner()).owner).toBe(operator.address.toLowerCase());
    await expect(fs.stat(path.join(backend.dataRoot, 'settings', 'owner-claim', 'claim.key'))).rejects.toMatchObject({ code: 'ENOENT' });
    const proofStat = await fs.stat(path.join(backend.dataRoot, 'settings', 'owner-claim', 'proof.key'));
    const proofDirStat = await fs.stat(path.join(backend.dataRoot, 'settings', 'owner-claim'));
    expect(proofStat.mode & 0o777).toBe(0o600);
    expect(proofDirStat.mode & 0o777).toBe(0o700);

    const witness = Wallet.createRandom();
    const sitting = await signInSitting({ base: backend.base, wallet: witness });
    expect(verifySessionToken(sitting.token)?.address).toBe(witness.address.toLowerCase());
  });

  test('a genuine owner challenge/proof relayed from another port gets neither claim nor signature', async () => {
    const backend = await realBackend('cli-claim-relay');
    const attacker = await relay(backend.base);
    const operator = Wallet.createRandom();
    await expect(mintToken({ backend: attacker.base, privateKey: operator.privateKey }))
      .rejects.toThrow('loopback backend identity proof failed; nothing was signed or sent');
    expect(attacker.verifyHits).toEqual([]);
    expect((await readInstallOwner())).toBeNull();
  });

  test('PR20 H-07: an impostor never receives a still-valid cached token', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-cached-token-impostor-'));
    roots.push(root);
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_CLI_CACHE_DIR = path.join(root, 'cli');
    const wallet = Wallet.createRandom();
    const app = express();
    let verifyHits = 0;
    app.use(express.json());
    app.get('/api/v1/auth/challenge', (req, res) => res.json({ challenge: 'not a Neuma sign-in' }));
    app.post('/api/v1/auth/verify', (req, res) => { verifyHits += 1; res.json({ token: 'impostor' }); });
    const server = await listen(app);
    const backend = `http://127.0.0.1:${server.address().port}`;
    const witnessEnv = 'impostor-cache-wallet';
    const key = createHash('sha256').update(`${backend}|${witnessEnv}`).digest('hex').slice(0, 16);
    await fs.mkdir(process.env.NEUMA_CLI_CACHE_DIR, { recursive: true, mode: 0o700 });
    const token = Buffer.from(`${wallet.address.toLowerCase()}:${Date.now() + 3_600_000}:cached`).toString('base64');
    await fs.writeFile(path.join(process.env.NEUMA_CLI_CACHE_DIR, `token-${key}.json`), JSON.stringify({ token, address: wallet.address }), { mode: 0o600 });
    const { getToken } = await import('../../.claude/skills/neuma/lib/token-cache.js?impostor-proof');
    await expect(getToken({ backend, witnessEnv, privateKey: wallet.privateKey })).rejects.toThrow('loopback backend identity proof failed');
    expect(verifyHits).toBe(0);
  });

  test('a genuine witness challenge/proof relayed from another port is never signed', async () => {
    const backend = await realBackend('sitting-relay');
    const attacker = await relay(backend.base);
    const witness = Wallet.createRandom();
    await expect(signInSitting({ base: attacker.base, wallet: witness }))
      .rejects.toThrow('loopback backend identity proof failed; witness challenge was not signed');
    expect(attacker.verifyHits).toEqual([]);
  });
});

describe('private sitting challenge validation', () => {
  test('the real challenge passes; changed binding, statement, fields, and extra text refuse', async () => {
    const backend = await realBackend('sitting-shape');
    const wallet = Wallet.createRandom();
    const response = await fetch(`${backend.base}/api/v1/auth/challenge?address=${wallet.address}`);
    const { challenge } = await response.json();
    expect(validateSittingChallenge(challenge, wallet.address)).toBe(true);
    const hostile = [
      challenge.replace('neuma.local wants', 'attacker.example wants'),
      challenge.replace('URI: https://neuma.local', 'URI: https://attacker.example'),
      challenge.replace('Chain ID: 84532', 'Chain ID: 1'),
      challenge.replace('Sign this message to authenticate with Neuma.', 'Sign this unlimited approval.'),
      `${challenge}\nResources:\n- https://attacker.example`,
      challenge.replace(wallet.address.toLowerCase(), Wallet.createRandom().address.toLowerCase()),
    ];
    for (const message of hostile) expect(validateSittingChallenge(message, wallet.address)).toBe(false);
  });

  test('non-loopback and non-HTTP bases refuse before any network request', async () => {
    expect(() => sittingOrigin('http://example.com')).toThrow('HTTP loopback');
    expect(() => sittingOrigin('https://127.0.0.1:3333')).toThrow('HTTP loopback');
    expect(() => sittingOrigin('http://127.0.0.1:3333/a-path')).toThrow('HTTP loopback');
    expect(() => sittingOrigin('http://localhost:3333/')).toThrow('HTTP loopback');
    expect(sittingOrigin('http://127.0.0.1:3333/')).toBe('http://127.0.0.1:3333');
  });
});
