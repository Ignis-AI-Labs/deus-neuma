/**
 * BOARD ACTS (integration, RULE 0: the real intent objects on the real house
 * ground, no mock) — the audit's G1: a seat files its own work to the shared
 * board; entries move at the owner's hand or the Optio's; nobody else's.
 * The dispatch unification is proven here too: a staff/dispatch filing lands
 * a linked board entry, and a seat ack moves both.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { listEntries, readEntry } from '../../backend/services/staff/board-store.js';
import { boardAddIntent, boardUpdateIntent } from '../../backend/services/intents/board-acts.js';
import { staffDispatchIntent, staffAckIntent } from '../../backend/services/intents/staff-acts.js';
import { listDispatches } from '../../backend/services/staff/dispatch-store.js';
import { WALLET, OPTIO, HOUSEMATE, BYSTANDER, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

let fx;
const connectionFor = (laneId) => ({ companion: { neumaId: laneId }, walletAddress: WALLET });

beforeEach(async () => {
  fx = await createStaffOfficeFixture();
});

afterEach(async () => {
  await fx?.teardown();
});

const ground = async () => (await loadHouseWorkspace(WALLET)).root;

describe('board/add — a seat posts its own work', () => {
  test('an unseated lane is denied', async () => {
    const verdict = await boardAddIntent.validate(
      { title: 'x' },
      { connection: { companion: { neumaId: 'stranger-lane' }, walletAddress: WALLET } },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe('denied');
  });

  test('a seat files an entry it owns', async () => {
    const connection = connectionFor(HOUSEMATE);
    const verdict = await boardAddIntent.validate({ title: 'Draft the ledger report' }, { connection });
    expect(verdict.ok).toBe(true);
    const outcome = await boardAddIntent.execute(verdict.value, { connection });
    expect(outcome.ok).toBe(true);
    const entries = await listEntries(await ground());
    expect(entries.length).toBe(1);
    expect(entries[0].owner).toBe(HOUSEMATE);
    expect(entries[0].status).toBe('open');
  });
});

describe('board/update — the owner or the Optio, nobody else', () => {
  test('a bystander seat is denied; the owner moves; the Optio moves anything', async () => {
    // The housemate files; a bystander seat (not the owner, not the office) is refused...
    const add = await boardAddIntent.validate({ title: 'Housemate work' }, { connection: connectionFor(HOUSEMATE) });
    await boardAddIntent.execute(add.value, { connection: connectionFor(HOUSEMATE) });
    const [entry] = await listEntries(await ground());

    const bystander = await boardUpdateIntent.validate(
      { id: entry.id, status: 'working' },
      { connection: connectionFor(BYSTANDER) },
    );
    expect(bystander.ok).toBe(false);
    expect(bystander.status).toBe('denied');
    expect(bystander.reason).toContain('its owner or the Optio move it');

    // ...the owner moves it...
    const ownerMove = await boardUpdateIntent.validate(
      { id: entry.id, status: 'working' },
      { connection: connectionFor(HOUSEMATE) },
    );
    expect(ownerMove.ok).toBe(true);
    await boardUpdateIntent.execute(ownerMove.value, { connection: connectionFor(HOUSEMATE) });

    // ...and the Optio moves any entry (the house's work requires it).
    const optioMove = await boardUpdateIntent.validate(
      { id: entry.id, status: 'blocked', note: 'waiting on the ledger numbers' },
      { connection: connectionFor(OPTIO) },
    );
    expect(optioMove.ok).toBe(true);
    const moved = await boardUpdateIntent.execute(optioMove.value, { connection: connectionFor(OPTIO) });
    expect(moved.detail).toContain('blocked');
  });
});

describe('dispatch and board move together', () => {
  test('a dispatch files a linked board entry; a seat ack moves both', async () => {
    // The Optio dispatches a charge to the housemate.
    const connection = connectionFor(OPTIO);
    const verdict = await staffDispatchIntent.validate(
      { to: HOUSEMATE, title: 'Draft the ledger report', body: 'Done looks like: the report filed.' },
      { connection },
    );
    await staffDispatchIntent.execute(verdict.value, { connection });
    const [charge] = await listDispatches(OPTIO);
    expect(charge.boardId).toBeTruthy();
    const linked = await readEntry(await ground(), charge.boardId);
    expect(linked.owner).toBe(HOUSEMATE);
    expect(linked.status).toBe('open');

    // The holder acks received, then done — the board moves with the drawer.
    const holder = connectionFor(HOUSEMATE);
    const ack1 = await staffAckIntent.validate(
      { id: charge.id, status: 'received' },
      { connection: holder },
    );
    expect(ack1.ok).toBe(true);
    await staffAckIntent.execute(ack1.value, { connection: holder });
    expect((await readEntry(await ground(), charge.boardId)).status).toBe('open');

    const ack2 = await staffAckIntent.validate(
      { id: charge.id, status: 'done' },
      { connection: holder },
    );
    await staffAckIntent.execute(ack2.value, { connection: holder });
    expect((await readEntry(await ground(), charge.boardId)).status).toBe('done');
    expect((await listDispatches(OPTIO)).find((c) => c.id === charge.id).status).toBe('done');
  });
});
