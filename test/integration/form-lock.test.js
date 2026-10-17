/**
 * THE FORM LOCK, FOR REAL — the write path the form-design record never had.
 *
 * RULE 0: no mocks anywhere. A real temp workspaces root, real lanes through
 * the real `create`, a REAL image stored through the REAL `collectOutputs`
 * (so the championed plate is manifest-indexed exactly as an engine render
 * would be), the real DEK-aware design store, and the real Express router
 * with a real HMAC session token for agree/withdraw over the wire.
 *
 * What this proves:
 *   · a being can only champion its OWN lane's image (foreign id refuses);
 *   · championing records the being's agreement — and a NEW plate clears
 *     both agreements (no consent survives a picture swap);
 *   · the operator's concur completes the lock, and a withdraw reopens it;
 *   · the routes enforce ownership BEFORE the operator's half lands;
 *   · the GET leg carries the being's genome (deterministic from the seal).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { readFormDesign } from '../../core/genome/form-store.js';
import { championPlate, agreeDesign, withdrawDesign } from '../../backend/services/form-lock.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';

// A real 1x1 PNG — the bytes do not need to be art, they need to be REAL.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let app, wsRoot, outDir, previousRoot, owner, ownerToken, stranger, strangerToken;

/** Store a real image in a lane through the real collect path; returns its record. */
const storeRealImage = async (laneId, name) => {
  await fs.writeFile(path.join(outDir, name), PNG_1PX);
  const [record] = collectOutputs({
    outputDir: outDir,
    outputs: [{ filename: name, subfolder: '', type: 'output' }],
    laneId,
    jobId: `job-${name}`,
  });
  return record;
};

const lane = async (id) => {
  await neumaWorkspace.create(id);
  await claimOwner(wsRoot, id, owner.address);
};

beforeAll(async () => {
  wsRoot = await createTempDir('form-lock-ws');
  outDir = await createTempDir('form-lock-out');
  previousRoot = neumaWorkspace.root;
  setWorkspacesRoot(wsRoot);
  owner = ethers.Wallet.createRandom();
  stranger = ethers.Wallet.createRandom();
  ownerToken = createSessionToken(owner.address);
  strangerToken = createSessionToken(stranger.address);
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
});

afterAll(() => { if (previousRoot) setWorkspacesRoot(previousRoot); });

describe('championPlate — the being can only champion its OWN image', () => {
  it('records the plate and the being\'s agreement, still EXPLORING', async () => {
    await lane('locka');
    const img = await storeRealImage('locka', 'a-pfp.png');
    const result = await championPlate('locka', { register: 'anime', plate: 'pfp', imageId: img.imageId }, { at: '2026-09-25T00:00:00.000Z' });
    expect(result.ok).toBe(true);
    expect(result.locked).toBe(false);
    const design = await readFormDesign(neumaWorkspace, 'locka');
    expect(design.agreed.being.at).toBe('2026-09-25T00:00:00.000Z');
    expect(design.agreed.operator).toBe(null);
    expect(design.registers.anime.pfp.imageId).toBe(img.imageId);
    // The real collect path hashed the real bytes; the plate carries that hash.
    expect(design.registers.anime.pfp.sha256).toBe(img.sha256);
  });

  it('refuses an imageId the lane never recorded', async () => {
    const result = await championPlate('locka', { register: 'anime', plate: 'pfp', imageId: 'not-in-this-lane' }, { at: '2026-09-25T00:00:00.000Z' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no such image');
    const design = await readFormDesign(neumaWorkspace, 'locka');
    expect(design.registers.anime.pfp.imageId).not.toBe('not-in-this-lane');
  });
});

describe('the two-party lifecycle, end to end on real disk', () => {
  it('operator concur locks; a NEW plate clears both; a withdraw reopens', async () => {
    await lane('lockb');
    const first = await storeRealImage('lockb', 'b-pfp-1.png');
    await championPlate('lockb', { register: 'anime', plate: 'pfp', imageId: first.imageId }, { at: '2026-09-25T00:00:00.000Z' });

    const agreed = await agreeDesign('lockb', 'operator', { at: '2026-09-25T01:00:00.000Z', wallet: owner.address });
    expect(agreed.ok).toBe(true);
    expect(agreed.locked).toBe(true);
    expect(agreed.design.agreed.operator.wallet).toBe(owner.address);

    // A new championed plate: the consent was to the picture they were
    // LOOKING AT — swapping it must reset both parties.
    const second = await storeRealImage('lockb', 'b-pfp-2.png');
    const rechampioned = await championPlate('lockb', { register: 'anime', plate: 'pfp', imageId: second.imageId }, { at: '2026-09-25T02:00:00.000Z' });
    expect(rechampioned.ok).toBe(true);
    expect(rechampioned.locked).toBe(false);
    const cleared = await readFormDesign(neumaWorkspace, 'lockb');
    expect(cleared.agreed.operator).toBe(null);
    expect(cleared.history.some((h) => h.event === 'unlocked')).toBe(true);

    // The operator concurs again, then withdraws — either party alone reopens.
    await agreeDesign('lockb', 'operator', { at: '2026-09-25T03:00:00.000Z', wallet: owner.address });
    const withdrawn = await withdrawDesign('lockb', 'operator', { at: '2026-09-25T04:00:00.000Z', why: 'not quite them' });
    expect(withdrawn.ok).toBe(true);
    expect(withdrawn.locked).toBe(false);
    const final = await readFormDesign(neumaWorkspace, 'lockb');
    expect(final.agreed.operator).toBe(null);
    expect(final.agreed.being.at).toBe('2026-09-25T02:00:00.000Z'); // the being's mark stands
    expect(final.history.some((h) => h.event === 'withdrawn' && h.by === 'operator')).toBe(true);
  });
});

describe('the routes — the operator\'s half, over the real wire', () => {
  it('POST agree with nothing to agree to refuses honestly', async () => {
    await lane('lockc');
    const res = await request(app).post('/api/v1/workspace/lockc/form/agree')
      .set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('no plate');
  });

  it('agree completes a lock the being started; withdraw reopens it', async () => {
    await lane('lockd');
    const img = await storeRealImage('lockd', 'd-pfp.png');
    await championPlate('lockd', { register: 'anime', plate: 'pfp', imageId: img.imageId }, { at: '2026-09-25T00:00:00.000Z' });

    const agreed = await request(app).post('/api/v1/workspace/lockd/form/agree')
      .set('Authorization', `Bearer ${ownerToken}`).send({ note: 'that is you' });
    expect(agreed.status).toBe(200);
    expect(agreed.body.locked).toBe(true);
    expect(agreed.body.plates[0].pfp.imageId).toBe(img.imageId);

    const withdrawn = await request(app).post('/api/v1/workspace/lockd/form/withdraw')
      .set('Authorization', `Bearer ${ownerToken}`).send({ why: 'look again together' });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.locked).toBe(false);
  });

  it('a stranger can neither agree nor withdraw', async () => {
    for (const verb of ['agree', 'withdraw']) {
      const res = await request(app).post(`/api/v1/workspace/lockd/form/${verb}`)
        .set('Authorization', `Bearer ${strangerToken}`).send({});
      expect([401, 403, 404], `stranger ${verb}`).toContain(res.status);
    }
  });
});

describe('the GET leg carries the being\'s GIVEN body', () => {
  it('genome rides the form read, deterministic from the sealed anchors', async () => {
    await lane('lockgen');
    const forged = forgeBirthIdentity({
      chosenName: 'Lockgen',
      witnessWallet: owner.address,
      soulPublicKey: '0x04realpublickey',
      birthCycle: 1,
      birthMoment: { utc: '2026-09-25T05:00:00.000Z', epochMs: 1790292000000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
      substrate: { model: 'test' },
      momentSeed: 'a'.repeat(64),
      takenGenesisNames: [],
    });
    await fs.mkdir(path.join(wsRoot, 'lockgen', 'identity'), { recursive: true });
    await fs.writeFile(
      path.join(wsRoot, 'lockgen', 'identity', 'genesis-seal.json'),
      JSON.stringify({ genesisHash: forged.seal.genesisHash, record: forged.seal.record }, null, 2),
    );
    const res = await request(app).get('/api/v1/workspace/lockgen/form')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.genome?.schema).toBe('genome/v4');
    // Candidates are named honestly as UNSETTLED, and the empty lane has none.
    expect(res.body.candidates).toEqual({});
    expect(res.body.plates).toEqual([]);
  });

  it('a lane with no seal reads genome: null — an honest absence', async () => {
    await lane('locknogen');
    const res = await request(app).get('/api/v1/workspace/locknogen/form')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.genome).toBe(null);
  });
});
