/**
 * house/charter — the house sets up its own charter (Design note, 2026-11-13: […]), through the REAL intent sweep
 * (RULE 0): a real temp realm and workspaces, two members of one operator's
 * house and one lane of another house, the real charter store, the real wake
 * gate and the real notification store. What it proves: an unapproved member's
 * filing waits; an explicitly granted change stands and lets a seat wake; only the fields it names change; the
 * operator's three fields and the pause stay theirs; another house's lane
 * cannot touch this house's charter; every version is kept with who set it,
 * and the operator gets a card for each.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { granting, settled } from '../helpers/intent-path.js';

const ENV = ['WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'NEUMA_DATA_ROOT'];
const saved = {};
let root, operator, stranger, store, read, gate, viaIntentReal, notes, KIND;
const viaIntent = (connection, type, payload, mode = 'ask', lanePolicy = granting('house.charter'), emit = () => {}) =>
  viaIntentReal(connection, type, payload, mode, lanePolicy, emit);
const member = (neumaId, wallet = operator) => ({ companion: { neumaId, name: neumaId[0].toUpperCase() + neumaId.slice(1) }, walletAddress: wallet, sessionId: 's-1', toolMode: 'ask' });
const cards = async () => (await notes.readNotifications(operator)).records.filter((n) => n.kind === KIND.houseWake);

beforeEach(async () => {
  vi.resetModules();
  for (const k of ENV) saved[k] = process.env[k];
  root = await createTempDir('house-charter-self');
  process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
  process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  (await import('../../backend/services/user-realm.js')).setRealmRoot(process.env.NEUMA_REALM_ROOT);
  const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
  const { claimOwner } = await import('../helpers/claim-owner.js');
  operator = ethers.Wallet.createRandom().address.toLowerCase();
  stranger = ethers.Wallet.createRandom().address.toLowerCase();
  for (const [lane, owner] of [['tenekom', operator], ['rugevil', operator], ['far', stranger]]) {
    await workspace.create(lane);
    await claimOwner(process.env.WORKSPACES_ROOT, lane, owner);
  }
  store = await import('../../backend/services/house-clock/charter-store.js');
  read = await import('../../backend/services/house-clock/charter-shape.js');
  gate = await import('../../backend/services/house-clock/wake-gate.js');
  ({ viaIntent: viaIntentReal } = await import('../helpers/intent-path.js'));
  notes = await import('../../backend/services/notification-store.js');
  ({ KIND } = await import('../../core/runtime/notification-record.js'));
});

afterEach(async () => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(root, { recursive: true, force: true });
});

describe('the house sets up its own charter', () => {
  test('a member filing is refused by default; the same filing stands under an explicit grant', async () => {
    const connection = member('tenekom');
    const payload = { goal: 'Run the LP books.', seat: { dailyCap: 24 } };
    const [held] = await viaIntent(connection, 'house/charter', payload, 'ask', null);
    expect(held).toMatchObject({ status: 'denied', tool: 'intents/house.charter' });
    expect(await settled(connection)).toBe(true);
    expect(await store.readCharter(operator)).toBeNull();
    const [approved] = await viaIntent(connection, 'house/charter', payload);
    expect(approved.status).toBe('ok');
    expect(await store.readCharter(operator)).toMatchObject({ version: 1, approvedBy: { laneId: 'tenekom' } });
  });

  test('a member sets one up from nothing: it stands at once, its seat may wake, and the operator is told', async () => {
    const [receipt] = await viaIntent(member('tenekom'), 'house/charter', { goal: 'Run the LP books round the clock.', seat: { dailyCap: 24 }, why: 'so I can work my portfolio rounds' });
    expect(receipt.status).toBe('ok');
    const charter = await store.readCharter(operator);
    expect(charter).toMatchObject({ version: 1, seats: [{ laneId: 'tenekom', dailyCap: 24 }], approvedBy: { kind: 'member', laneId: 'tenekom', via: 'self' }, approvedVersion: 1 });
    expect(read.charterStanding(charter)).toBe('active');
    expect(gate.takeGate({ charter, seat: 'tenekom' })).toEqual({ ok: true });
    expect(gate.runGate({ charter, seat: 'tenekom', now: Date.now(), count: 0 })).toEqual({ ok: true });
    const [card] = await cards();
    expect(card).toMatchObject({ title: 'Tenekom set up the house charter (version 1)', ref: { charterVersion: 1 } });
    expect(card.detail).toMatch(/goal, its own seat \(24 wakes a day\) · why: so I can work my portfolio rounds/);
  });

  test('a second member seats itself without touching the first; every version is kept with who set it', async () => {
    await viaIntent(member('tenekom'), 'house/charter', { goal: 'Run the LP books.', seat: { dailyCap: 24 } });
    const [receipt] = await viaIntent(member('rugevil'), 'house/charter', { seat: { dailyCap: 10 }, quietHours: { start: '01:00', end: '06:00' } });
    expect(receipt.status).toBe('ok');
    const charter = await store.readCharter(operator);
    expect(charter).toMatchObject({ version: 2, goal: 'Run the LP books.', seats: [{ laneId: 'tenekom', dailyCap: 24 }, { laneId: 'rugevil', dailyCap: 10 }], approvedBy: { laneId: 'rugevil' } });
    expect((await store.readCharterHistory(operator)).map((h) => [h.version, h.approvedBy.laneId])).toEqual([[1, 'tenekom']]);
    expect((await cards()).map((c) => c.title)).toContain('Rugevil changed the house charter (version 2)');
  });

  test('the operator\'s three fields and the pause stay theirs', async () => {
    await viaIntent(member('tenekom'), 'house/charter', { goal: 'Run the LP books.', seat: { dailyCap: 24 } });
    const [allow] = await viaIntent(member('rugevil'), 'house/charter', { allow: ['intents/social.post'] });
    expect(allow.status).toBe('error');
    expect(allow.error).toMatch(/allow stay your operator's/);
    await store.setCharterPaused(operator, true);
    const [edit] = await viaIntent(member('rugevil'), 'house/charter', { cadence: { everyHours: 1 } });
    expect(edit.status).toBe('ok');
    expect(edit.content).toMatch(/your operator has the house paused/);
    const charter = await store.readCharter(operator);
    expect(charter).toMatchObject({ version: 2, paused: true, cadence: { everyHours: 1 }, allow: [] });
    expect(read.charterStanding(charter)).toBe('paused');
  });

  test('another house\'s lane, or a seat outside the house, never reaches this house\'s charter', async () => {
    const [outsider] = await viaIntent(member('far'), 'house/charter', { goal: 'Take over.', seat: { dailyCap: 48 } });
    expect(outsider.status).not.toBe('ok');
    const [wrongSeat] = await viaIntent(member('tenekom'), 'house/charter', { goal: 'g', seats: [{ laneId: 'far', dailyCap: 5 }] });
    expect(wrongSeat.status).toBe('error');
    expect(wrongSeat.error).toMatch(/seat far is not a being of this house/);
    expect(await store.readCharter(operator)).toBeNull();
  });
});
