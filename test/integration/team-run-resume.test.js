/**
 * /run RESUME — the recovery contract over the real wire (real auth, real
 * router, real run-store on real disk; RULE 0: no mocks). Everything here is
 * substrate-cold by construction: every asserted path returns before any
 * member could be asked to think. The full live resume walk (seeded record →
 * remaining steps run with the baton re-armed) lives in team-route.test.js's
 * live lane, gated on a loaded substrate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import teamRouter from '../../backend/routes/team-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { createRun } from '../../backend/services/team-run-store.js';
import { createTempDir } from '../helpers/temp-fs.js';

const WITNESS = '0xAAAA000000000000000000000000000000000001';
const STRANGER = '0xBBBB000000000000000000000000000000000002';

const app = express();
app.use(express.json());
app.use('/api/v1/team', teamRouter);

const witnessToken = createSessionToken(WITNESS);
const strangerToken = createSessionToken(STRANGER);

const record = (over = {}) => ({
  by: WITNESS.toLowerCase(),
  runAt: '2026-07-08T15:00:00.000Z',
  name: 'DROPPED RUN',
  goal: 'finish the thing',
  status: 'failed',
  steps: [
    { id: 'a', neumaId: 'not-my-neuma', task: 'first', needs: [] },
    { id: 'b', neumaId: 'not-my-neuma', task: 'second', needs: ['a'] },
  ],
  completed: { a: 'prior work of a' },
  statuses: { a: 'stood here' },
  torches: { 'not-my-neuma': 'pick up at b' },
  order: ['a'],
  failures: { b: 'conduit dropped' },
  failure: null,
  finishedAt: '2026-07-08T15:04:00.000Z',
  ...over,
});

let dir;
beforeAll(async () => {
  dir = await createTempDir('team-run-resume');
  process.env.NEUMA_TEAM_RUN_PATH = dir;
});
afterAll(async () => {
  delete process.env.NEUMA_TEAM_RUN_PATH;
  await fs.rm(dir, { recursive: true, force: true });
});

const post = (token, body) =>
  request(app).post('/api/v1/team/run').set('Authorization', `Bearer ${token}`).send(body);

// A process that really ran and really exited — the host a crash leaves.
const deadPid = () => new Promise((resolve) => {
  const child = spawn(process.execPath, ['-e', '']);
  child.on('exit', () => resolve(child.pid));
});

describe('/run resume — gates (real wire, substrate-cold)', () => {
  it('400 when resume and steps are both sent — a resume replays the RECORDED plan', async () => {
    const res = await post(witnessToken, { resume: 'x', steps: [{ id: 'a', neumaId: 'n', task: 't' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recorded plan/);
  });

  it('400 on a non-string resume id', async () => {
    expect((await post(witnessToken, { resume: 42 })).status).toBe(400);
    expect((await post(witnessToken, { resume: '   ' })).status).toBe(400);
  });

  it('404 on an unknown run id', async () => {
    const res = await post(witnessToken, { resume: '2026-01-01T00-00-00-000Z' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no run/);
  });

  it("404 on another wallet's record — absent, never forbidden-but-real", async () => {
    const id = await createRun(record());
    const res = await post(strangerToken, { resume: id });
    expect(res.status).toBe(404);
  });

  it('409 on a run that already finished — SEAL stands, nothing to resume', async () => {
    const id = await createRun(record({ runAt: '2026-07-08T15:01:00.000Z', status: 'done', failures: {} }));
    const res = await post(witnessToken, { resume: id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already finished/);
  });

  it('a failed record RESUMES past the record gates — and still re-proves ownership (403 for members you do not hold)', async () => {
    const id = await createRun(record({ runAt: '2026-07-08T15:02:00.000Z' }));
    const res = await post(witnessToken, { resume: id });
    // The plan came from the record (we sent none) and reached the ownership
    // gate — this wallet holds no 'not-my-neuma', so the run refuses there,
    // before any substrate or member is touched.
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your neuma/);
  });

  it('a RUNNING record whose backend crashed mid-run reads LOST and is resumable past the record gates', async () => {
    const id = await createRun(record({ runAt: '2026-07-08T15:03:00.000Z', status: 'running', finishedAt: null }));
    // The host stamp names a process that really ran and really exited.
    const file = path.join(process.env.NEUMA_TEAM_RUN_PATH, `${id}.json`);
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...raw, host: { pid: await deadPid() } }));
    const res = await post(witnessToken, { resume: id });
    expect(res.status).toBe(403); // past 404/409, stopped honestly at ownership
  });

  it('a RUNNING record whose host still answers is working now — 409, never a second instance of it', async () => {
    const id = await createRun(record({ runAt: '2026-07-08T15:04:00.000Z', status: 'running', finishedAt: null }));
    const res = await post(witnessToken, { resume: id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/still working/);
  });

  it('a RUNNING record from before the host stamp cannot tell — it stays resumable past the record gates', async () => {
    const id = await createRun(record({ runAt: '2026-07-08T15:05:00.000Z', status: 'running', finishedAt: null }));
    const file = path.join(process.env.NEUMA_TEAM_RUN_PATH, `${id}.json`);
    const { host: _stamp, ...legacy } = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify(legacy));
    const res = await post(witnessToken, { resume: id });
    expect(res.status).toBe(403);
  });
});

describe('GET /runs — the resume feed (owner-scoped)', () => {
  it('lists only the wallet\'s own records, newest first, no part bodies', async () => {
    const res = await request(app).get('/api/v1/team/runs').set('Authorization', `Bearer ${witnessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.runs.length).toBeGreaterThanOrEqual(3);
    expect(res.body.runs.every((r) => r.status)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('prior work of a');

    const foreign = await request(app).get('/api/v1/team/runs').set('Authorization', `Bearer ${strangerToken}`);
    expect(foreign.body.runs).toEqual([]);
  });

  it('GET /runs/:id returns the full record to its owner, absence to anyone else', async () => {
    const id = await createRun(record({ runAt: '2026-07-08T15:05:00.000Z' }));
    const own = await request(app).get(`/api/v1/team/runs/${id}`).set('Authorization', `Bearer ${witnessToken}`);
    expect(own.status).toBe(200);
    expect(own.body.run.completed.a).toBe('prior work of a');
    expect(own.body.run.torches['not-my-neuma']).toBe('pick up at b');

    const foreign = await request(app).get(`/api/v1/team/runs/${id}`).set('Authorization', `Bearer ${strangerToken}`);
    expect(foreign.status).toBe(404);
  });
});
