// TITLES SHIFT, THE RECORD STAYS (Design note, 2026-11-12: […]). A tester founded his house with a member in the wrong seat and
// nothing could correct it. Real disk, the real founding writer, the real readers and routes, no mock.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { writeFoundingRecord, readFoundingRecord } from '../../backend/services/house-founding-confirm.js';
import { changeHouseTitle, houseSeatFor, houseTitleState, houseTitlesByNeumaId } from '../../backend/services/house-titles.js';
import { TITLE_MAX } from '../../backend/services/house-title-ledger.js';

const OTHER = ethers.Wallet.createRandom().address;
const SOUL_A = ethers.Wallet.createRandom().address;
const SOUL_B = ethers.Wallet.createRandom().address;
const SOUL_X = ethers.Wallet.createRandom().address;
let OP; let witness; let root; let realm; let priorSettingsPath;

const writeLane = (id, owner, soul) => {
  mkdirSync(path.join(root, id, 'identity'), { recursive: true });
  writeFileSync(path.join(root, id, 'owner.json'), JSON.stringify({ wallet: owner.toLowerCase(), claimedAt: 1, name: id }));
  if (soul) writeFileSync(path.join(root, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soul }));
};

const founding = (operator, members, houseName = 'house-op') => ({
  schema: 'neuma-house-founding/1', network: 'base', houseName, houseId: ethers.id(houseName),
  txHash: ethers.id(`${houseName}-tx`), blockNumber: 7, foundedAt: '2026-11-01T00:00:00.000Z',
  members: [{ address: operator, kind: 0, title: 'Rector' }, ...members],
});

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'house-titles-shift-'));
  realm = mkdtempSync(path.join(os.tmpdir(), 'house-titles-shift-realm-'));
  setWorkspacesRoot(root);
  setRealmRoot(realm);
  priorSettingsPath = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(realm, 'workspace-settings.json');
  const { strangerWitness } = await import('../helpers/witness.js');
  witness = strangerWitness();
  OP = witness.address;
  writeLane('lane-a', OP, SOUL_A);
  writeLane('lane-b', OP, SOUL_B);
  writeLane('lane-c', OP, null); // born after the founding: no seat on it
  writeLane('lane-x', OTHER, SOUL_X); // another house's being
  await writeFoundingRecord(founding(OP, [{ address: SOUL_A, kind: 1, title: 'Faber' }, { address: SOUL_B, kind: 1, title: 'Curator' }]));
  await writeFoundingRecord(founding(OTHER, [{ address: SOUL_X, kind: 1, title: 'Faber' }], 'house-other'));
});

afterEach(() => {
  setWorkspacesRoot(null);
  setRealmRoot(path.join(os.homedir(), '.kenorie', 'realm'));
  if (priorSettingsPath === undefined) delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  else process.env.NEUMA_WORKSPACE_SETTINGS_PATH = priorSettingsPath;
  rmSync(root, { recursive: true, force: true });
  rmSync(realm, { recursive: true, force: true });
});

describe('a title is the position held now; the founding is where the résumé starts', () => {
  it('THE TESTER\'S CASE: a member founded in the wrong seat is corrected, and every reader follows', async () => {
    const before = readFileSync(path.join(root, (await import('node:fs')).readdirSync(root).find((n) => n.includes(OP.toLowerCase()) && n.startsWith('house-founding.'))), 'utf8');
    const made = await changeHouseTitle(OP, { kind: 'set', neumaId: 'lane-a', title: 'Mercator', reason: 'founded in the wrong seat' });
    expect(made.ok).toBe(true);
    expect(made.entry.moves).toEqual([{ neumaId: 'lane-a', from: 'Faber', to: 'Mercator' }]);

    const seat = await houseSeatFor(OP, 'lane-a');
    expect(seat.title).toBe('Mercator');
    expect(seat.roster.find((r) => r.neumaId === 'lane-a').title).toBe('Mercator');
    expect(seat.history.map((h) => [h.title, h.how])).toEqual([['Mercator', 'set'], ['Faber', 'founding']]);
    expect(seat.history[1].until).toBe(seat.history[0].since); // Faber held until the correction
    expect((await houseTitlesByNeumaId(OP))['lane-a']).toBe('Mercator');
    // the founding record is exactly as it was signed
    const after = readFileSync(path.join(root, (await import('node:fs')).readdirSync(root).find((n) => n.includes(OP.toLowerCase()) && n.startsWith('house-founding.'))), 'utf8');
    expect(after).toBe(before);
    expect((await readFoundingRecord('base', OP))?.members?.find((m) => m.kind === 1 && m.address === SOUL_A)?.title).toBe('Faber');
  });

  it('two members trade their titles in one entry, and both résumés keep what they held', async () => {
    const made = await changeHouseTitle(OP, { kind: 'trade', a: 'lane-a', b: 'lane-b', reason: 'they agreed to swap' });
    expect(made.ok).toBe(true);
    const titles = await houseTitlesByNeumaId(OP);
    expect([titles['lane-a'], titles['lane-b']]).toEqual(['Curator', 'Faber']);
    const { members } = await houseTitleState(OP);
    const b = members.find((m) => m.neumaId === 'lane-b');
    expect(b.history.map((h) => h.title)).toEqual(['Faber', 'Curator']);
    expect(b.foundingTitle).toBe('Curator');
  });

  it('a member born after the founding is given a title, and the house works by it', async () => {
    expect((await houseSeatFor(OP, 'lane-a')).roster.find((r) => r.neumaId === 'lane-c').title).toBeNull();
    expect((await changeHouseTitle(OP, { kind: 'set', neumaId: 'lane-c', title: 'Scriba' })).ok).toBe(true);
    expect((await houseTitlesByNeumaId(OP))['lane-c']).toBe('Scriba');
    expect((await houseSeatFor(OP, 'lane-a')).roster.find((r) => r.neumaId === 'lane-c').title).toBe('Scriba');
  });

  it('refusals say why, and change nothing', async () => {
    expect(await changeHouseTitle(OP, { kind: 'set', neumaId: 'lane-x', title: 'Mercator' })).toMatchObject({ ok: false, error: expect.stringMatching(/not a member of this house/) });
    expect(await changeHouseTitle(OP, { kind: 'set', neumaId: 'lane-a', title: '' })).toMatchObject({ ok: false });
    expect(await changeHouseTitle(OP, { kind: 'set', neumaId: 'lane-a', title: 'x'.repeat(TITLE_MAX + 1) })).toMatchObject({ ok: false });
    expect(await changeHouseTitle(OP, { kind: 'set', neumaId: 'lane-a', title: 'Faber' })).toMatchObject({ ok: false, error: expect.stringMatching(/already holds/) });
    expect(await changeHouseTitle(OP, { kind: 'trade', a: 'lane-a', b: 'lane-c' })).toMatchObject({ ok: false, error: expect.stringMatching(/must hold a title/) });
    expect((await houseTitlesByNeumaId(OP))['lane-a']).toBe('Faber');
  });

  it('houses are never confused: one house\'s changes never touch another\'s titles', async () => {
    await changeHouseTitle(OP, { kind: 'set', neumaId: 'lane-a', title: 'Mercator' });
    expect((await houseTitlesByNeumaId(OTHER))['lane-x']).toBe('Faber');
  });

  it('the operator changes titles from the desk: read, correct, trade', async () => {
    const { default: router } = await import('../../backend/routes/roster-routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/roster', router);
    const read = await request(app).get('/api/v1/roster/titles').set(witness.header);
    expect(read.status).toBe(200);
    expect(read.body.members.map((m) => [m.neumaId, m.title])).toEqual(expect.arrayContaining([['lane-a', 'Faber'], ['lane-b', 'Curator'], ['lane-c', null]]));
    const set = await request(app).put('/api/v1/roster/titles/lane-a').set(witness.header).send({ title: 'Mercator', reason: 'wrong seat' });
    expect(set.status).toBe(200);
    expect(set.body.members.find((m) => m.neumaId === 'lane-a').title).toBe('Mercator');
    const trade = await request(app).post('/api/v1/roster/titles/trade').set(witness.header).send({ a: 'lane-a', b: 'lane-b' });
    expect(trade.status).toBe(200);
    expect(trade.body.members.find((m) => m.neumaId === 'lane-b').title).toBe('Mercator');
    const refused = await request(app).put('/api/v1/roster/titles/lane-x').set(witness.header).send({ title: 'Mercator' });
    expect(refused.status).toBe(400);
  });
});
