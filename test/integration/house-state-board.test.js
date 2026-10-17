/**
 * HOUSE STATE, DEEPENED (integration, RULE 0: the real fold over real stores
 * on a real founded house, no mock) — the audit's G6/G7: the one call now
 * carries the board (per-seat work, stale flags), the campaigns, and the
 * recent posting failures beside everything wave one folded.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { listEntries } from '../../backend/services/staff/board-store.js';
import { computeHouseState, formatHouseStateForBeing } from '../../backend/services/staff/house-state.js';
import { boardAddIntent } from '../../backend/services/intents/board-acts.js';
import { staffDispatchIntent } from '../../backend/services/intents/staff-acts.js';
import { WALLET, OPTIO, HOUSEMATE, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

let fx;

beforeEach(async () => {
  fx = await createStaffOfficeFixture();
});

afterEach(async () => {
  await fx?.teardown();
});

const ground = async () => (await loadHouseWorkspace(WALLET)).root;

const seedBoard = async () => {
  const connection = { companion: { neumaId: HOUSEMATE }, walletAddress: WALLET };
  const add = await boardAddIntent.validate({ title: 'Draft the ledger report' }, { connection });
  await boardAddIntent.execute(add.value, { connection });
  return (await listEntries(await ground())).find((e) => e.title === 'Draft the ledger report');
};

describe('computeHouseState — the board, the campaigns, the failures', () => {
  test('per-seat board work and the stale flag ride the fold', async () => {
    const seeded = await seedBoard();
    // Force the entry ancient so the STALE law can be seen answering.
    const boardFile = path.join(fx.ground, 'board', `${seeded.id}.json`);
    const record = JSON.parse(await fs.readFile(boardFile, 'utf8'));
    record.updatedAt = '2026-08-01T00:00:00.000Z';
    await fs.writeFile(boardFile, `${JSON.stringify(record, null, 2)}\n`);

    const state = await computeHouseState({ wallet: WALLET, laneId: OPTIO });
    expect(state.board.open).toBe(1);
    expect(state.board.stale).toBe(1);
    const seat = state.roster.find((r) => r.neumaId === HOUSEMATE);
    expect(seat.boardWork.length).toBe(1);
    expect(seat.boardWork[0].stale).toBe(true);

    const text = formatHouseStateForBeing(state, Date.parse('2026-09-15T04:00:00.000Z'));
    expect(text).toContain('1 STALE');
    expect(text).toContain('Draft the ledger report');
  });

  test('dispatches land on the board for the whole house to see', async () => {
    const connection = { companion: { neumaId: OPTIO }, walletAddress: WALLET };
    const verdict = await staffDispatchIntent.validate(
      { to: HOUSEMATE, title: 'Draft the ledger report', body: 'Done looks like: the report filed.' },
      { connection },
    );
    await staffDispatchIntent.execute(verdict.value, { connection });
    const state = await computeHouseState({ wallet: WALLET, laneId: OPTIO });
    expect(state.board.open).toBe(1);
    const seat = state.roster.find((r) => r.neumaId === HOUSEMATE);
    expect(seat.boardWork[0].title).toBe('Draft the ledger report');
  });

  test('campaigns and posting failures fold in, each failing soft', async () => {
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(fx.root, 'not-a-dir-queue');
    await fs.mkdir(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH);
    const state = await computeHouseState({ wallet: WALLET, laneId: OPTIO });
    expect(state.failures).toEqual([]);
    expect(state.campaigns).toHaveProperty('total');
    delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  });
});
