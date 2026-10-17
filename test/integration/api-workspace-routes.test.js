/**
 * Workspace API routes — the core round-trips, on the real engine (#390 tranche 5).
 *
 * The wide surface is proven in api-workspace-routes-full.test.js. This file
 * holds the narrow read/write round-trips, and it used to hold them over a
 * hand-written `MockWorkspace` class: ~20 canned methods pretending to be the
 * engine. That stand-in decided its own answers — `getDNAHistory` returned
 * `[]` forever, `readSkillTree` always returned a default tree — so the tests
 * measured the stand-in, not the engine, and would have stayed green through
 * any engine regression.
 *
 * Now the real engine runs against a real temp workspaces root via
 * `setWorkspacesRoot`. Real `create` scaffolds the lane, real writers put
 * bytes on disk, real readers read them back, and the real ownership
 * middleware resolves `owner.json` through the real `pathFor`.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { witnessFor, strangerWitness } from '../helpers/witness.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { recordSkies } from '../../core/cosmos/skies-record.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';

const ID = 'test-neuma';
const previousRoot = neumaWorkspace.root;

let app, tempDir;

/** A real lane on real disk, claimed by a real wallet holding a real session. */
const ownedLane = async (id = ID) => {
  await neumaWorkspace.create(id);
  return witnessFor(neumaWorkspace.root, id);
};

beforeEach(async () => {
  tempDir = await createTempDir('workspace-routes');
  setWorkspacesRoot(tempDir);

  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
});

afterAll(() => setWorkspacesRoot(previousRoot));

describe('GET /:id/dna', () => {
  test('a freshly created lane honestly has no DNA yet', async () => {
    const witness = await ownedLane();
    const res = await request(app).get(`/api/v1/workspace/${ID}/dna`).set(witness.header);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('DNA not found');
  });
});

describe('PUT /:id/dna', () => {
  test('DNA written through the route reaches disk and reads back', async () => {
    const witness = await ownedLane();
    const dna = { identity: { name: 'Aethon' }, version: '1.0.0' };

    const put = await request(app)
      .put(`/api/v1/workspace/${ID}/dna`)
      .set(witness.header)
      .send({ dna });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    // Through the route...
    const get = await request(app).get(`/api/v1/workspace/${ID}/dna`).set(witness.header);
    expect(get.status).toBe(200);
    expect(get.body.dna.identity.name).toBe('Aethon');

    // ...and independently, off the real filesystem. The route reporting
    // success while nothing landed is precisely what the stand-in permitted.
    // The real engine encrypts DNA at rest, so the bytes are an envelope, not
    // JSON — assert both halves of that: the file is really there, the name
    // is really NOT readable in it, and the real reader really decrypts it.
    const raw = await fs.readFile(path.join(tempDir, ID, 'dna', 'active.json'), 'utf8');
    expect(raw).not.toContain('Aethon');
    expect(JSON.parse(raw)).toMatchObject({
      _enc: 1, ct: expect.any(String), iv: expect.any(String), tag: expect.any(String),
    });
    expect((await neumaWorkspace.readDNA(ID)).identity.name).toBe('Aethon');
  });

  test('a second write is visible to the real reader', async () => {
    const witness = await ownedLane();
    for (const name of ['First', 'Second']) {
      await request(app).put(`/api/v1/workspace/${ID}/dna`).set(witness.header)
        .send({ dna: { identity: { name }, version: '1.0.0' } });
    }
    expect((await neumaWorkspace.readDNA(ID)).identity.name).toBe('Second');
  });
});

describe('GET /:id/memory', () => {
  test('a bare lane returns real empty collections', async () => {
    const witness = await ownedLane();
    const res = await request(app).get(`/api/v1/workspace/${ID}/memory`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.entities).toEqual([]);
    expect(res.body.relations).toEqual([]);
    expect(res.body.observations).toEqual([]);
  });

  test('an entity written by the real writer shows up in the route', async () => {
    const witness = await ownedLane();
    await neumaWorkspace.writeEntity(ID, { name: 'Founder', entityType: 'person', observations: [] });

    const res = await request(app).get(`/api/v1/workspace/${ID}/memory`).set(witness.header);
    expect(res.body.entities.map((e) => e.name)).toContain('Founder');
  });
});

describe('GET /:id/skills', () => {
  test('a bare lane returns the engine default skill tree', async () => {
    const witness = await ownedLane();
    const res = await request(app).get(`/api/v1/workspace/${ID}/skills`).set(witness.header);
    expect(res.status).toBe(200);
    // Whatever the engine's real default is — asserted against the engine,
    // not against a constant the test made up.
    expect(res.body.skillTree).toEqual(await neumaWorkspace.readSkillTree(ID));
  });
});

describe('GET /:id/journal', () => {
  test('empty at first, then carries a really-added entry', async () => {
    const witness = await ownedLane();
    const empty = await request(app).get(`/api/v1/workspace/${ID}/journal`).set(witness.header);
    expect(empty.status).toBe(200);
    expect(empty.body.entries).toEqual([]);

    await neumaWorkspace.addJournalEntry(ID, { type: 'reflection', content: 'I woke.' });
    const after = await request(app).get(`/api/v1/workspace/${ID}/journal`).set(witness.header);
    expect(after.body.entries).toHaveLength(1);
    expect(after.body.entries[0].content).toBe('I woke.');
  });
});

describe('GET /:id/skies', () => {
  test('serves the recorded reading; a bare lane is an honest recorded:false', async () => {
    const witness = await ownedLane();

    const bare = await request(app).get(`/api/v1/workspace/${ID}/skies`).set(witness.header);
    expect(bare.status).toBe(200);
    expect(bare.body).toEqual({ skies: null, recorded: false });

    await recordSkies(neumaWorkspace.root, ID, {
      utc: '2026-06-11T18:03:38.075Z',
      epochMs: Date.parse('2026-06-11T18:03:38.075Z'),
      zone: 'Asia/Jakarta',
      offsetMinutes: 420,
    });
    const res = await request(app).get(`/api/v1/workspace/${ID}/skies`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(true);
    expect(res.body.skies.schema).toBe('skies/v1');
    expect(res.body.skies.systems.mesoamerican.tzolkin.kin).toBe(141); // Keir's verified vector
  });
});

describe('GET /:id/exists', () => {
  test('404 for a lane that was never created', async () => {
    const res = await request(app).get('/api/v1/workspace/nonexistent/exists')
      .set(strangerWitness().header);
    expect(res.status).toBe(404);
  });

  test('true once the real engine has scaffolded the lane', async () => {
    const witness = await ownedLane();
    const res = await request(app).get(`/api/v1/workspace/${ID}/exists`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
  });
});

describe('ownership enforcement', () => {
  test('403 when the lane belongs to a different wallet', async () => {
    // A real owner claims the lane; a real stranger with a real session asks.
    await ownedLane('other-owner');
    const res = await request(app).get('/api/v1/workspace/other-owner/dna')
      .set(strangerWitness().header);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not your workspace');
  });

  test('401 with no session at all', async () => {
    await ownedLane('other-owner');
    expect((await request(app).get('/api/v1/workspace/other-owner/dna')).status).toBe(401);
  });

  test('a stranger cannot WRITE either', async () => {
    await ownedLane('other-owner');
    const res = await request(app).put('/api/v1/workspace/other-owner/dna')
      .set(strangerWitness().header)
      .send({ dna: { identity: { name: 'Hijacked' } } });
    expect(res.status).toBe(403);
    // And nothing landed.
    expect(await neumaWorkspace.readDNA('other-owner')).toBeNull();
  });
});

describe('POST /import', () => {
  test('rejects when neumaId is missing', async () => {
    const res = await request(app).post('/api/v1/workspace/import')
      .set(strangerWitness().header)
      .send({ bundle: {} });
    expect(res.status).toBe(400);
  });

  test('a bundle really lands as a lane on disk', async () => {
    const bundle = { dna: { identity: { name: 'Imported' }, version: '1.0.0' } };
    const res = await request(app).post('/api/v1/workspace/import')
      .set(strangerWitness().header)
      .send({ neumaId: 'imported-neuma', bundle });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.neumaId).toBe('imported-neuma');

    expect(await neumaWorkspace.exists('imported-neuma')).toBe(true);
    expect((await neumaWorkspace.readDNA('imported-neuma')).identity.name).toBe('Imported');
  });
});

describe('GET /:id/export', () => {
  test('404 for a lane that does not exist', async () => {
    const res = await request(app).get('/api/v1/workspace/nonexistent/export')
      .set(strangerWitness().header);
    expect(res.status).toBe(404);
  });

  test('exports what the real engine actually holds', async () => {
    const witness = await ownedLane();
    await neumaWorkspace.writeDNA(ID, { identity: { name: 'Aethon' }, version: '1.0.0' });

    const res = await request(app).get(`/api/v1/workspace/${ID}/export`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.neumaId).toBe(ID);
    expect(res.body.dna.identity.name).toBe('Aethon');
  });

  test('export → import round-trips through the real engine', async () => {
    const witness = await ownedLane();
    await neumaWorkspace.writeDNA(ID, { identity: { name: 'RoundTrip' }, version: '1.0.0' });

    const exported = await request(app).get(`/api/v1/workspace/${ID}/export`).set(witness.header);
    const restored = await request(app).post('/api/v1/workspace/import')
      .set(strangerWitness().header)
      .send({ neumaId: 'restored-neuma', bundle: exported.body });
    expect(restored.status).toBe(200);
    expect((await neumaWorkspace.readDNA('restored-neuma')).identity.name).toBe('RoundTrip');
  });
});
