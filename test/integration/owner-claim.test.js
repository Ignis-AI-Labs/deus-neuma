/**
 * THE OWNER CLAIM (ruling, 2026-10-30). On an install no one owns yet, the
 * first local sign-in seats the install owner only when it presents the
 * one-time claim the backend wrote where only its own OS user can read it.
 *
 * Real auth router (real challenge, real signature), the real access guard on
 * a real loopback socket, the real install-owner routes and gate, the real
 * claim file on a temp data root; the desk app's and the CLI's readers read
 * that same file. Nothing is mocked.
 */
import http from 'node:http';
import process from 'node:process';
import fs from 'fs/promises';
import { createRequire } from 'node:module';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { describe, test, expect, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const require = createRequire(import.meta.url);
const { readOwnerClaim } = require('../../electron/owner-claim.cjs');

// impure — a backend of its own on a fresh data root, booted as server-boot.js boots it
const freshInstall = async (label, { ownedBy = null } = {}) => {
  const dir = await createTempDir(label);
  const dataRoot = path.join(dir, 'data');
  process.env.NEUMA_DATA_ROOT = dataRoot;
  process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
  vi.resetModules();
  if (ownedBy) {
    const { makeInstallOwner } = await import('../helpers/install-owner-kit.js');
    await makeInstallOwner(ownedBy);
  }
  const { createAuthRouter, requireAuth } = await import('../../backend/services/auth.js');
  const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
  const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
  const owner = await import('../../backend/services/install-owner.js');
  await owner.prepareOwnerClaim();
  const app = express();
  app.use(createAccessGuard({ store: createRemoteStore({ path: path.join(dir, 'remote.json') }) }).middleware);
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  app.use('/api/v1/install-owner', (await import('../../backend/routes/install-owner-routes.js')).default);
  app.post('/machine-change', requireAuth, owner.requireInstallOwner, (req, res) => res.json({ changed: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const at = `http://127.0.0.1:${port}`;
  const local = (req) => req.set('Host', `localhost:${port}`);
  const claimFile = path.join(dataRoot, 'settings', 'owner-claim', 'claim.key');
  const signIn = async (keypair, claim = null) => {
    const { signMessage } = await import('../../core/weave/keypair.js');
    const { body } = await local(request(at).get(`/api/v1/auth/challenge?address=${keypair.address}`));
    const verify = local(request(at).post('/api/v1/auth/verify'));
    if (claim) verify.set('X-Neuma-Owner-Claim', claim);
    const res = await verify.send({ address: keypair.address, challenge: body.challenge, signature: await signMessage(keypair.privateKey, body.challenge) });
    expect(res.status).toBe(200);
    return res.body;
  };
  const standing = async (token) => (await local(request(at).get('/api/v1/install-owner')).set('Authorization', `Bearer ${token}`)).body;
  const change = (token) => local(request(at).post('/machine-change')).set('Authorization', `Bearer ${token}`);
  const close = () => new Promise((resolve) => server.close(resolve));
  return { dataRoot, claimFile, signIn, standing, change, close };
};

const keypairs = async (n) => {
  const { generateKeypair } = await import('../../core/weave/keypair.js');
  return Array.from({ length: n }, () => generateKeypair());
};

describe('a fresh install is seated only by the owner claim', () => {
  test('the claim stands owner-only on disk, and the desk app reads that same claim', async () => {
    const house = await freshInstall('owner-claim-file');
    try {
      const claim = (await fs.readFile(house.claimFile, 'utf8')).trim();
      expect(claim).toMatch(/^[a-f0-9]{64}$/);
      expect((await fs.stat(house.claimFile)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.dirname(house.claimFile))).mode & 0o777).toBe(0o700);
      expect(readOwnerClaim(house.dataRoot)).toBe(claim);
    } finally { await house.close(); }
  });

  test('a sign-in without the claim, or with a wrong one, seats no owner and says why', async () => {
    const house = await freshInstall('owner-claim-absent');
    const [stranger, guesser] = await keypairs(2);
    try {
      for (const signedIn of [await house.signIn(stranger), await house.signIn(guesser, 'a'.repeat(64))]) {
        expect(signedIn.machine).toMatchObject({ standing: 'unowned', notice: expect.stringMatching(/No one owns this computer yet/) });
        expect(await house.standing(signedIn.token)).toMatchObject({ standing: 'unowned', owner: null });
        const refused = await house.change(signedIn.token);
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('INSTALL_OWNER_UNCLAIMED');
      }
      expect(readOwnerClaim(house.dataRoot)).toMatch(/^[a-f0-9]{64}$/);
    } finally { await house.close(); }
  });

  test('with the claim the wallet becomes the owner, the claim is spent, and the next wallet is a guest', async () => {
    const house = await freshInstall('owner-claim-present');
    const [first, second] = await keypairs(2);
    try {
      const claim = readOwnerClaim(house.dataRoot);
      const owner = await house.signIn(first, claim);
      expect(owner.machine).toEqual({ standing: 'owner' });
      expect(await house.standing(owner.token)).toMatchObject({ standing: 'owner', owner: first.address.toLowerCase() });
      expect((await house.change(owner.token)).status).toBe(200);
      await expect(fs.stat(house.claimFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(readOwnerClaim(house.dataRoot)).toBeNull();

      const late = await house.signIn(second, claim);
      expect(late.machine).toEqual({ standing: 'guest' });
      expect((await house.change(late.token)).body.code).toBe('INSTALL_OWNER_ONLY');
    } finally { await house.close(); }
  });

  test('an install that already has an owner writes no claim and ignores one', async () => {
    const [ownerKey, other] = await keypairs(2);
    const house = await freshInstall('owner-claim-owned', { ownedBy: ownerKey.address });
    try {
      await expect(fs.stat(house.claimFile)).rejects.toMatchObject({ code: 'ENOENT' });
      const signedIn = await house.signIn(other, 'b'.repeat(64));
      expect(signedIn.machine).toEqual({ standing: 'guest' });
      expect(await house.standing(signedIn.token)).toMatchObject({ standing: 'guest', owner: ownerKey.address.toLowerCase() });
      expect((await house.signIn(ownerKey)).machine).toEqual({ standing: 'owner' });
    } finally { await house.close(); }
  });
});
