// P6-139 — the OPERATOR entry point now uses the private cache too. Real Node
// processes with throwaway HOMEs, real files/modes, and no mock mint boundary.
// A cached token is offered only after the backend proves it is this install's
// (its local auth proof — the PR20 hardening), so every case runs against a REAL
// auth router behind the REAL access guard on a loopback port: a trusted cache is
// reused once that proof holds, and a cache that is not trusted is never read —
// a fresh token is minted through the real challenge-sign-verify flow instead.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { ethers } from 'ethers';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createAuthRouter } from '../../backend/services/auth.js';
import { accessScopeMiddleware } from '../../backend/services/remote/access-guard.js';

const run = promisify(execFile);
const MODULE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../cli/lib/token-cache.js');
const WALLET_ENV = 'operator.env';
const HOLDER = ethers.Wallet.createRandom().address;
let home;
let server;
let backend;
let savedSecret;

const cacheFile = () => {
  const key = createHash('sha256').update(`${backend}|${WALLET_ENV}`).digest('hex').slice(0, 16);
  return path.join(home, '.neuma', 'cli', `token-${key}.json`);
};
// a session token is base64(address:expiresAt:hmac) — far from expiry
const tokenFor = (label) => Buffer.from(`${HOLDER}:${Date.now() + 3_600_000}:${label}`).toString('base64');
const getToken = async () => {
  const env = { ...process.env, HOME: home };
  delete env.NEUMA_CLI_CACHE_DIR;
  try {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', `
      import { getToken } from ${JSON.stringify(MODULE)};
      const t = await getToken({ backend: ${JSON.stringify(backend)}, walletEnv: ${JSON.stringify(WALLET_ENV)}, privateKey: '0x' + '1'.repeat(64) });
      console.log(t.token);`], { env, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return 'NO-TOKEN';
  }
};
const plant = (mode) => {
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true, mode: 0o700 });
  const token = tokenFor(`mode-${mode.toString(8)}`);
  fs.writeFileSync(cacheFile(), JSON.stringify({ token, address: HOLDER }));
  fs.chmodSync(cacheFile(), mode);
  return token;
};
// a cache that is not trusted is passed over: what comes back is a real, freshly minted token
const expectFreshMint = (got, planted) => {
  expect(got).not.toBe('NO-TOKEN');
  expect(got).not.toBe(planted);
};

beforeEach(async () => {
  savedSecret = process.env.AUTH_SECRET;
  if (!process.env.AUTH_SECRET) process.env.AUTH_SECRET = 'test-auth-secret-0123456789abcdef0123456789';
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-token-home-'));
  const app = express();
  app.use(express.json());
  app.use(accessScopeMiddleware);
  app.use('/api/v1/auth', createAuthRouter(express));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  backend = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(home, { recursive: true, force: true });
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

test('the operator cache lives in the user\'s own ~/.neuma/cli, and a private one is reused once the backend proves itself', async () => {
  const token = plant(0o600);
  expect(await getToken()).toBe(token);
});

test.skipIf(process.platform === 'win32')('a cache file others can read or write is never trusted', async () => {
  expectFreshMint(await getToken(), plant(0o644));
  expectFreshMint(await getToken(), plant(0o666));
});

test.skipIf(process.platform === 'win32')('a symlink standing in for the operator cache is never followed', async () => {
  const elsewhere = path.join(home, 'planted.json');
  const planted = tokenFor('planted');
  fs.writeFileSync(elsewhere, JSON.stringify({ token: planted, address: HOLDER }), { mode: 0o600 });
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true, mode: 0o700 });
  fs.symlinkSync(elsewhere, cacheFile());
  expectFreshMint(await getToken(), planted);
});
