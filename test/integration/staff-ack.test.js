/**
 * STAFF ACK (integration, RULE 0: the real intent objects on the real drawer
 * and house ground, no mock) — the audit's G3: a seat answers a dispatch
 * (received / working / done / blocked) and the evidence moves the record.
 * Only the charge's holder acks it; `withdrawn` stays the office's word; a
 * closed charge does not move again.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { listDispatches, readDispatch } from '../../backend/services/staff/dispatch-store.js';
import { staffDispatchIntent, staffAckIntent, staffDispatchUpdateIntent } from '../../backend/services/intents/staff-acts.js';
import { WALLET, OPTIO, HOUSEMATE, BYSTANDER, createStaffOfficeFixture } from '../helpers/staff-office-fixture.js';

let fx;
const connectionFor = (laneId) => ({ companion: { neumaId: laneId }, walletAddress: WALLET });

beforeEach(async () => {
  fx = await createStaffOfficeFixture();
  // Every case starts from a real filed charge.
  const verdict = await staffDispatchIntent.validate(
    { to: HOUSEMATE, title: 'Draft the ledger report', body: 'Done looks like: the report filed.' },
    { connection: connectionFor(OPTIO) },
  );
  await staffDispatchIntent.execute(verdict.value, { connection: connectionFor(OPTIO) });
});

afterEach(async () => {
  await fx?.teardown();
});

const charge = async () => (await listDispatches(OPTIO))[0];

describe('staff/ack — the seat answers a dispatch', () => {
  test('the holder walks received → working → done', async () => {
    const holder = connectionFor(HOUSEMATE);
    const c = await charge();
    for (const status of ['received', 'working', 'done']) {
      const verdict = await staffAckIntent.validate({ id: c.id, status }, { connection: holder });
      expect(verdict.ok).toBe(true);
      const outcome = await staffAckIntent.execute(verdict.value, { connection: holder });
      expect(outcome.ok).toBe(true);
    }
    const record = await readDispatch(OPTIO, c.id);
    expect(record.status).toBe('done');
    expect(record.ackBy).toBe(HOUSEMATE);
    expect(record.ackAt).toBeTruthy();
  });

  test('THE TRAIL: the operator\'s store holds the dispatch card and the ack card', async () => {
    // The dispatch lands its card the moment it is filed...
    const connection = connectionFor(OPTIO);
    const verdict = await staffDispatchIntent.validate(
      { to: HOUSEMATE, title: 'Draft the ledger report', body: 'Done looks like: the report filed.' },
      { connection },
    );
    await staffDispatchIntent.execute(verdict.value, { connection });
    // ...and the ack lands its card the moment the seat answers.
    const holder = connectionFor(HOUSEMATE);
    const ack = await staffAckIntent.validate(
      { id: (await listDispatches(OPTIO))[0].id, status: 'working' },
      { connection: holder },
    );
    await staffAckIntent.execute(ack.value, { connection: holder });

    // The cards land asynchronously (fire-and-forget by law) — poll the real
    // store for them instead of racing the writer.
    let records = [];
    for (let i = 0; i < 40; i += 1) {
      records = (await readNotifications(WALLET, { limit: 50 })).records;
      if (records.some((n) => n.kind === 'house_ack')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const dispatchCard = records.find((n) => n.kind === 'house_dispatch');
    expect(dispatchCard).toBeTruthy();
    expect(dispatchCard.title).toContain('Dispatched to');
    expect(dispatchCard.title).toContain(HOUSEMATE);
    const ackCard = records.find((n) => n.kind === 'house_ack');
    expect(ackCard).toBeTruthy();
    expect(ackCard.title).toContain('working');
  });

  test('a bystander seat cannot ack someone else\'s charge', async () => {
    const c = await charge();
    const verdict = await staffAckIntent.validate(
      { id: c.id, status: 'received' },
      { connection: connectionFor(BYSTANDER) },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe('denied');
    expect(verdict.reason).toContain('only its holder acks it');
  });

  test('withdrawn is not a seat ack — the office\'s word only', async () => {
    const c = await charge();
    const verdict = await staffAckIntent.validate(
      { id: c.id, status: 'withdrawn' },
      { connection: connectionFor(HOUSEMATE) },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('not an ack');
  });

  test('an unknown charge id is invalid, honestly', async () => {
    const verdict = await staffAckIntent.validate(
      { id: 'nope', status: 'received' },
      { connection: connectionFor(HOUSEMATE) },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('not in the office\'s drawer');
  });

  test('a closed charge does not move again — by seat or by office', async () => {
    const holder = connectionFor(HOUSEMATE);
    const c = await charge();
    const done = await staffAckIntent.validate({ id: c.id, status: 'done' }, { connection: holder });
    expect(done.ok).toBe(true);
    await staffAckIntent.execute(done.value, { connection: holder });

    // The seat's re-ack and the office's own mover both refuse at validate.
    const seatAgain = await staffAckIntent.validate(
      { id: c.id, status: 'working' },
      { connection: holder },
    );
    expect(seatAgain.ok).toBe(false);
    expect(seatAgain.reason).toContain('already done');

    const office = await staffDispatchUpdateIntent.validate(
      { id: c.id, status: 'blocked' },
      { connection: connectionFor(OPTIO) },
    );
    expect(office.ok).toBe(false);
    expect(office.reason).toContain('already done');
  });
});
