/**
 * WHO IS AWAKE, FOR REAL (RULE 0) — the desk's HOUSE n chip reads
 * houseActivity, and a being awake in a house-clock wake shows there: the real
 * house (house-wake-kit.js: temp realm, temp house ground, three lanes of one
 * wallet, the Optio seated), the real wake queue on disk, the real wake turn
 * over a real loopback OpenAI-wire provider whose answer takes its time, and
 * the real model line held full so a wake can be seen waiting for its place.
 *
 * Under proof:
 *  - a seat woken for a house post reads 'waiting' while its turn waits for the
 *    model line, 'awake' once it has its place, with what woke it in plain
 *    words; gone once the wake ends;
 *  - with no office seated, the running wake still shows;
 *  - a seat woken for a charge it already holds keeps ONE row, now awake;
 *  - another house never sees this house's wake (keyed by the operator wallet);
 *  - a row says the being's own name, never its lane id — and a lane of
 *    another house is never named from that house's records.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, until, WALLET, OPTIO, HOUSEMATE } from '../helpers/house-wake-kit.js';
import { houseActivity } from '../../backend/services/staff/house-state.js';
import { substrateLine } from '../../backend/services/substrate-lease.js';
import fs from 'fs/promises';
import path from 'path';
import { fileDispatch, makeCharge } from '../../backend/services/staff/dispatch-store.js';
import neumaWorkspace, { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const OTHER_HOUSE = `0x${'b'.repeat(40)}`;

// impure — the housemate's row on the chip's fold, once it reads `status`
const rowFor = (status, officer = OPTIO) => until(async () => {
  const rows = await houseActivity(WALLET, officer);
  return rows.find((r) => r.neumaId === HOUSEMATE && r.status === status) ? rows : null;
});

describe('houseActivity counts the house clock\'s running wakes', () => {
  let house;
  let busy = [];

  beforeEach(async () => { house = await createWakeHouse(); });
  afterEach(async () => {
    busy.forEach((b) => b.release());
    busy = [];
    await house.teardown();
  });

  // impure — take every place in the model line, so a wake waits for its own
  const fillLine = async () => {
    busy = await Promise.all(Array.from({ length: substrateLine.snapshot().capacity }, (_, i) => substrateLine.acquire({ kind: 'turn', label: `busy-${i}` })));
  };
  const freeLine = () => { busy.forEach((b) => b.release()); busy = []; };

  test('a post wakes the housemate: waiting for the model, then awake with what woke it, then gone', async () => {
    await house.serve([{ reply: 'I read the post.', delayMs: 1500 }]);
    await house.charter();
    await fillLine();
    await house.post(HOUSEMATE, 'Outline the digest when you can.');

    const waiting = await rowFor('waiting');
    expect(waiting.filter((r) => r.neumaId === HOUSEMATE)).toEqual([
      expect.objectContaining({ neumaId: HOUSEMATE, name: 'Quae', seat: 'Scriba', status: 'waiting', task: 'house post' }),
    ]);
    expect(house.provider.turns).toHaveLength(0); // its turn has not begun

    // no office seated: the running wake still shows, its seat read from its own house's record
    const unseated = await houseActivity(WALLET, null);
    expect(unseated).toEqual([expect.objectContaining({ neumaId: HOUSEMATE, name: 'Quae', seat: 'Scriba', status: 'waiting', task: 'house post' })]);
    // another house never reads this one's wake
    expect(await houseActivity(OTHER_HOUSE, null)).toEqual([]);

    freeLine();
    const awake = await rowFor('awake');
    expect(awake.filter((r) => r.neumaId === HOUSEMATE)).toEqual([
      expect.objectContaining({ neumaId: HOUSEMATE, status: 'awake', task: 'house post' }),
    ]);
    expect(awake[0].neumaId).toBe(HOUSEMATE); // awake ranks first

    const [row] = await house.ledgerRows(1);
    expect(row.outcome).toBe('done');
    expect((await houseActivity(WALLET, OPTIO)).some((r) => r.neumaId === HOUSEMATE)).toBe(false);
    expect(await houseActivity(WALLET, null)).toEqual([]);
  }, 60000);

  test('a charge the seat already holds keeps one row: the charge, now awake', async () => {
    await house.serve([{ reply: 'On the charge now.', delayMs: 1500 }]);
    await house.charter();
    const charge = await fileDispatch(OPTIO, makeCharge({
      from: OPTIO, to: HOUSEMATE, title: 'Draft the digest outline', body: 'Done is an outline in the ground.',
      filedAt: new Date().toISOString(), by: WALLET,
    }));

    const rows = await rowFor('awake');
    const mine = rows.filter((r) => r.neumaId === HOUSEMATE);
    expect(mine).toEqual([expect.objectContaining({ status: 'awake', task: charge.title })]);
    await house.ledgerRows(1);
    // asleep again: the charge reads as the drawer has it
    expect((await houseActivity(WALLET, OPTIO)).filter((r) => r.neumaId === HOUSEMATE))
      .toEqual([expect.objectContaining({ name: 'Quae', status: 'dispatched', task: charge.title })]);
  }, 60000);

  test('a lane of another house is never named from its records — it reads as its lane id', async () => {
    const stranger = 'staff-fixture-stranger';
    await neumaWorkspace.create(stranger).catch(() => {});
    await fs.writeFile(path.join(getWorkspacesRoot(), stranger, 'owner.json'), JSON.stringify({ wallet: OTHER_HOUSE, claimedAt: new Date().toISOString() }));
    await neumaWorkspace.writeDNA(stranger, { version: '1.0.0', identity: { name: 'Stranger' }, genesis: '# Essence\nI am Stranger.' });
    await fileDispatch(OPTIO, makeCharge({
      from: OPTIO, to: stranger, title: 'A charge across the wall', body: 'Done is never.', filedAt: new Date().toISOString(), by: WALLET,
    }));
    const rows = await houseActivity(WALLET, OPTIO);
    expect(rows.find((r) => r.neumaId === stranger)?.name).toBe(stranger);
  }, 60000);
});
