// Route-level proof of POST /neuma-auth/reset-password — real Express, real
// vault crypto, real fetch (auth-route convention: no mocked data path).
// Born from Cael's envelope taking a typo at securing: the recovery codes
// must be able to re-seal the SAME keypair under a fresh password without
// touching the key or the recovery lane.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  encryptKeypair, decryptKeypair, generateRecoveryCodes, hashRecoveryCodes,
  encryptWithRecoveryCodes,
} from '../../core/wallet/keypair-vault.js';
import { generateKeypair } from '../../core/weave/keypair.js';
import { createSessionToken } from '../../backend/services/auth.js';
import neumaAuthRouter from '../../backend/routes/neuma-auth-routes.js';

const NEUMA = 'reset-pass-being';
const WITNESS = '0x' + 'a1'.repeat(20);
const TYPOED_PASSWORD = 'the-typoed-password-13'; // what the witness THINKS is something else
const NEW_PASSWORD = 'the-corrected-password-13';

let root;
let server;
let base;
let token;
let keypair;
let codes;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'reset-pass-'));
  setWorkspacesRoot(root);

  // A real secured lane, exactly as birth:encrypt_keypair writes it.
  keypair = generateKeypair();
  codes = [...generateRecoveryCodes()];
  const lane = path.join(root, NEUMA);
  await fs.mkdir(path.join(lane, 'keys'), { recursive: true });
  await fs.mkdir(path.join(lane, 'audit'), { recursive: true });
  await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet: WITNESS }));
  await fs.writeFile(path.join(lane, 'keys', 'keypair-encrypted.json'),
    JSON.stringify(encryptKeypair(keypair, TYPOED_PASSWORD)));
  await fs.writeFile(path.join(lane, 'keys', 'recovery-hash.json'),
    JSON.stringify({ hash: hashRecoveryCodes(codes) }));
  await fs.writeFile(path.join(lane, 'keys', 'keypair-recovery.json'),
    JSON.stringify(encryptWithRecoveryCodes(keypair, codes)));

  const app = express();
  app.use(express.json());
  app.use('/api/v1/neuma-auth', neumaAuthRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/v1/neuma-auth`;
  token = createSessionToken(WITNESS);
});

afterAll(async () => {
  server?.close();
  setWorkspacesRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

const post = (body, auth = token) => fetch(`${base}/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
  body: JSON.stringify(body),
});

const readEnvelope = async () => JSON.parse(
  await fs.readFile(path.join(root, NEUMA, 'keys', 'keypair-encrypted.json'), 'utf8'));

describe('POST /neuma-auth/reset-password', () => {
  test('wrong codes are refused and the envelope is untouched', async () => {
    const before = await readEnvelope();
    const wrong = codes.map((c) => c.split('').reverse().join(''));
    const res = await post({ neumaId: NEUMA, recoveryCodes: wrong, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(await readEnvelope()).toEqual(before);
  });

  test('short password and wrong code count are refused', async () => {
    expect((await post({ neumaId: NEUMA, recoveryCodes: codes, newPassword: 'short' })).status).toBe(400);
    expect((await post({ neumaId: NEUMA, recoveryCodes: codes.slice(0, 7), newPassword: NEW_PASSWORD })).status).toBe(400);
  });

  test('a foreign wallet cannot re-key the lane', async () => {
    const foreign = createSessionToken('0x' + 'b2'.repeat(20));
    const res = await post({ neumaId: NEUMA, recoveryCodes: codes, newPassword: NEW_PASSWORD }, foreign);
    expect([401, 403]).toContain(res.status);
  });

  test('the right codes re-seal the SAME keypair under the new password', async () => {
    const res = await post({ neumaId: NEUMA, recoveryCodes: codes, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.address).toBe(keypair.address);

    // The new password opens the envelope; the key is byte-identical.
    const envelope = await readEnvelope();
    const opened = decryptKeypair(envelope, NEW_PASSWORD);
    expect(opened.privateKey).toBe(keypair.privateKey);
    expect(opened.address).toBe(keypair.address);

    // The typoed password is dead; the recovery lane is untouched.
    expect(() => decryptKeypair(envelope, TYPOED_PASSWORD)).toThrow();
    const recovery = JSON.parse(
      await fs.readFile(path.join(root, NEUMA, 'keys', 'keypair-recovery.json'), 'utf8'));
    expect(recovery.address).toBe(keypair.address);
  });
});
