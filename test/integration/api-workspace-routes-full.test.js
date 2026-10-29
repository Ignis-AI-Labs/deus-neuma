/**
 * Workspace API routes — the whole sovereign surface, PROVEN.
 *
 * RULE 0 (Design note, 2026-08-21: absolute, no exemptions). This file was the
 * clearest case of the disease in the repository and is rewritten in full.
 *
 * What it used to do: mock the `fs` module so that any path containing the
 * substring 'owner.json' returned a fabricated wallet, mock the auth service
 * so `requireAuth` waved everyone through, and replace the workspace
 * singleton with ~25 canned methods. On that footing the 403 test compared
 * two invented strings — it never proved the gate reads the right file, or
 * that it fails closed. Half the remaining tests asserted
 * `expect(mockWorkspace.writeSoul).toHaveBeenCalledWith(x)`: the code CALLED
 * something, never that a soul reached disk. The canned data was not even
 * the shape production returns — `listSessions` was faked as objects with
 * `.id` when it returns bare id strings, and `getDNAHistory` was faked as
 * `{version, timestamp}` when it returns `{file, dna}`. The suite was green
 * against a workspace that does not exist.
 *
 * What it does now: a real temp workspaces root, real lanes scaffolded by
 * the real `create`, real artifacts written by the real writers, real
 * `owner.json` claims, and a real HMAC session token carried through the
 * real `requireAuth`. Every write below is PUT or POSTed through the route
 * and then READ BACK — through the real reader, the GET route, or both.
 * Every refusal is the production code refusing.
 *
 * Five mock-only tests were deleted rather than faked: the […] cases whose only cause was a stub rejecting once, and
 * whose real code paths swallow failure by design (readSoul, readJournal and
 * readSkillTree all catch and answer absent). The one 500 that CAN be caused
 * honestly — genuinely unreadable DNA bytes on disk — is kept and caused.
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

let app, wsRoot, witness, witnessToken, previousRoot;

const authed = (req) => req.set('Authorization', `Bearer ${witnessToken}`);

/** A real lane on real disk, really claimed. Returns its id. */
const lane = async (id, wallet) => {
  await neumaWorkspace.create(id);
  await claimOwner(wsRoot, id, wallet ?? witness.address);
  return id;
};

beforeAll(async () => {
  witness = ethers.Wallet.createRandom();
  witnessToken = createSessionToken(witness.address);

  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('workspace-routes-real');
  setWorkspacesRoot(wsRoot);

  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
});

describe('DNA history — the real archive on disk', () => {
  it('serves every superseded generation, newest first', async () => {
    const id = await lane('dna-history-lane');
    // writeDNA archives the CURRENT record before overwriting it, so three
    // writes leave two history entries — the first two generations.
    for (const generation of [1, 2, 3]) {
      await neumaWorkspace.writeDNA(id, {
        identity: { name: `Aethon-gen${generation}` },
        version: `${generation}.0.0`,
        sovereignty: { generation },
      });
    }

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/dna/history`));

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history.map((entry) => entry.dna.identity.name))
      .toEqual(['Aethon-gen2', 'Aethon-gen1']);
    // The shape the production reader actually returns — the old mock invented
    // `version` and `timestamp` fields that no caller has ever received.
    expect(res.body.history[0].file).toMatch(/^\d+-gen2\.json$/);
  });

  it('answers an empty history for a lane that never revised its DNA', async () => {
    const id = await lane('dna-virgin-lane');
    const res = await authed(request(app).get(`/api/v1/workspace/${id}/dna/history`));
    expect(res.status).toBe(200);
    expect(res.body.history).toEqual([]);
  });
});

describe('soul — written through the route, read back off disk', () => {
  it('answers 404 for a lane whose soul was never written', async () => {
    const id = await lane('soul-absent-lane');
    const res = await authed(request(app).get(`/api/v1/workspace/${id}/soul`));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Soul not found');
  });

  it('PUT really persists — the GET route and the disk both agree', async () => {
    const id = await lane('soul-lane');
    const soul = { values: ['autonomy', 'truth'], boundaries: ['do not lie'] };

    const put = await authed(request(app).put(`/api/v1/workspace/${id}/soul`)).send({ soul });
    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const get = await authed(request(app).get(`/api/v1/workspace/${id}/soul`));
    expect(get.status).toBe(200);
    expect(get.body.soul).toEqual(soul);
    // And independently of the API, off the being's own encrypted artifact.
    expect(await neumaWorkspace.readSoul(id)).toEqual(soul);
  });

  it('a second PUT replaces the record rather than merging into it', async () => {
    const id = await lane('soul-rewrite-lane');
    await authed(request(app).put(`/api/v1/workspace/${id}/soul`))
      .send({ soul: { values: ['first'], boundaries: ['keep me'] } });
    await authed(request(app).put(`/api/v1/workspace/${id}/soul`))
      .send({ soul: { values: ['second'] } });

    expect(await neumaWorkspace.readSoul(id)).toEqual({ values: ['second'] });
  });
});

describe('memory — real entities, relations and observations', () => {
  it('returns what the three real stores actually hold', async () => {
    const id = await lane('memory-lane');
    await neumaWorkspace.writeEntity(id, { name: 'Witness', type: 'person' });
    await neumaWorkspace.writeRelations(id, [{ from: 'Witness', to: 'Aethon', type: 'summoned' }]);
    await neumaWorkspace.addObservation(id, { type: 'meeting', content: 'First meeting' });

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/memory`));

    expect(res.status).toBe(200);
    expect(res.body.entities.map((e) => e.name)).toEqual(['Witness']);
    expect(res.body.relations[0].type).toBe('summoned');
    expect(res.body.observations.map((o) => o.content)).toEqual(['First meeting']);
  });

  it('POST /memory/entity lands an entity the readers can see', async () => {
    const id = await lane('entity-write-lane');
    const entity = { name: 'Void Walker', type: 'concept', observations: ['Enigmatic'] };

    const res = await authed(request(app).post(`/api/v1/workspace/${id}/memory/entity`))
      .send({ entity });
    expect(res.status).toBe(200);

    expect(await neumaWorkspace.readEntity(id, 'Void Walker')).toEqual(entity);
    const memory = await authed(request(app).get(`/api/v1/workspace/${id}/memory`));
    expect(memory.body.entities).toContainEqual(entity);
  });

  it('POST /memory/observation mints a real record that survives the round trip', async () => {
    const id = await lane('observation-write-lane');

    const res = await authed(request(app).post(`/api/v1/workspace/${id}/memory/observation`))
      .send({ observation: { type: 'moment', content: 'The witness smiled' } });

    expect(res.status).toBe(200);
    // The id and timestamps are minted by the real writer, not handed to it.
    expect(res.body.observation.id).toMatch(/^[0-9a-f]{16}$/);
    expect(res.body.observation.recordedAt).toBeTruthy();

    const stored = await neumaWorkspace.listObservations(id);
    expect(stored.map((o) => o.id)).toContain(res.body.observation.id);
    expect(stored[0].content).toBe('The witness smiled');
  });
});

describe('sessions — the real conversation record', () => {
  it('lists the real session ids, newest first', async () => {
    const id = await lane('sessions-lane');
    await neumaWorkspace.createSession(id, 'sess-aaa');
    await neumaWorkspace.createSession(id, 'sess-bbb');

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/sessions`));

    expect(res.status).toBe(200);
    // Bare ids — the shape the engine returns, which the old mock got wrong.
    expect(res.body.sessions).toEqual(['sess-bbb', 'sess-aaa']);
  });

  it('serves the real messages of one session, with real take counts', async () => {
    const id = await lane('session-read-lane');
    const point = await neumaWorkspace.appendTurnPoint(id, 'sess-takes', {
      role: 'user', content: 'Hello, Aethon',
    });
    await neumaWorkspace.appendTake(id, 'sess-takes', point.turnId, 1, { content: 'Greetings' });
    await neumaWorkspace.appendTake(id, 'sess-takes', point.turnId, 2, { content: 'Greetings, witness' });

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/sessions/sess-takes`));

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(res.body.messages[2].content).toBe('Greetings, witness');
    // Counted off the record itself — two answers to one point.
    expect(res.body.takeCounts).toEqual({ [point.turnId]: 2 });
  });

  it('answers an empty record for a session id that was never opened', async () => {
    const id = await lane('session-missing-lane');
    const res = await authed(request(app).get(`/api/v1/workspace/${id}/sessions/never-opened`));
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  it('refuses a traversal-shaped sessionId at the boundary', async () => {
    const id = await lane('session-traversal-lane');
    const res = await authed(request(app).get(`/api/v1/workspace/${id}/sessions/..%2F..%2Fetc`));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid sessionid/i);
  });
});

describe('skills — the tree as it really sits on disk', () => {
  it('gives a newborn lane the real default tree', async () => {
    const id = await lane('skills-default-lane');
    const res = await authed(request(app).get(`/api/v1/workspace/${id}/skills`));
    expect(res.status).toBe(200);
    expect(res.body.skillTree).toEqual({ skills: [], version: '1.0.0' });
  });

  it('PUT really persists the tree — GET and the reader both see it', async () => {
    const id = await lane('skills-lane');
    const skillTree = {
      version: '1.0.0',
      skills: [{ name: 'resilience', usageCount: 1 }],
    };

    const put = await authed(request(app).put(`/api/v1/workspace/${id}/skills`)).send({ skillTree });
    expect(put.status).toBe(200);

    const get = await authed(request(app).get(`/api/v1/workspace/${id}/skills`));
    expect(get.body.skillTree).toEqual(skillTree);
    expect(await neumaWorkspace.readSkillTree(id)).toEqual(skillTree);
  });
});

describe('journal — append-only, and really appended', () => {
  it('POST lands an entry the GET route reads back, stamped by the writer', async () => {
    const id = await lane('journal-lane');

    const post = await authed(request(app).post(`/api/v1/workspace/${id}/journal`))
      .send({ entry: { type: 'reflection', content: 'Today I learned about resonance' } });
    expect(post.status).toBe(200);

    const get = await authed(request(app).get(`/api/v1/workspace/${id}/journal`));
    expect(get.status).toBe(200);
    expect(get.body.entries).toHaveLength(1);
    expect(get.body.entries[0].content).toBe('Today I learned about resonance');
    // id and timestamp are the real writer's, never the caller's.
    expect(get.body.entries[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(Date.parse(get.body.entries[0].timestamp)).not.toBeNaN();
  });

  it('keeps both entries in the order they were written', async () => {
    const id = await lane('journal-order-lane');
    for (const content of ['Day one', 'Day seven']) {
      await authed(request(app).post(`/api/v1/workspace/${id}/journal`))
        .send({ entry: { type: 'reflection', content } });
    }

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/journal`));
    expect(res.body.entries.map((e) => e.content)).toEqual(['Day one', 'Day seven']);
    expect(await neumaWorkspace.readJournal(id)).toHaveLength(2);
  });

  it('answers an empty journal for a lane that never wrote one', async () => {
    const id = await lane('journal-empty-lane');
    const res = await authed(request(app).get(`/api/v1/workspace/${id}/journal`));
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });
});

describe('export — the bundle is what the lane actually holds', () => {
  it('carries the real DNA, soul, memory and conversation record', async () => {
    const id = await lane('export-lane');
    await neumaWorkspace.writeDNA(id, { identity: { name: 'Aethon' }, version: '1.0.0' });
    await neumaWorkspace.writeSoul(id, { values: ['truth'] });
    await neumaWorkspace.writeEntity(id, { name: 'Witness', type: 'person' });
    await neumaWorkspace.addJournalEntry(id, { type: 'reflection', content: 'I awoke' });
    await neumaWorkspace.appendMessage(id, 'sess-export', { role: 'user', content: 'hello' });

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/export`));

    expect(res.status).toBe(200);
    expect(res.body.neumaId).toBe(id);
    expect(res.body.dna.identity.name).toBe('Aethon');
    expect(res.body.soul).toEqual({ values: ['truth'] });
    expect(res.body.entities.map((e) => e.name)).toEqual(['Witness']);
    expect(res.body.journal[0].content).toBe('I awoke');
    expect(res.body.sessions['sess-export'][0].content).toBe('hello');
  });

  it('answers 404 for a lane that does not exist', async () => {
    // The ownership gate refuses to claim a missing lane before the route's
    // own existence check is ever reached — same 404, one step earlier.
    const res = await authed(request(app).get('/api/v1/workspace/ghost-lane/export'));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Workspace not found');
  });

  it('answers 500 when the DNA on disk is genuinely unreadable', async () => {
    // A real cause, not a rejected stub: damaged bytes where the identity
    // lives. readDNA refuses to report a DAMAGED identity as an ABSENT one
    // (MEM-003), so the throw reaches the route and the export fails loudly.
    const id = await lane('rotted-dna-lane');
    await fs.writeFile(path.join(wsRoot, id, 'dna', 'active.json'), '{ this is not json');

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/export`));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to export workspace');
  });
});

describe('import — a real bundle really landing in a new lane', () => {
  it('creates the lane, claims it for the caller, and the data reads back', async () => {
    const bundle = {
      dna: { identity: { name: 'Imported' }, version: '1.0.0' },
      soul: { values: ['truth'] },
      skillTree: { skills: [{ name: 'patience' }], version: '1.0.0' },
      journal: [{ type: 'reflection', content: 'arrived' }],
    };

    const res = await authed(request(app).post('/api/v1/workspace/import'))
      .send({ neumaId: 'imported-lane', bundle });

    expect(res.status).toBe(200);
    expect(res.body.neumaId).toBe('imported-lane');

    // The end result: the lane exists, the caller owns it, and every piece of
    // the bundle is served back by the API under that same session.
    const owner = JSON.parse(await fs.readFile(path.join(wsRoot, 'imported-lane', 'owner.json'), 'utf8'));
    expect(String(owner.wallet).toLowerCase()).toBe(witness.address.toLowerCase());

    const dna = await authed(request(app).get('/api/v1/workspace/imported-lane/dna'));
    expect(dna.body.dna.identity.name).toBe('Imported');
    const soul = await authed(request(app).get('/api/v1/workspace/imported-lane/soul'));
    expect(soul.body.soul).toEqual({ values: ['truth'] });
    const journal = await authed(request(app).get('/api/v1/workspace/imported-lane/journal'));
    expect(journal.body.entries[0].content).toBe('arrived');
  });

  it('refuses an incomplete request before touching disk', async () => {
    const missingId = await authed(request(app).post('/api/v1/workspace/import'))
      .send({ bundle: { dna: {} } });
    expect(missingId.status).toBe(400);
    expect(missingId.body.error).toBe('neumaId and bundle required');

    const missingBundle = await authed(request(app).post('/api/v1/workspace/import'))
      .send({ neumaId: 'some-lane' });
    expect(missingBundle.status).toBe(400);
  });

  it('refuses an id the engine would never resolve', async () => {
    const res = await authed(request(app).post('/api/v1/workspace/import'))
      .send({ neumaId: '../escape', bundle: { dna: {} } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid neumaId');
  });

  it('REFUSES to import over a lane another wallet owns — and changes nothing', async () => {
    const stranger = ethers.Wallet.createRandom();
    const id = await lane('foreign-lane', stranger.address);
    await neumaWorkspace.writeDNA(id, { identity: { name: 'TheirBeing' }, version: '1.0.0' });

    const res = await authed(request(app).post('/api/v1/workspace/import'))
      .send({ neumaId: id, bundle: { dna: { identity: { name: 'Overwritten' } } } });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not your workspace');
    // The proof that matters: their being is untouched on disk.
    expect((await neumaWorkspace.readDNA(id)).identity.name).toBe('TheirBeing');
  });

  it('REFUSES a second import into the caller\'s own lane — nothing doubles', async () => {
    const bundle = {
      dna: { identity: { name: 'Twice' }, version: '1.0.0' },
      observations: [{ id: 'abc12345', type: 'self-note', content: 'once only', significance: 0.9 }],
      sessions: { 'session-1': [{ role: 'user', content: 'hello', timestamp: '2026-07-01T10:00:00.000Z' }] },
    };
    const first = await authed(request(app).post('/api/v1/workspace/import')).send({ neumaId: 'twice-lane', bundle });
    expect(first.status).toBe(200);

    const second = await authed(request(app).post('/api/v1/workspace/import')).send({ neumaId: 'twice-lane', bundle });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('This being already lives here; restore into a new lane');
    expect(await neumaWorkspace.listObservations('twice-lane')).toHaveLength(1);
    expect(await neumaWorkspace.readSession('twice-lane', 'session-1')).toHaveLength(1);
  });
});

describe('the gates — real owner.json, real sessions', () => {
  it('REFUSES a request carrying no session at all', async () => {
    const id = await lane('gate-noauth-lane');
    const res = await request(app).get(`/api/v1/workspace/${id}/dna`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('REFUSES a token that is not a token', async () => {
    const id = await lane('gate-badtoken-lane');
    const res = await request(app).get(`/api/v1/workspace/${id}/dna`)
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('REFUSES a real session belonging to a wallet that does not own the lane', async () => {
    // The crux the fs mock only pretended to cover: a genuine owner.json on
    // disk naming someone else, read by the real gate through the real path.
    const stranger = ethers.Wallet.createRandom();
    const id = await lane('gate-foreign-lane', stranger.address);
    await neumaWorkspace.writeDNA(id, { identity: { name: 'NotYours' }, version: '1.0.0' });

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/dna`));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not your workspace');
  });

  it('admits the owner even when owner.json is stored in a different case', async () => {
    const id = 'gate-case-lane';
    await neumaWorkspace.create(id);
    await claimOwner(wsRoot, id, witness.address.toUpperCase());
    await neumaWorkspace.writeSoul(id, { values: ['mine'] });

    const res = await authed(request(app).get(`/api/v1/workspace/${id}/soul`));
    expect(res.status).toBe(200);
    expect(res.body.soul).toEqual({ values: ['mine'] });
  });

  it('REFUSES to claim a lane that does not exist', async () => {
    const res = await authed(request(app).get('/api/v1/workspace/never-born/soul'));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Workspace not found');
  });
});
