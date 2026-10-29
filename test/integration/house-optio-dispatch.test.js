/**
 * THE OPTIO ASSIGNS WITH NO CARD (RULE 0: the real intent sweep, the real
 * approval broker, real disk, real house clock, a real loopback provider) —
 * Design note, 2026-10-16: […].
 *
 * Under proof:
 *  - the seated Optio's board/add settles with no card, while a housemate's
 *    still raises the operator's card (allowed for the seated Optio ONLY);
 *  - in a wake, the Optio's staff/dispatch settles with no card, nothing is
 *    filed for the operator, and the charge wakes the charged seat.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, call, userText, until, WALLET, OPTIO, HOUSEMATE } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { sweepBatchIntents } from '../../backend/services/intents/intent-sweep.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { listDispatches } from '../../backend/services/staff/dispatch-store.js';
import { readAsks } from '../../backend/services/house-clock/wake-ledger.js';

const intentPath = (lane, name) => path.join(neumaWorkspace.pathFor(lane), 'intents', `${name}.json`);
const resultOf = async (file) => JSON.parse(await fs.readFile(file.replace(/\.json$/, '.result.json'), 'utf8'));

describe('the seated Optio assigns with no card', () => {
  let house;
  beforeEach(async () => { house = await createWakeHouse(); });
  afterEach(async () => { await house.teardown(); });

  // impure — an operator's chat connection for one lane, its frames captured
  const chatFor = (lane) => {
    const frames = [];
    const connection = createPortalConnection({
      ws: { OPEN: 1, readyState: 1, send: (s) => frames.push(JSON.parse(s)) },
      walletAddress: WALLET,
    });
    connection.companion = { neumaId: lane, name: lane };
    connection.sessionId = `session-${lane}`;
    connection.toolMode = 'ask';
    return { connection, frames };
  };

  test('board/add: the seated Optio files it with no card; a housemate still asks the operator', async () => {
    const optioFile = intentPath(OPTIO, 'board-optio');
    await fs.mkdir(path.dirname(optioFile), { recursive: true });
    await fs.writeFile(optioFile, JSON.stringify({ type: 'board/add', title: 'Research the digest gap' }));
    const optio = chatFor(OPTIO);
    await sweepBatchIntents(optio.connection, () => {});
    expect(optio.frames.filter((f) => f.type === 'tool:approval_request')).toEqual([]);
    expect((await resultOf(optioFile)).status).toBe('done');

    const mateFile = intentPath(HOUSEMATE, 'board-mate');
    await fs.mkdir(path.dirname(mateFile), { recursive: true });
    await fs.writeFile(mateFile, JSON.stringify({ type: 'board/add', title: 'Draft the digest' }));
    const mate = chatFor(HOUSEMATE);
    const swept = sweepBatchIntents(mate.connection, () => {});
    const card = await until(() => mate.frames.find((f) => f.type === 'tool:approval_request'));
    expect(card.tool).toBe('intents/board.add');
    resolveToolApproval(mate.connection, card.id, 'deny');
    await swept;
    expect((await resultOf(mateFile)).status).toBe('denied');
  }, 30000);

  test('in a wake, the Optio\'s staff/dispatch needs no card and wakes the charged seat', async () => {
    const charge = intentPath(OPTIO, 'charge-quae');
    await house.serve([
      // the Optio's wake: it assigns the work
      { reply: `I will charge Quae with the research. ${call('fs/write', { path: charge, content: JSON.stringify({ type: 'staff/dispatch', to: HOUSEMATE, title: 'Research the digest gap', body: 'Done looks like three cited sources.' }) })}` },
      { reply: 'Quae holds the research charge now.' },
      // the charged seat's wake
      { reply: 'I took the charge and will start the research.' },
    ]);
    await house.charter();
    await house.post(OPTIO, 'Please get the digest research moving.', HOUSEMATE);
    const rows = await house.ledgerRows(2);
    const optioRow = rows.find((r) => r.seat === OPTIO);
    expect(optioRow).toMatchObject({ outcome: 'done', escalations: [] });
    expect((await resultOf(charge)).status).toBe('done');
    const [filed] = await listDispatches(OPTIO);
    expect(filed).toMatchObject({ to: HOUSEMATE, title: 'Research the digest gap' });
    expect(await readAsks(WALLET)).toEqual([]);

    // the charge woke its seat (with its delivery post, in one wake or two), and the seat read it as a charge
    const charged = await until(async () => (await house.ledgerRows(2))
      .find((r) => r.seat === HOUSEMATE && r.items.some((i) => i.reason === 'dispatch' && i.ref === filed.id)));
    expect(charged.outcome).toBe('done');
    expect(house.provider.turns.some((t) => userText(t).includes(`charge [${filed.id}]`))).toBe(true);
  }, 60000);
});
