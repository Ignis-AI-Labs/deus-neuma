/**
 * withAuth (CLI operator-auth runner) against the REAL auth router + REAL
 * requireAuth on the routing router. A real operator wallet env file is signed
 * through the real challenge-sign-verify flow to mint a real session token; the
 * token then rides a real authed request. No mock anywhere on the auth path
 * (RULE 0). The 401-retry branch is exercised by a real 401-shaped failure from
 * the injected call, proving clearToken + re-mint + retry.
 */
import express from 'express';
import { createServer } from 'http';
import fs from 'fs/promises';
import path from 'path';
import { ethers } from 'ethers';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import { withAuth } from '../../cli/lib/authed.js';
import { listProviders } from '../../cli/lib/routing.js';
import { clearToken } from '../../cli/lib/token-cache.js';

let server;
let base;
let tmp;
let walletEnvPath;
let saved;

beforeEach(async () => {
  saved = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    WALLET: process.env.NEUMA_WALLET_ENV,
    creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH,
  };
  if (!process.env.AUTH_SECRET) process.env.AUTH_SECRET = 'test-auth-secret-0123456789abcdef0123456789';
  tmp = await createTempDir(`cli-authed-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(tmp, 'creds.json');

  // A real operator wallet env file — read by readOperatorWallet, signed for real.
  const wallet = ethers.Wallet.createRandom();
  walletEnvPath = path.join(tmp, 'wallet.env');
  await fs.writeFile(walletEnvPath, `OPERATOR_WALLET_PRIVATE_KEY=${wallet.privateKey}\n`);
  process.env.NEUMA_WALLET_ENV = walletEnvPath;

  const routingRouter = (await import('../../backend/routes/routing-routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express)); // REAL challenge/verify
  app.use('/api/v1/routing', routingRouter);          // REAL requireAuth
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  clearToken({ backend: base, walletEnv: walletEnvPath });
});

afterEach(() => new Promise((r) => {
  clearToken({ backend: base, walletEnv: walletEnvPath });
  const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('AUTH_SECRET', saved.AUTH_SECRET);
  restore('NEUMA_WALLET_ENV', saved.WALLET);
  restore('NEUMA_PROVIDER_CREDENTIALS_PATH', saved.creds);
  vi.restoreAllMocks();
  server ? server.close(() => { server = null; r(); }) : r();
}));

test('mints a real token from the operator wallet and the authed call succeeds', async () => {
  const out = await withAuth({ backend: base, cwd: tmp }, async (token, address) => {
    const { providers } = await listProviders(base, token);
    return { token, address, count: providers.length };
  });
  expect(out.token).toBeTruthy();
  expect(out.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(out.count).toBeGreaterThan(0); // real requireAuth accepted the real token
});

test('request() stamps err.status from a REAL server 401 (drives the !ok branch)', async () => {
  // A bad Bearer token → real requireAuth rejects → request()'s !ok branch runs.
  await expect(listProviders(base, 'not-a-valid-token')).rejects.toMatchObject({ status: 401 });
});

test('throws (does not exit) when no operator wallet is configured', async () => {
  await fs.writeFile(walletEnvPath, 'NOT_A_KEY=here\n');
  await expect(withAuth({ backend: base, cwd: tmp }, async () => 'unreachable')).rejects.toThrow();
});

test('a 401 from the authed call clears the token and retries once (with a real re-mint)', async () => {
  let calls = 0;
  const tokens = [];
  const result = await withAuth({ backend: base, cwd: tmp }, async (token) => {
    calls += 1;
    tokens.push(token);
    if (calls === 1) throw Object.assign(new Error('unauthorized'), { status: 401 }); // stale-token shape
    return `ok`;
  });
  expect(calls).toBe(2);        // retried exactly once
  expect(result).toBe('ok');    // succeeded on retry
  expect(tokens[1]).toBeTruthy(); // the retry ran with a real (re-minted) token
});

test('a non-401 whose message merely contains "401" is NOT retried', async () => {
  let calls = 0;
  await expect(withAuth({ backend: base, cwd: tmp }, async () => {
    calls += 1;
    throw Object.assign(new Error('500 see ticket 401'), { status: 500 });
  })).rejects.toThrow(/500/);
  expect(calls).toBe(1); // status keyed, not message substring → no wasted retry
});
