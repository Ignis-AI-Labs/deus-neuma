/**
 * THE STATUS SWEEP (integration, RULE 0: real posts on a real house ground,
 * the clock injected — no mock) — the standing ask behind every open charge:
 * a cadenced status-check post lands ONCE and waits; a collected ask re-fires
 * on the next cadence; a charge no officer seated can never be asked about.
 * This is coordination through inboxes, never a command — the sweep appends
 * real house posts, it invokes no lane.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { readNewPosts, saveCursor } from '../../backend/services/house-post.js';
import { fileDispatch, readDispatch } from '../../backend/services/staff/dispatch-store.js';
import { statusTick, STATUS_CADENCE_MS } from '../../backend/services/staff/status-sweep.js';
import { WALLET, OPTIO, HOUSEMATE, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

let fx;
const FILED_AT = '2026-09-15T04:00:00.000Z';
const FILED_MS = Date.parse(FILED_AT);

const seedCharge = async (over = {}) => fileDispatch(OPTIO, {
  v: 1,
  id: `2026-09-15T04-00-00-000Z${over.suffix ?? ''}`,
  from: OPTIO,
  to: HOUSEMATE,
  title: 'Draft the ledger report',
  body: 'Done looks like: the report filed.',
  filedAt: FILED_AT,
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

beforeEach(async () => {
  fx = await createStaffOfficeFixture();
});

afterEach(async () => {
  await fx?.teardown();
});

const seatInbox = async () => {
  const { root } = await loadHouseWorkspace(WALLET);
  return readNewPosts(root, HOUSEMATE);
};

describe('statusTick — the standing ask', () => {
  test('a fresh charge is not asked before its cadence', async () => {
    await seedCharge();
    const tick = await statusTick(FILED_MS + 60 * 60 * 1000);
    expect(tick.asked).toEqual([]);
    expect((await seatInbox()).messages.length).toBe(0);
  });

  test('past the cadence, ONE real status-check post lands and is stamped', async () => {
    await seedCharge();
    const tick = await statusTick(FILED_MS + STATUS_CADENCE_MS + 60_000);
    expect(tick.asked.map((a) => a.to)).toEqual([HOUSEMATE]);
    const { messages } = await seatInbox();
    expect(messages.length).toBe(1);
    expect(messages[0].re).toBe('Status check — Draft the ledger report');
    expect(messages[0].body).toContain('2026-09-15T04-00-00-000Z');
    expect(messages[0].from).toBe(OPTIO);
    const record = await readDispatch(OPTIO, '2026-09-15T04-00-00-000Z');
    expect(record.lastCheckedAt).toBe(messages[0].ts);
  });

  test('an uncollected ask never duplicates — the knock is standing', async () => {
    await seedCharge();
    const first = FILED_MS + STATUS_CADENCE_MS + 60_000;
    await statusTick(first);
    const second = await statusTick(first + STATUS_CADENCE_MS);
    expect(second.asked).toEqual([]);
    expect((await seatInbox()).messages.length).toBe(1);
  });

  test('a COLLECTED ask re-fires on the next cadence — the office asks again', async () => {
    await seedCharge();
    const first = FILED_MS + STATUS_CADENCE_MS + 60_000;
    await statusTick(first);
    // The seat collects their mail (their own cursor, their own mark).
    const { root } = await loadHouseWorkspace(WALLET);
    const { cursor } = await readNewPosts(root, HOUSEMATE);
    await saveCursor(root, HOUSEMATE, cursor);
    const second = await statusTick(first + STATUS_CADENCE_MS);
    expect(second.asked.length).toBe(1);
    expect((await seatInbox()).messages.length).toBe(1);
  });

  test('no seated officer, no sweep; a closed charge is never asked', async () => {
    const idle = await statusTick(FILED_MS + STATUS_CADENCE_MS + 60_000);
    expect(idle.asked).toEqual([]);

    await seedCharge();
    await fileDispatch(OPTIO, {
      v: 1,
      id: '2026-09-15T05-00-00-000Z',
      from: OPTIO,
      to: HOUSEMATE,
      title: 'A settled charge',
      body: 'Already done.',
      filedAt: '2026-09-15T05:00:00.000Z',
      dueAt: null,
      by: WALLET,
      postId: null,
      status: 'done',
      ackAt: null,
      doneAt: '2026-09-15T06:00:00.000Z',
      note: '',
      lastCheckedAt: null,
    });
    const tick = await statusTick(FILED_MS + STATUS_CADENCE_MS + 120_000);
    expect(tick.checked).toBe(1);
    expect(tick.asked.map((a) => a.id)).toEqual(['2026-09-15T04-00-00-000Z']);

    await fx.cosDesignation.clear(WALLET);
    const unseated = await statusTick(FILED_MS + 10 * STATUS_CADENCE_MS);
    expect(unseated.asked).toEqual([]);
  });
});
