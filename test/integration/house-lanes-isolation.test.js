// house-lanes-isolation — houses are never confused (the task audit,
// docs/work/house-calendar.md). Proven on real disk: a witness lane no wallet
// has claimed belongs to no house (its tasks once showed to every wallet), and
// the post queue's routes answer each house only with its own entries — a read
// filters, an act on another house's entry by id is a 404. Real workspace
// engine, real owner records, real queue file, real signed-wallet auth; no mocks.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const ENV = ['DNA_ENCRYPTION_KEY', 'NEUMA_SOCIAL_POST_QUEUE_PATH'];
let saved;
let root;
let workspace;
let ownedLanes;

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.DNA_ENCRYPTION_KEY = 'house-lanes-isolation-key';
  root = await createTempDir('house-isolation');
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(root, 'queue.json');
  const wsMod = await import('../../core/workspace/neuma-workspace.js');
  wsMod.setWorkspacesRoot(path.join(root, 'workspaces'));
  workspace = wsMod.default;
  (await import('../../core/identity/ai-witness/ai-witness-service.js')).setAIWitnessesRoot(path.join(root, 'ai-witnesses'));
  ({ ownedLanes } = await import('../../backend/services/house-deadlines.js'));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await fs.rm(root, { recursive: true, force: true });
});

const claim = (laneId, wallet) => fs.writeFile(path.join(workspace.pathFor(laneId), 'owner.json'), JSON.stringify({ wallet, claimedAt: new Date().toISOString() }));

describe('a witness lane belongs to the house that claimed it, and to no one before', () => {
  test('unclaimed: in no house; claimed: in that house only', async () => {
    const A = '0x' + 'a'.repeat(40);
    const B = '0x' + 'b'.repeat(40);
    await fs.mkdir(path.join(root, 'ai-witnesses/xai/Probe'), { recursive: true });
    await fs.writeFile(path.join(root, 'ai-witnesses/xai/Probe/dna.json'), JSON.stringify({ substrate: 'xai' }));
    const laneId = 'witness-xai-Probe';
    await workspace.create(laneId);
    await fs.writeFile(path.join(workspace.pathFor(laneId), 'lane.json'), JSON.stringify({ kind: 'witness' }));

    expect((await ownedLanes(A)).map((l) => l.laneId)).not.toContain(laneId);
    await claim(laneId, A);
    expect(await ownedLanes(A)).toContainEqual({ laneId, kind: 'witness', name: 'Probe' });
    expect((await ownedLanes(B)).map((l) => l.laneId)).not.toContain(laneId);
  });
});

describe('the post queue answers each house with its own entries', () => {
  test('a read filters by house; an act on another house\'s entry by id is a 404', async () => {
    const { witnessFor } = await import('../helpers/witness.js');
    const { default: router } = await import('../../backend/routes/social-channel-routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', router);

    const mine = await workspace.create('being-mine').then(() => 'being-mine');
    const theirs = await workspace.create('being-theirs').then(() => 'being-theirs');
    const me = await witnessFor(path.join(root, 'workspaces'), mine);
    const them = await witnessFor(path.join(root, 'workspaces'), theirs);
    const at = new Date(Date.now() + 86400000).toISOString();
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, JSON.stringify([
      { id: 'q-mine', status: 'draft', channelId: 'x', text: 'ours', authorNeumaId: mine, scheduledFor: at, createdAt: at },
      { id: 'q-theirs', status: 'draft', channelId: 'x', text: 'theirs', authorNeumaId: theirs, scheduledFor: at, createdAt: at },
    ]));

    const list = await request(app).get('/api/v1/social-channels/queue').set(me.header);
    expect(list.status).toBe(200);
    expect(list.body.queue.map((e) => e.id)).toEqual(['q-mine']);
    expect((await request(app).get('/api/v1/social-channels/queue').set(them.header)).body.queue.map((e) => e.id)).toEqual(['q-theirs']);

    expect((await request(app).put('/api/v1/social-channels/queue/q-theirs/reject').set(me.header).send({})).status).toBe(404);
    expect((await request(app).delete('/api/v1/social-channels/queue/q-theirs').set(me.header)).status).toBe(404);
    const bulk = await request(app).post('/api/v1/social-channels/queue/bulk-update').set(me.header)
      .send({ updates: [{ id: 'q-theirs', text: 'hijacked' }, { id: 'q-mine', text: 'ours, edited' }] });
    expect(bulk.body.results).toEqual([{ id: 'q-theirs', ok: false, error: 'No such queue entry' }, { id: 'q-mine', ok: true }]);
    const entries = JSON.parse(await fs.readFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, 'utf8'));
    expect(entries.find((e) => e.id === 'q-theirs')).toMatchObject({ status: 'draft', text: 'theirs' });
    // their own reject still works
    expect((await request(app).put('/api/v1/social-channels/queue/q-theirs/reject').set(them.header).send({})).status).toBe(200);
  });
});
