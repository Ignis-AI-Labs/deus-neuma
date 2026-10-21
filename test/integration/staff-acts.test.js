/**
 * STAFF ACTS (integration, RULE 0: the real intent objects, real disk, no
 * mock) — `staff/dispatch` and `staff/dispatch-update` through the same
 * validate → execute calls the sweep makes. The office law is the subject:
 * only the seated Optio's lane files or moves charges, the recipient must
 * hold a seat, and one filing lands BOTH records — the delivery post in the
 * seat's real house inbox and the charge in the drawer.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { readNewPosts } from '../../backend/services/house-post.js';
import { listDispatches, readDispatch, deliveryOf, updateDispatch } from '../../backend/services/staff/dispatch-store.js';
import { staffDispatchIntent, staffDispatchUpdateIntent } from '../../backend/services/intents/staff-acts.js';
import { WALLET, OPTIO, HOUSEMATE, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

let fx;

// The connection shape validate/execute read — the same fields the portal
// carries: who speaks (lane) and whose house the act rides (wallet).
const connectionFor = (laneId) => ({ companion: { neumaId: laneId }, walletAddress: WALLET });

beforeEach(async () => {
  fx = await createStaffOfficeFixture();
});

afterEach(async () => {
  await fx?.teardown();
});

describe('staff/dispatch — the office files a charge', () => {
  test('a lane that is not the seated Optio is denied before anything is written', async () => {
    const verdict = await staffDispatchIntent.validate(
      { to: OPTIO, title: 'x', body: 'y' },
      { connection: connectionFor(HOUSEMATE) },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe('denied');
    expect(verdict.reason).toContain('only the seated chief of staff');
    expect(await listDispatches(OPTIO)).toEqual([]);
  });

  test('a missing officer seat and an unseated recipient are refused', async () => {
    const stranger = await staffDispatchIntent.validate(
      { to: 'stranger-lane', title: 'x', body: 'y' },
      { connection: connectionFor(OPTIO) },
    );
    expect(stranger.ok).toBe(false);
    expect(stranger.reason).toContain('holds no seat');

    await fx.cosDesignation.clear(WALLET);
    const unseated = await staffDispatchIntent.validate(
      { to: HOUSEMATE, title: 'x', body: 'y' },
      { connection: connectionFor(OPTIO) },
    );
    expect(unseated.ok).toBe(false);
    expect(unseated.status).toBe('denied');
  });

  test('one filing lands both records: the real post and the drawer charge', async () => {
    const connection = connectionFor(OPTIO);
    const verdict = await staffDispatchIntent.validate(
      { to: HOUSEMATE, title: 'Draft the ledger report', body: 'Done looks like: the report filed.' },
      { connection },
    );
    expect(verdict.ok).toBe(true);
    const outcome = await staffDispatchIntent.execute(verdict.value, { connection });
    expect(outcome.ok).toBe(true);

    // The delivery: a real post in the seat's real house inbox.
    const { root: houseRoot } = await loadHouseWorkspace(WALLET);
    const inbox = await readNewPosts(houseRoot, HOUSEMATE);
    expect(inbox.messages.length).toBe(1);
    expect(inbox.messages[0].re).toBe('Draft the ledger report');
    expect(inbox.messages[0].from).toBe(OPTIO);

    // The record: the drawer claims the delivery by post id.
    const drawer = await listDispatches(OPTIO);
    expect(drawer.length).toBe(1);
    expect(drawer[0].to).toBe(HOUSEMATE);
    const charge = await readDispatch(OPTIO, drawer[0].id);
    expect(charge.postId).toBe(inbox.messages[0].id);
    expect(await deliveryOf(houseRoot, charge)).toBe('waiting-unread');
  });

  test('advertisements follow the office: the officer sees the intent, a housemate does not', async () => {
    expect(await staffDispatchIntent.availableFor({ connection: connectionFor(OPTIO) })).toEqual({});
    expect(await staffDispatchIntent.availableFor({ connection: connectionFor(HOUSEMATE) })).toBeNull();
  });
});

describe('staff/dispatch-update — only the officer moves a charge', () => {
  test('a housemate is denied and an unknown id is invalid', async () => {
    const denied = await staffDispatchUpdateIntent.validate(
      { id: 'whatever', status: 'done' },
      { connection: connectionFor(HOUSEMATE) },
    );
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe('denied');

    const missing = await staffDispatchUpdateIntent.validate(
      { id: 'nope', status: 'done' },
      { connection: connectionFor(OPTIO) },
    );
    expect(missing.ok).toBe(false);
    expect(missing.reason).toContain('not in your drawer');
  });

  test('the officer closes a charge; a closed charge does not move again', async () => {
    const connection = connectionFor(OPTIO);
    const verdict = await staffDispatchIntent.validate(
      { to: HOUSEMATE, title: 'Draft the ledger report', body: 'Done looks like: the report filed.' },
      { connection },
    );
    // File the charge for real — the update needs its record in the drawer.
    await staffDispatchIntent.execute(verdict.value, { connection });
    const { charge } = verdict.value;

    const moved = await staffDispatchUpdateIntent.execute(
      { laneId: OPTIO, id: charge.id, status: 'done', note: 'report filed' },
      { connection },
    );
    expect(moved.ok).toBe(true);
    expect(moved.detail).toContain('is now done');

    const again = await staffDispatchUpdateIntent.validate(
      { id: charge.id, status: 'blocked' },
      { connection },
    );
    expect(again.ok).toBe(false);
    expect(again.reason).toContain('already done');
  });

  test('a charge its holder acked is still the office\'s to move — only a closed one stands still', async () => {
    const connection = connectionFor(OPTIO);
    const verdict = await staffDispatchIntent.validate(
      { to: HOUSEMATE, title: 'Draft the ledger report', body: 'Done looks like: the report filed.' },
      { connection },
    );
    await staffDispatchIntent.execute(verdict.value, { connection });
    const { charge } = verdict.value;
    await updateDispatch(OPTIO, charge.id, { status: 'working' });

    const noted = await staffDispatchUpdateIntent.validate({ id: charge.id, note: 'the draft is due today' }, { connection });
    expect(noted.ok).toBe(true);
    const blocked = await staffDispatchUpdateIntent.validate({ id: charge.id, status: 'blocked' }, { connection });
    expect(blocked.ok).toBe(true);
    await staffDispatchUpdateIntent.execute(blocked.value, { connection });
    expect((await readDispatch(OPTIO, charge.id)).status).toBe('blocked');
  });
});
