/**
 * GET /api/v1/workspace/:id/aura — the being's form, over the real wire (#405).
 *
 * RULE 0: no mocks anywhere in this path. A real Express app carrying the real
 * workspace router, real `requireAuth` with a real HMAC session token minted
 * for a real wallet, a real temp workspaces root, real lanes scaffolded by the
 * real `create`, and real identity artifacts built by the real producers and
 * written to real files. The derivation that answers is the production one.
 *
 * What this file proves that the unit test cannot: that the ROUTE reads the
 * right two artifacts off the right lane, that ownership is enforced before a
 * being's form is handed to anyone, and that the payload survives JSON — the
 * desk gets numbers it can actually sweep, not a serialised Float32Array.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';
import { buildSignature, LEAN } from '../../core/kotodama/signature.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { auraPoint } from '../../core/aura/form.js';

let app, wsRoot, previousRoot, owner, ownerToken, stranger, strangerToken;

const authed = (req) => req.set('Authorization', `Bearer ${ownerToken}`);

/** A real lane, really claimed, carrying real identity anchors on real disk. */
const anchoredLane = async (id, { name, soulHex }) => {
  await neumaWorkspace.create(id);
  await claimOwner(wsRoot, id, owner.address);
  const signature = buildSignature({
    chosenName: name, genesisName: 'Yumaihe', houseName: 'Aldmere',
    lean: LEAN.UNALIGNED, soulHex,
  });
  const seal = buildGenesisSeal({
    chosenName: name,
    lean: LEAN.UNALIGNED,
    witnessWallet: owner.address,
    soulPublicKey: `0x${soulHex.repeat(4)}`,
    birthCycle: 1,
    birthMoment: {
      utc: '2026-08-25T00:00:00.000Z', epochMs: 1787616000000,
      zone: 'Asia/Jakarta', offsetMinutes: 420,
    },
    substrate: { llm: { model: 'qwen3.8-27b' } },
  });
  const dir = path.join(neumaWorkspace.pathFor(id), 'identity');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'true-name.json'),
    JSON.stringify({ ...signature, items: undefined, genesisHash: seal.genesisHash }),
  );
  await fs.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(seal));
  return id;
};

beforeAll(async () => {
  owner = ethers.Wallet.createRandom();
  ownerToken = createSessionToken(owner.address);
  stranger = ethers.Wallet.createRandom();
  strangerToken = createSessionToken(stranger.address);

  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('aura-route-real');
  setWorkspacesRoot(wsRoot);

  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);

  await anchoredLane('aura-route-ashwren', { name: 'Ashwren', soulHex: '33314C2FEDE1A1B2' });
  await anchoredLane('aura-route-corvane', { name: 'Corvane', soulHex: 'C8432853728D9C40' });
  await neumaWorkspace.create('aura-route-newborn');
  await claimOwner(wsRoot, 'aura-route-newborn', owner.address);
  // A hollow lane needs SOMETHING for the ownership gate to admit it as
  // inhabited; genesis.md is the other anchor `carriesBeing` accepts.
  const dnaDir = path.join(neumaWorkspace.pathFor('aura-route-newborn'), 'dna');
  await fs.mkdir(dnaDir, { recursive: true });
  await fs.writeFile(path.join(dnaDir, 'genesis.md'), '# not yet named\n');
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
});

describe('the aura route', () => {
  it('serves a form derived from the lane\'s own anchors', async () => {
    const res = await authed(request(app).get('/api/v1/workspace/aura-route-ashwren/aura'));
    expect(res.status).toBe(200);
    const { aura } = res.body;
    expect(aura.recorded).toBe(true);
    expect(aura.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(aura.schema).toBe('aura/v1');
    expect(aura.cycle).toBeGreaterThan(0);
    expect(aura.fit.scale).toBeGreaterThan(0);
  });

  it('sends a form the desk can actually sweep after JSON', async () => {
    const res = await authed(request(app).get('/api/v1/workspace/aura-route-ashwren/aura'));
    const { form, fit, cycle } = res.body.aura;
    // The desk calls exactly this, with exactly what arrived over the wire.
    for (const t of [0, cycle / 4, cycle / 2]) {
      const [x, y] = auraPoint(form, form.p.sweep / 2, t);
      expect(Number.isFinite(x), 'the wire form does not sweep').toBe(true);
      expect(Number.isFinite(y), 'the wire form does not sweep').toBe(true);
      // And it lands inside the frame the whole-cycle fit promises.
      expect(Math.abs((x - fit.cx) * fit.scale)).toBeLessThan(50);
    }
    // The 256-float perceptual descriptor must NOT ride along: nothing draws
    // it, and serialised it is a Float32Array turned into 256 numbered keys.
    expect(res.body.aura.descriptor).toBeUndefined();
  });

  it('gives two beings two different forms', async () => {
    const [one, two] = await Promise.all([
      authed(request(app).get('/api/v1/workspace/aura-route-ashwren/aura')),
      authed(request(app).get('/api/v1/workspace/aura-route-corvane/aura')),
    ]);
    expect(one.body.aura.seed).not.toBe(two.body.aura.seed);
    expect(JSON.stringify(one.body.aura.form)).not.toBe(JSON.stringify(two.body.aura.form));
  });

  it('answers the same form on every call — no stored state, no drift', async () => {
    const first = await authed(request(app).get('/api/v1/workspace/aura-route-ashwren/aura'));
    const second = await authed(request(app).get('/api/v1/workspace/aura-route-ashwren/aura'));
    expect(second.body).toEqual(first.body);
  });

  it('reports an honest absence for a lane with no anchors yet', async () => {
    const res = await authed(request(app).get('/api/v1/workspace/aura-route-newborn/aura'));
    expect(res.status).toBe(200);
    expect(res.body.aura).toEqual({ recorded: false });
  });

  it('refuses a wallet that does not own the lane', async () => {
    const res = await request(app)
      .get('/api/v1/workspace/aura-route-ashwren/aura')
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.aura).toBeUndefined();
  });

  it('refuses an unauthenticated reader', async () => {
    const res = await request(app).get('/api/v1/workspace/aura-route-ashwren/aura');
    expect(res.status).toBe(401);
  });
});
