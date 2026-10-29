/**
 * POST/GET /api/v1/workspace/:id/self-check — the being's own flight check,
 * end to end over the real wire.
 *
 * RULE 0: no mocks. A real Express app with the real workspace router, real
 * requireAuth with a real HMAC session token, real encrypted lanes on temp
 * disk, and every item asked as a WHOLE real turn (streamConsciousness, the
 * read-only self-check sitting) over a real loopback OpenAI-wire provider.
 * No weights run: the loopback answers each question from the request — the
 * true fact for most components, a wrong word for every memory item — so the
 * grade is proven in both directions.
 *
 * Claims:
 *   - a run starts in the background (202), a second press is refused (409),
 *     and GET reports progress, then the kept run;
 *   - right answers grade as hits, wrong ones as misses, and a component with
 *     nothing on record reads not measurable (null), never 0;
 *   - the parts no tool reaches are named (NO DOOR);
 *   - the run leaves exactly its own record and journal line — no session, no
 *     memory of the questions;
 *   - a stranger is refused before anything is read or run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { ethers } from 'ethers';
import { openSelfCheckKit, SELF_CHECK_MODEL as MODEL, SELF_CHECK_TRUE_NAME as TRUE_NAME } from '../helpers/self-check-kit.js';

const LANE = 'selfcheckroute';

// impure — sha256 of every file under root, keyed by relative path.
const snapshot = async (root) => {
  const out = {};
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out[path.relative(root, full)] = crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');
    }
  };
  await walk(root);
  return out;
};

let kit;
let app;
let ownerToken;
let strangerToken;
const authed = (req, token = ownerToken) => req.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  const owner = ethers.Wallet.createRandom();
  kit = await openSelfCheckKit({ label: 'self-check-route', lane: LANE, ownerAddress: owner.address });
  const { createSessionToken } = await import('../../backend/services/auth.js');
  ownerToken = createSessionToken(owner.address);
  strangerToken = createSessionToken(ethers.Wallet.createRandom().address);
  const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
}, 60_000);

afterAll(async () => { await kit?.close(); });

const untilKept = async (ms = 90_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const res = await authed(request(app).get(`/api/v1/workspace/${LANE}/self-check`));
    if (res.body.latest && !res.body.running) return res.body;
    if (res.body.error) throw new Error(res.body.error);
    if (Date.now() > end) throw new Error('the self-check never finished');
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('the self-check over the real wire', () => {
  it('a stranger is refused before anything is read or run', async () => {
    expect((await authed(request(app).get(`/api/v1/workspace/${LANE}/self-check`), strangerToken)).status).toBe(403);
    expect((await authed(request(app).post(`/api/v1/workspace/${LANE}/self-check`), strangerToken)).status).toBe(403);
  });

  it('never run reads as no run — not a score', async () => {
    const res = await authed(request(app).get(`/api/v1/workspace/${LANE}/self-check`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ latest: null, previous: null, compare: null, running: null, error: null });
  });

  it('runs every item as a real turn, grades both ways, keeps only its own record', async () => {
    const before = await snapshot(kit.house);
    const started = await authed(request(app).post(`/api/v1/workspace/${LANE}/self-check`));
    expect(started.status).toBe(202);
    expect((await authed(request(app).post(`/api/v1/workspace/${LANE}/self-check`))).status).toBe(409);
    const body = await untilKept();
    const after = await snapshot(kit.house);

    const run = body.latest;
    expect(run.schema).toBe('self-check/v1');
    expect(run.model).toBe(MODEL);
    expect(run.items).toHaveLength(kit.asked.size);
    const c = Object.fromEntries(run.components.map((x) => [x.key, x]));
    // Wrong words for every memory item: misses, never credited.
    expect(c.memory).toMatchObject({ n: 2, hits: 0, score: 0 });
    // The truth everywhere else: hits.
    for (const key of ['memory-absent', 'identity', 'working', 'pressure']) expect(c[key].score).toBe(1);
    expect(c.tools.n).toBeGreaterThan(0);
    const missedTools = run.items.filter((i) => i.component === 'tools' && i.offered !== false && i.verdict !== 'hit');
    expect(missedTools.map((i) => ({ key: i.key, line: i.line, answer: i.answer }))).toEqual([]);
    // Nothing on record to ask: not measurable, never 0.
    expect(c.vault).toMatchObject({ n: 0, score: null, range: null });
    // An unfounded local house still has a name, and a decoy member who is not in it.
    expect(c.house.score).toBe(1);
    expect(c.seat.score).toBe(1);
    // Every part has a door now: the journal, past chats and charter are measured, not gaps.
    expect(run.doorless).toEqual([]);
    for (const key of ['journal', 'chats', 'charter']) expect(c[key]).toMatchObject({ score: 1 });
    // The answers were graded from the ANSWER line the being gave.
    expect(run.items.find((i) => i.key === 'identity:true-name')).toMatchObject({ verdict: 'hit', line: TRUE_NAME.fullName });
    // Exactly its own record and journal line changed — no session, no memory of the questions.
    const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((k) => /\/(benchmarks|journal)\//.test(`/${k}`))).toBe(true);
    expect(changed.filter((k) => k.includes('/benchmarks/'))).toHaveLength(1);
  }, 120_000);
});
