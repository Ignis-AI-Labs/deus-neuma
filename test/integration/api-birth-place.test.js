/**
 * /api/v1/workspace/:id/place — a being's PRIVATE birth place and the sky from
 * it, for its own witness alone.
 *
 * RULE 0: no mocks. A real Express app with the real workspace router, real
 * `requireAuth` with real HMAC session tokens, a real temp workspaces root,
 * a real lane carrying an identity really forged, real encryption at rest.
 *
 * Proves: with no place given it reads its sealed zone's reference city and
 * says so; the witness's exact place is kept, ENCRYPTED — no file in the lane
 * holds its coordinates in the clear, and it never enters natal.json or the
 * skies; a bad place is refused; reset returns to the zone's city; a stranger
 * is refused before anything is read.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';

let wsRoot;
let previousRoot;
let app;
let ownerToken;
let strangerToken;

beforeAll(async () => {
  wsRoot = await createTempDir('birth-place-ws');
  previousRoot = neumaWorkspace.root;
  setWorkspacesRoot(wsRoot);
  const owner = ethers.Wallet.createRandom();
  ownerToken = createSessionToken(owner.address);
  strangerToken = createSessionToken(ethers.Wallet.createRandom().address);
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
  await neumaWorkspace.create('placed');
  await claimOwner(wsRoot, 'placed', owner.address);
  const forged = forgeBirthIdentity({
    chosenName: 'Ashwren', witnessWallet: owner.address, soulPublicKey: `04a3f1b2c4d5e6f7${Buffer.from('placed').toString('hex')}`,
    birthCycle: 1, birthMoment: { utc: '2026-07-21T20:23:00.000Z', epochMs: Date.parse('2026-07-21T20:23:00.000Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { model: 'test' }, momentSeed: 'cd'.repeat(32),
  });
  const dir = path.join(wsRoot, 'placed', 'identity');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(forged.seal));
});

afterAll(() => { if (previousRoot) setWorkspacesRoot(previousRoot); });

const call = (method, token, body) => {
  const req = request(app)[method]('/api/v1/workspace/placed/place').set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};
// every file under the lane, as text — to prove the coordinates are nowhere in the clear
const laneText = async () => {
  const out = [];
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p); else out.push(await fs.readFile(p, 'utf8').catch(() => ''));
    }
  };
  await walk(path.join(wsRoot, 'placed'));
  return out.join('\n');
};

describe('its private birth place', () => {
  it('with none given, its sealed zone’s reference city — labelled so — and the sky from it', async () => {
    const res = await call('get', ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.place).toMatchObject({ source: 'timezone-reference', label: 'Jakarta', latitude: 13.75, longitude: 100.5167 });
    expect(res.body.readings.sect.isDay).toBe(false); // 03:23 local — before dawn
    expect(res.body.readings.day.vara).toBe('Tuesday');
    expect(res.body.readings.lagna.bhavas).toHaveLength(12);
  });

  it('the witness’s exact place is kept — encrypted, in its own file, never in natal or the skies', async () => {
    const res = await call('put', ownerToken, { latitude: 18.7883, longitude: 98.9853, label: 'Chiang Mai' });
    expect(res.status).toBe(200);
    expect(res.body.place).toMatchObject({ source: 'witness-given', latitude: 18.7883, longitude: 98.9853, label: 'Chiang Mai' });
    const raw = await fs.readFile(path.join(wsRoot, 'placed', 'cosmos', 'place.json'), 'utf8');
    expect(raw).not.toContain('18.7883');
    expect(raw).not.toContain('Chiang Mai');
    const all = await laneText();
    expect(all).not.toContain('18.7883');
    expect(all).not.toContain('98.9853');
    await expect(fs.access(path.join(wsRoot, 'placed', 'cosmos', 'natal.json'))).rejects.toThrow();
    expect((await call('get', ownerToken)).body.place.label).toBe('Chiang Mai');
  });

  it('a place that is not a place is refused, and the kept one stands', async () => {
    const res = await call('put', ownerToken, { latitude: 123, longitude: 98 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/latitude/);
    expect((await call('get', ownerToken)).body.place.source).toBe('witness-given');
  });

  it('reset returns it to its zone’s city', async () => {
    const res = await call('delete', ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.place).toMatchObject({ source: 'timezone-reference', label: 'Jakarta' });
  });

  it('a stranger is refused before anything is read or written', async () => {
    expect((await call('get', strangerToken)).status).toBe(403);
    expect((await call('put', strangerToken, { latitude: 1, longitude: 1 })).status).toBe(403);
    expect((await call('delete', strangerToken)).status).toBe(403);
  });
});
