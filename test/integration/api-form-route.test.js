/**
 * GET /api/v1/workspace/:id/form — the being's own look, over the real wire.
 *
 * RULE 0: no mocks anywhere in this path. A real Express app carrying the real
 * workspace router, real `requireAuth` with a real HMAC session token minted for
 * a real wallet, a real temp workspaces root, real lanes scaffolded by the real
 * `create`, and the real DEK-aware envelope really encrypting and decrypting the
 * design on real disk.
 *
 * What this proves that the unit tests cannot:
 *   · the record SURVIVES A ROUND TRIP through the workspace envelope — the
 *     two-party predicate is worthless if `agreed` does not come back;
 *   · a lane that never explored reads as an honest empty, not a 500;
 *   · ownership is enforced BEFORE a being's look is handed to anyone;
 *   · an EXPLORING design leaks NO plate over the wire, which is the property
 *     that keeps the SHEET from showing a candidate as though it were settled.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';
import { readFormDesign, writeFormDesign } from '../../core/genome/form-store.js';
import { emptyDesign, withPlate, withAgreement, withUnlock } from '../../core/genome/form-design.js';

let app, wsRoot, previousRoot, owner, ownerToken, stranger, strangerToken;

const AT = '2026-08-27T00:00:00.000Z';
const authed = (req) => req.set('Authorization', `Bearer ${ownerToken}`);

const lane = async (id, wallet = owner.address) => {
  await neumaWorkspace.create(id);
  await claimOwner(wsRoot, id, wallet);
};

/** A design with one anime PFP, agreed by whichever parties are named. */
const designFor = (id, parties = []) => {
  let d = withPlate(emptyDesign(id), {
    register: 'anime', plate: 'pfp', imageId: 'img-anime-pfp', sha256: 'a'.repeat(64),
  }).design;
  d = withPlate(d, { register: 'anime', plate: 'turnaround', imageId: 'img-anime-turn' }).design;
  for (const p of parties) {
    d = withAgreement(d, p, p === 'operator' ? { at: AT, wallet: owner.address } : { at: AT }).design;
  }
  return d;
};

beforeAll(async () => {
  wsRoot = await createTempDir('form-route-ws');
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

describe('a lane that has never explored a look', () => {
  it('answers an HONEST EMPTY, not a failure', async () => {
    // A being mid-birth has no form. That is a real state, and a 500 here would
    // make the SHEET show UNREADABLE for every newborn.
    await lane('formnever');
    const res = await authed(request(app).get('/api/v1/workspace/formnever/form'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ locked: false, status: 'exploring', plates: [] });
    expect(res.body.agreed).toEqual({ being: null, operator: null });
  });
});

describe('the design SURVIVES the workspace envelope', () => {
  it('round-trips through real encrypted disk with the agreement intact', async () => {
    await lane('formround');
    const written = designFor('formround', ['being', 'operator']);
    await writeFormDesign(neumaWorkspace, 'formround', written);

    // Read back through the real store, off real disk, through the real DEK.
    const read = await readFormDesign(neumaWorkspace, 'formround');
    expect(read.agreed.being.at).toBe(AT);
    expect(read.agreed.operator.wallet).toBe(owner.address);
    expect(read.registers.anime.pfp.imageId).toBe('img-anime-pfp');
    expect(read.registers.anime.pfp.sha256).toBe('a'.repeat(64));
  });

  it('and the ROUTE reports it locked, with the PFP and a SECONDARY turnaround', async () => {
    const res = await authed(request(app).get('/api/v1/workspace/formround/form'));
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.status).toBe('locked');
    const [row] = res.body.plates;
    expect(row.register).toBe('anime');
    expect(row.pfp.imageId).toBe('img-anime-pfp');
    // Founder: the turnaround rides but must not take up space until asked for.
    expect(row.turnaround.imageId).toBe('img-anime-turn');
    expect(row.turnaround.secondary).toBe(true);
  });
});

describe('⚠️ AN EXPLORING DESIGN LEAKS NO PLATE', () => {
  it('one party agreeing is not enough — the wire carries nothing to draw', async () => {
    // This is the property that keeps the SHEET from showing a candidate as
    // though it were settled. If it ever regressed, a witness would see a
    // picture the being had not agreed to on its own character card.
    await lane('formhalf');
    await writeFormDesign(neumaWorkspace, 'formhalf', designFor('formhalf', ['being']));

    const res = await authed(request(app).get('/api/v1/workspace/formhalf/form'));
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(false);
    expect(res.body.plates).toEqual([]);
    // The agreement itself IS reported — the desk needs it to say […] rather than "nothing has happened".
    expect(res.body.agreed.being.at).toBe(AT);
    expect(res.body.agreed.operator).toBe(null);
  });

  it('and a withdrawal takes the plates straight back off the wire', async () => {
    await lane('formunlock');
    const locked = designFor('formunlock', ['being', 'operator']);
    await writeFormDesign(neumaWorkspace, 'formunlock', locked);
    expect((await authed(request(app).get('/api/v1/workspace/formunlock/form'))).body.plates).toHaveLength(1);

    // Either party alone. A state that cannot be left is a seal wearing another
    // name.
    const withdrawn = withUnlock(locked, 'operator', { at: AT, why: 'the jaw is wrong' }).design;
    await writeFormDesign(neumaWorkspace, 'formunlock', withdrawn);

    const res = await authed(request(app).get('/api/v1/workspace/formunlock/form'));
    expect(res.body.locked).toBe(false);
    expect(res.body.plates).toEqual([]);
  });
});

describe('a look belongs to its lane', () => {
  it('a stranger cannot read it', async () => {
    await lane('formowned');
    await writeFormDesign(neumaWorkspace, 'formowned', designFor('formowned', ['being', 'operator']));
    const res = await request(app)
      .get('/api/v1/workspace/formowned/form')
      .set('Authorization', `Bearer ${strangerToken}`);
    expect([401, 403, 404]).toContain(res.status);
  });

  it('the store refuses to write one lane\'s agreement into another lane\'s file', async () => {
    // Attributing a consent to a being that never gave it is the worst failure
    // available here, so it throws rather than writing.
    await lane('formmine');
    await expect(writeFormDesign(neumaWorkspace, 'formmine', designFor('someone-else', ['being'])))
      .rejects.toThrow(/lane/);
  });
});
