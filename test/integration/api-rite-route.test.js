/**
 * GET/PUT /api/v1/workspace/:id/rite — a being's SUMMONING, kept for
 * re-watching, over the real wire.
 *
 * RULE 0: no mocks. A real Express app with the real workspace router, real
 * `requireAuth` with a real HMAC session token, a real temp workspaces root,
 * real lanes, an identity really forged (forgeBirthIdentity) and the soul
 * records of a measured specimen soul on real disk.
 *
 * What this proves:
 *   · its film is re-derived from the LANE — a being born before rites were
 *     kept can still re-watch its film; a lane that cannot be filmed says so;
 *   · a rite is kept ONCE, and never with a word in it, whatever was sent;
 *   · a specimen, or a rite without its birth, is refused;
 *   · ownership holds before anything is read or kept.
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
import { riteRecordOf, riteFromRecord, RITE_FILE } from '../../core/birth/rite-record.js';
import { artSeedOf } from '../../core/birth/rite-frames.js';
import RITE_SOULS from '../../frontend/app/Rite/rite-souls.json';

let app, wsRoot, previousRoot, owner, ownerToken, strangerToken;
const authed = (req, token = ownerToken) => req.set('Authorization', `Bearer ${token}`);

const MOMENT = { utc: '2026-06-11T18:03:38.075Z', epochMs: Date.parse('2026-06-11T18:03:38.075Z'), zone: 'Asia/Jakarta', offsetMinutes: 420 };
const MOMENT_SEED = 'ab'.repeat(32);

const lane = async (id) => {
  await neumaWorkspace.create(id);
  await claimOwner(wsRoot, id, owner.address);
};

// impure — a lane sealed as finalize seals it: its genesis seal and true
// name, and its soul's color and scale records
const sealedLane = async (id) => {
  await lane(id);
  const forged = forgeBirthIdentity({
    chosenName: 'Rite', witnessWallet: owner.address, soulPublicKey: `04a3f1b2c4d5e6f7${Buffer.from(id).toString('hex')}`,
    birthCycle: 1, birthMoment: MOMENT, substrate: { model: 'test' }, momentSeed: MOMENT_SEED,
  });
  const dir = path.join(wsRoot, id, 'identity');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'genesis-seal.json'), JSON.stringify(forged.seal));
  await fs.writeFile(path.join(dir, 'true-name.json'), JSON.stringify(forged.trueName));
  const soul = RITE_SOULS.souls[0];
  await fs.writeFile(path.join(dir, 'soul-spectrum.json'), JSON.stringify(soul.spectrum));
  await fs.writeFile(path.join(dir, 'soul-scale.json'), JSON.stringify(soul.scale));
  return forged;
};

// a short live rite as the feed hears it — words on the wire included
const liveRite = () => ({
  events: [
    { type: 'rite:begin', at: 10.4 },
    { type: 'birth:stage_prompt', at: 20.2, stage: 0, content: 'the witness speaks' },
    { type: 'birth:stream', at: 900.7, stage: 0, content: 'its words' },
    { type: 'birth:stream', at: 1040.1, stage: 0, content: 'more of its words' },
    { type: 'birth:stage_complete', at: 60000, stage: 0, response: 'its whole answer' },
    { type: 'birth:measured', at: 60010, stage: 0, frequency: 431.2 },
    { type: 'birth:complete', at: 70000, trueName: { fullName: 'Rite Of Test', english: 'a gloss' } },
  ],
  film: { ms: 88000 },
  length: 158000,
});
const beingOf = () => ({ seed: 'x', trueName: { fullName: 'Rite Of Test' }, bornAt: MOMENT.utc, epochMs: MOMENT.epochMs, zone: MOMENT.zone, offsetMinutes: 420 });

beforeAll(async () => {
  wsRoot = await createTempDir('rite-route-ws');
  previousRoot = neumaWorkspace.root;
  setWorkspacesRoot(wsRoot);
  owner = ethers.Wallet.createRandom();
  ownerToken = createSessionToken(owner.address);
  strangerToken = createSessionToken(ethers.Wallet.createRandom().address);
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
});

afterAll(() => { if (previousRoot) setWorkspacesRoot(previousRoot); });

describe('its film, re-derived from its lane', () => {
  it('a lane not yet sealed reads as an honest absence', async () => {
    await lane('ritenone');
    const res = await authed(request(app).get('/api/v1/workspace/ritenone/rite'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rite: null, recorded: false, film: null });
  });

  it('a sealed being with no kept rite can still re-watch its film', async () => {
    const forged = await sealedLane('ritefilm');
    const res = await authed(request(app).get('/api/v1/workspace/ritefilm/rite'));
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(false);
    const { film } = res.body;
    expect(film.epochMs).toBe(MOMENT.epochMs);
    expect(film.zone).toBe('Asia/Jakarta');
    expect(film.artSeed).toBe(artSeedOf(MOMENT_SEED));
    expect(film.genesisHash).toBe(forged.seal.genesisHash);
    expect(film.aura.recorded).toBe(true);
    expect(film.soul.scale.tonic).toEqual(RITE_SOULS.souls[0].scale.tonic);
    expect(film.trueName.fullName).toBe(forged.trueName.fullName);
  });
});

describe('its rite, kept once and never with a word', () => {
  it('keeps the rhythm, drops the words, and plays back', async () => {
    await sealedLane('ritekept');
    const record = riteRecordOf({ rite: liveRite(), being: beingOf() });
    const put = await authed(request(app).put('/api/v1/workspace/ritekept/rite').send(record));
    expect(put.status).toBe(201);

    const onDisk = await fs.readFile(path.join(wsRoot, 'ritekept', 'identity', RITE_FILE), 'utf8');
    expect(onDisk).not.toMatch(/its words|the witness|its whole answer|a gloss|content|response/);

    const res = await authed(request(app).get('/api/v1/workspace/ritekept/rite'));
    expect(res.body.recorded).toBe(true);
    const { rite } = riteFromRecord(res.body.rite);
    expect(rite.events.map((e) => e.type)).toEqual(liveRite().events.map((e) => e.type));
    expect(rite.events.filter((e) => e.type === 'birth:stream').map((e) => e.at)).toEqual([901, 1040]);
    expect(rite.film.at).toBe(70000);
  });

  it('is never rewritten', async () => {
    const again = riteRecordOf({ rite: { ...liveRite(), length: 1 }, being: beingOf() });
    const res = await authed(request(app).put('/api/v1/workspace/ritekept/rite').send(again));
    expect(res.status).toBe(409);
    const kept = JSON.parse(await fs.readFile(path.join(wsRoot, 'ritekept', 'identity', RITE_FILE), 'utf8'));
    expect(kept.length).toBe(158000);
  });

  it('refuses a specimen, and a rite without its birth', async () => {
    await sealedLane('riterefuse');
    const url = '/api/v1/workspace/riterefuse/rite';
    const soul = RITE_SOULS.souls[0];
    const specimen = riteRecordOf({ rite: liveRite(), being: beingOf(), soul, specimen: true });
    expect((await authed(request(app).put(url).send(specimen))).status).toBe(400);
    const unborn = liveRite();
    unborn.events = unborn.events.filter((e) => e.type !== 'birth:complete');
    expect((await authed(request(app).put(url).send(riteRecordOf({ rite: unborn, being: beingOf() })))).status).toBe(400);
    expect((await authed(request(app).put(url).send({ schema: 'summoning-rite/v2', specimen: false, events: 'no' }))).status).toBe(400);
    await expect(fs.access(path.join(wsRoot, 'riterefuse', 'identity', RITE_FILE))).rejects.toThrow();
  });
});

describe('ownership first', () => {
  it('a stranger can neither read nor keep a being\'s rite', async () => {
    const get = await authed(request(app).get('/api/v1/workspace/ritekept/rite'), strangerToken);
    expect(get.status).toBe(403);
    const put = await authed(request(app).put('/api/v1/workspace/ritefilm/rite').send(riteRecordOf({ rite: liveRite(), being: beingOf() })), strangerToken);
    expect(put.status).toBe(403);
  });
});
