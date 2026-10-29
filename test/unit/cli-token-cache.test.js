// THE CLI'S TOKEN CACHE IS PRIVATE (audit 2026-10-28 L-05). RULE 0: the real module in a real Node
// process with a throwaway HOME, real files with real modes. It used to live at a predictable name
// in the shared temp dir, so another local user could plant a "cached token" the CLI would trust.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

const MODULE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../.claude/skills/neuma/lib/token-cache.js');
// a backend nobody listens on: a mint attempt fails fast, so "used the cache" is unmistakable
const BACKEND = 'http://127.0.0.1:1';
const WITNESS = 'witness.env';
let home;

const cacheFile = () => {
  const key = createHash('sha256').update(`${BACKEND}|${WITNESS}`).digest('hex').slice(0, 16);
  return path.join(home, '.neuma', 'cli', `token-${key}.json`);
};
// a session token is base64(address:expiresAt:hmac) — far from expiry
const tokenFor = (label) => Buffer.from(`0xabc:${Date.now() + 3_600_000}:${label}`).toString('base64');
const getToken = () => {
  try {
    return execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { getToken } from ${JSON.stringify(MODULE)};
      const t = await getToken({ backend: ${JSON.stringify(BACKEND)}, witnessEnv: ${JSON.stringify(WITNESS)}, privateKey: '0x' + '1'.repeat(64) });
      console.log(t.token);`], { env: { ...process.env, HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'MINT-ATTEMPTED';
  }
};
const plant = (mode) => {
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true, mode: 0o700 });
  const token = tokenFor(`mode-${mode.toString(8)}`);
  fs.writeFileSync(cacheFile(), JSON.stringify({ token, address: '0xabc' }));
  fs.chmodSync(cacheFile(), mode);
  return token;
};

beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-token-home-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

test('the cache lives in the user\'s own ~/.neuma/cli, and a private one is reused', () => {
  const token = plant(0o600);
  expect(getToken()).toBe(token);
});

test.skipIf(process.platform === 'win32')('a cache file others can read or write is never trusted', () => {
  plant(0o644);
  expect(getToken()).toBe('MINT-ATTEMPTED');
  plant(0o666);
  expect(getToken()).toBe('MINT-ATTEMPTED');
});

test.skipIf(process.platform === 'win32')('a symlink standing in for the cache is never followed', () => {
  const elsewhere = path.join(home, 'planted.json');
  fs.writeFileSync(elsewhere, JSON.stringify({ token: tokenFor('planted'), address: '0xabc' }), { mode: 0o600 });
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true, mode: 0o700 });
  fs.symlinkSync(elsewhere, cacheFile());
  expect(getToken()).toBe('MINT-ATTEMPTED');
});
