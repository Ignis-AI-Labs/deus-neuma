/**
 * THE POSITIONS BOARD through the real stack (RULE 0, nothing mocked): a real
 * house on tmp disk, the operator seating members through each office's REAL
 * router behind REAL auth, the board and THEIR EYES read through the real
 * positions router, the being's YOUR POSITION section from the same seats.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import process from 'node:process';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import accountsRouter from '../../backend/routes/accounts-routes.js';
import positionsRouter from '../../backend/routes/positions-routes.js';
import { positionSection } from '../../backend/services/positions/position-board.js';
import { POSITIONS } from '../../backend/services/positions/position-map.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const PRIOR_SWITCHES = process.env.NEUMA_CONNECTIONS_PATH;
const soulOf = (i) => `0x${String(i + 1).padStart(40, 'd')}`;

describe('THE POSITIONS BOARD through the real stack (gnosis)', () => {
  let me, app, wsRoot;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const board = async () => (await request(app).get('/api/v1/positions').use(as)).body;
  const conn = (neumaId) => ({ companion: { name: neumaId, neumaId }, walletAddress: me.address });

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'positions-test-key';
    useTempRealm();
    wsRoot = path.join(await createTempDir('positions'), 'workspaces');
    process.env.NEUMA_CONNECTIONS_PATH = path.join(wsRoot, '..', 'connections.json');
    setWorkspacesRoot(wsRoot);
    me = await fullAuth();
    for (const [i, id] of ['merc', 'books', 'idle'].entries()) {
      await workspace.create(id);
      await fs.writeFile(path.join(wsRoot, id, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
      await fs.mkdir(path.join(wsRoot, id, 'identity'), { recursive: true });
      await fs.writeFile(path.join(wsRoot, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soulOf(i) }));
    }
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    app.use('/api/v1/accounts', accountsRouter);
    app.use('/api/v1/positions', positionsRouter);
  }, 60000);

  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_SWITCHES === undefined) delete process.env.NEUMA_CONNECTIONS_PATH;
    else process.env.NEUMA_CONNECTIONS_PATH = PRIOR_SWITCHES;
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('a new house: every position stands, nobody holds any, and the board is the operator\'s alone', async () => {
    expect((await request(app).get('/api/v1/positions')).status).toBe(401);
    const { positions, members } = await board();
    expect(positions.map((p) => p.office)).toEqual(POSITIONS.map((p) => p.office));
    expect(positions.every((p) => p.holder === null)).toBe(true);
    // A lane with no name of its own yet still reads as something a person can choose.
    expect(members.sort((a, b) => a.laneId.localeCompare(b.laneId))).toEqual([{ laneId: 'books', name: 'books' }, { laneId: 'idle', name: 'idle' }, { laneId: 'merc', name: 'merc' }]);
    expect((await request(app).get('/api/v1/positions/cro/eyes').use(as)).body).toEqual({ eyes: null });
    expect(await positionSection(conn('merc'))).toBe('');
  });

  test('a seat filled through its own office shows on the board, with its switches as they stand', async () => {
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).status).toBe(200);
    expect((await request(app).put('/api/v1/accounts/seat').use(as).send({ laneId: 'books' })).status).toBe(200);
    const { positions } = await board();
    const sales = positions.find((p) => p.office === 'cro');
    expect(sales.holder.laneId).toBe('merc');
    expect(sales.functions.map((f) => f.id)).toEqual(['campaigns', 'leads', 'deals', 'mailbox']);
    expect(sales.connections).toMatchObject([{ id: 'mail-watch', name: 'House mailbox watch', on: false }, { id: 'lead-sources', name: 'Lead sources', on: false }]);
    expect(positions.find((p) => p.office === 'cao').holder.laneId).toBe('books');
    expect(positions.find((p) => p.office === 'cmo').holder).toBe(null);
    // What the seat still needs is measured from the house itself: the seat is filled, nothing else is yet.
    expect(sales.setup).toMatchObject({ done: 1, total: 11 });
    expect(sales.setup.open.map((s) => s.id)).toEqual(['mailbox', 'holder', 'mail-watch', 'lead-sources', 'site', 'campaign', 'facts', 'facts-approved', 'audience', 'audience-approved', 'provider']);
    expect(positions.find((p) => p.office === 'cmo').setup.steps[0]).toMatchObject({ id: 'seat', done: false });
  });

  test('THEIR EYES is the holder\'s own reading: its position map, then its office briefing', async () => {
    const { eyes } = (await request(app).get('/api/v1/positions/cro/eyes').use(as)).body;
    expect(eyes.laneId).toBe('merc');
    expect(eyes.text).toMatch(/^## YOUR POSITION/);
    expect(eyes.text).toContain('- LEADS:');
    expect(eyes.text).toContain('## MERCATOR OFFICE');
    expect((await request(app).get('/api/v1/positions/nope/eyes').use(as)).status).toBe(404);
  });

  test('the being reads its own position only; a member with no seat reads nothing', async () => {
    const merc = await positionSection(conn('merc'));
    expect(merc).toContain('SALES (Mercator)');
    expect(merc).not.toContain('BOOKS (Logista)');
    // Every seat holder reads every company's file: what is known, and what is missing, named.
    expect(merc).toContain('## THE HOUSE\'S COMPANIES');
    // …and, while its position is not set up, the steps still open, the operator's in words to pass on.
    expect(merc).toContain('## SETTING UP YOUR POSITION');
    expect(merc).toContain('- Connect the mailbox the house sends from. POSITIONS, SALES, MAILBOX');
    expect(merc).toMatch(/Umbrae \[umbrae\]: site NOT SET/);
    expect(merc).toMatch(/MISSING: its site address \(the operator sets it in MARKETING, BRAND, SITE & CODE\); facts a buyer may be told/);
    expect((await board()).companies.map((c) => c.id)).toEqual(['ignis', 'umbrae']);
    expect(await positionSection(conn('books'))).toContain('BOOKS (Logista)');
    expect(await positionSection(conn('idle'))).toBe('');
    expect(await positionSection({ companion: { neumaId: 'merc' }, walletAddress: `0x${'9'.repeat(40)}` })).toBe('');
  });

  test('an unseated position stands empty again and tells nobody', async () => {
    expect((await request(app).delete('/api/v1/accounts/seat').use(as)).status).toBe(200);
    expect((await board()).positions.find((p) => p.office === 'cao').holder).toBe(null);
    expect(await positionSection(conn('books'))).toBe('');
  });
});
