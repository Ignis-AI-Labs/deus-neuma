/**
 * HOUSE STATE (RULE 0: the real fold over real stores, no mock) — the one
 * computed answer to […], proven against a founded
 * fixture house: roster enrichment from real inboxes and a real (encrypted)
 * task ledger, the dispatch drawer, the queue and leads posture, and the
 * fail-soft law — one broken store never blanks the house.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { makePost, appendPost } from '../../backend/services/house-post.js';
import { fileDispatch } from '../../backend/services/staff/dispatch-store.js';
import { computeHouseState, formatHouseStateForBeing } from '../../backend/services/staff/house-state.js';
import { cosBriefingSection } from '../../backend/services/staff/cos-briefing.js';
import { officeFile } from '../../backend/services/house-office.js';
import { WALLET, OPTIO, HOUSEMATE, BYSTANDER, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

let fx;

beforeEach(async () => {
  fx = await createStaffOfficeFixture();
});

afterEach(async () => {
  await fx?.teardown();
});

const seedCharge = async (over = {}) => fileDispatch(OPTIO, {
  v: 1,
  id: `2026-09-15T04-00-00-000Z${over.suffix ?? ''}`,
  from: OPTIO,
  to: HOUSEMATE,
  title: 'Draft the ledger report',
  body: 'Done looks like: the report filed in the house repo.',
  filedAt: '2026-09-15T04:00:00.000Z',
  dueAt: null,
  by: WALLET,
  postId: 'abc123',
  status: 'dispatched',
  ackAt: null,
  doneAt: null,
  note: '',
  lastCheckedAt: null,
  ...over,
});

describe('computeHouseState — the whole house in one fold', () => {
  test('the roster reads who owes what: unread post, live tasks, open charges', async () => {
    const { root: houseRoot } = await loadHouseWorkspace(WALLET);
    await appendPost(houseRoot, makePost({
      from: OPTIO, to: HOUSEMATE, body: 'the charge', re: 'The charge', now: '2026-09-15T04:00:00.000Z',
    }));
    await neumaWorkspace.writeTaskLedger(HOUSEMATE, {
      tasks: [
        { id: 't1', status: 'open', title: 'x' },
        { id: 't2', status: 'active', title: 'y' },
        { id: 't3', status: 'done', title: 'z' },
      ],
    });
    await seedCharge();

    const state = await computeHouseState({ wallet: WALLET, laneId: OPTIO });

    expect(state.houseName).toBe('Fixture House');
    expect(state.roster.map((r) => r.neumaId).sort()).toEqual([HOUSEMATE, BYSTANDER].sort());
    const seat = state.roster[0];
    expect(seat.unreadPost).toBe(1);
    expect(seat.liveTasks).toBe(2);
    expect(seat.openCharges).toBe(1);
    expect(state.dispatches.open).toBe(1);
    expect(state.ownInbox.count).toBe(0);
  });

  test('task TITLES never cross into the house view — counts only', async () => {
    await neumaWorkspace.writeTaskLedger(HOUSEMATE, {
      tasks: [{ id: 't1', status: 'open', title: 'the secret of the ledger' }],
    });
    const state = await computeHouseState({ wallet: WALLET, laneId: OPTIO });
    const text = formatHouseStateForBeing(state);
    expect(text).toContain('1 live task(s)');
    expect(text).not.toContain('the secret of the ledger');
  });

  test('every leg fails soft — a broken store degrades alone', async () => {
    // The house's OWN lead ledger is a directory, not a file.
    await fs.mkdir(officeFile(WALLET, 'marketing', 'lead-ledger.json'), { recursive: true });
    const state = await computeHouseState({ wallet: WALLET, laneId: OPTIO });
    expect(state.leads.total).toBe(0);
    expect(state.dispatches.total).toBe(0);
    expect(state.roster.length).toBe(2);
  });

  test('an unfounded house still answers — empty, honest', async () => {
    const state = await computeHouseState({ wallet: `0x${'b'.repeat(40)}`, laneId: 'stranger-lane' });
    expect(state.houseName).toBeNull();
    expect(state.roster).toEqual([]);
    expect(state.dispatches.total).toBe(0);
  });
});

describe('formatHouseStateForBeing — the office reads its house', () => {
  test('the text carries the seats, the drawer, and the aging', async () => {
    await seedCharge();
    const state = await computeHouseState({ wallet: WALLET, laneId: OPTIO });
    const text = formatHouseStateForBeing(state, Date.parse('2026-09-17T04:00:00.000Z'));
    expect(text).toContain('## HOUSE STATE');
    expect(text).toContain('Fixture House');
    expect(text).toContain('1 open of 1 charge(s)');
    expect(text).toContain('"Draft the ledger report"');
    expect(text).toContain('dispatched 2d ago');
  });
});

describe('the drawer read whole — an older past-due charge never drops out', () => {
  test('one old open charge past due, twelve newer closed ones: house_state and the briefing both carry it', async () => {
    const old = await seedCharge({
      id: '2026-09-01T04-00-00-000Z', filedAt: '2026-09-01T04:00:00.000Z', dueAt: '2026-09-02T04:00:00.000Z', title: 'The old ledger',
    });
    for (let n = 10; n < 22; n += 1) {
      await seedCharge({ id: `2026-09-${n}T04-00-00-000Z`, filedAt: `2026-09-${n}T04:00:00.000Z`, status: 'done', title: `Closed ${n}` });
    }

    const state = await computeHouseState({ wallet: WALLET, laneId: OPTIO });
    expect(state.dispatches).toMatchObject({ open: 1, pastDue: 1, total: 13 });
    expect(state.dispatches.charges[0].id).toBe(old.id);
    const text = formatHouseStateForBeing(state, Date.parse('2026-09-25T04:00:00.000Z'));
    expect(text).toContain('1 open of 13 charge(s) — 1 PAST DUE');
    expect(text).toContain('"The old ledger"');
    expect(text).toContain('…and 3 older closed charge(s), not listed.');

    const briefing = await cosBriefingSection({ companion: { neumaId: OPTIO }, walletAddress: WALLET });
    expect(briefing).toContain(`[${old.id}] "The old ledger"`);
    expect(briefing).toContain('…and 8 more — house_state lists every open one.');
    expect(briefing).toContain('1 charge(s) PAST DUE');
  });
});
