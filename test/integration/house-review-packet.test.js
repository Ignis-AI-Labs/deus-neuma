/**
 * THE OPTIO ORGANIZES WHAT WAITS ON THE OPERATOR, FOR REAL (RULE 0: the real
 * asks store, the real Optio briefing, a real wake turn over a loopback
 * OpenAI-wire provider, the real intent sweep on real disk). Design note, 2026-10-16:
 * […].
 *
 * Under proof:
 *  - the seated Optio's briefing lists the house's OPEN asks by id (a closed
 *    one is not listed), and every other lane's stays empty;
 *  - in a wake, the Optio files house/review-packet with no card: the packet
 *    is the house's latest-packet.json, in her order, blocked ones marked,
 *    a tray card raised — and nothing is answered by it;
 *  - only the seated Optio may file it; ask ids must exist and be open.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, call, WALLET, OPTIO, HOUSEMATE, NAMES } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { sweepBatchIntents } from '../../backend/services/intents/intent-sweep.js';
import { fileAsk, closeAsk, readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import { readPacket } from '../../backend/services/house-clock/review-packet.js';
import { cosBriefingSection } from '../../backend/services/staff/cos-briefing.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { KIND } from '../../core/runtime/notification-record.js';

const intentPath = (lane, name) => path.join(neumaWorkspace.pathFor(lane), 'intents', `${name}.json`);
const resultOf = async (file) => JSON.parse(await fs.readFile(file.replace(/\.json$/, '.result.json'), 'utf8'));
const packetIntent = (fields) => JSON.stringify({ type: 'house/review-packet', ...fields });

describe('the Optio\'s review packet', () => {
  let house, price, site, gone;
  beforeEach(async () => {
    house = await createWakeHouse();
    price = await fileAsk(WALLET, { wakeId: 'w-1', seat: HOUSEMATE, kind: 'decision', question: 'Ratify the $250 first-job price?', options: ['Ratify', 'Lower it'], why: 'a decision only you can make' });
    site = await fileAsk(WALLET, { wakeId: 'w-1', seat: HOUSEMATE, kind: 'act', tool: 'intents/social.post', why: 'posting and email go to the operator unless the charter allows them' });
    gone = await fileAsk(WALLET, { wakeId: 'w-0', seat: HOUSEMATE, kind: 'act', tool: 'web/web_search', why: 'old' });
    await closeAsk(WALLET, { id: gone.id, by: WALLET });
  });
  afterEach(async () => { await house.teardown(); });

  // impure — an operator's chat connection for one lane
  const chatFor = (lane) => {
    const connection = createPortalConnection({ ws: { OPEN: 1, readyState: 1, send: () => {} }, walletAddress: WALLET });
    connection.companion = { neumaId: lane, name: lane };
    connection.sessionId = `session-${lane}`;
    connection.toolMode = 'ask';
    return connection;
  };

  test('the Optio\'s briefing lists the open asks by id; a closed one is not there; no other lane reads it', async () => {
    const briefing = await cosBriefingSection({ companion: { neumaId: OPTIO }, walletAddress: WALLET });
    expect(briefing).toContain('### Waiting on your operator');
    expect(briefing).toContain('2 open ask(s) wait on the operator');
    // by the housemate's own name, never its lane id (2b9ff592b)
    expect(briefing).toContain(`[${price.id}] ${NAMES[HOUSEMATE]} · decision: "Ratify the $250 first-job price?"`);
    expect(briefing).toContain(`[${site.id}] ${NAMES[HOUSEMATE]} · act intents/social.post`);
    expect(briefing).not.toContain(gone.id);
    expect(briefing).toContain('house/review-packet {summary, order, blocked}');
    expect(await cosBriefingSection({ companion: { neumaId: HOUSEMATE }, walletAddress: WALLET })).toBe('');
  });

  test('in a wake the Optio files the packet with no card: her order, the blocked one marked, nothing answered', async () => {
    const file = intentPath(OPTIO, 'packet');
    const summary = 'The price comes first: the offer cannot go out without it. Posting the offer is nice to have once it is set.';
    await house.serve([
      { reply: `I will bring these to the operator. ${call('fs/write', { path: file, content: packetIntent({ summary, order: [price.id, site.id], blocked: [price.id] }) })}` },
      { reply: 'The packet is filed for the operator.' },
    ]);
    await house.charter();
    await house.post(OPTIO, 'What waits on the operator?', HOUSEMATE);
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ seat: OPTIO, outcome: 'done', escalations: [] });
    expect((await resultOf(file)).status).toBe('done');
    expect(await readPacket(WALLET)).toMatchObject({ v: 1, by: OPTIO, byName: 'Optio', summary, order: [price.id, site.id], blocked: [price.id] });
    // a packet references asks — it never answers them
    expect((await readAsks(WALLET)).filter((a) => a.status === 'open').map((a) => a.id).sort()).toEqual([price.id, site.id].sort());
    const cards = (await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.houseWake);
    expect(cards.map((c) => c.title)).toContain('Optio\'s review packet: 2 for you, 1 blocked');
  }, 60000);

  test('only the seated Optio files it, and only over open asks of this house', async () => {
    const mateFile = intentPath(HOUSEMATE, 'packet-mate');
    await fs.mkdir(path.dirname(mateFile), { recursive: true });
    await fs.writeFile(mateFile, packetIntent({ summary: 'Mine.', order: [price.id] }));
    await sweepBatchIntents(chatFor(HOUSEMATE), () => {});
    expect(await resultOf(mateFile)).toMatchObject({ status: 'denied', reason: expect.stringMatching(/Optio office's/) });

    const stray = intentPath(OPTIO, 'packet-stray');
    const closed = intentPath(OPTIO, 'packet-closed');
    await fs.mkdir(path.dirname(stray), { recursive: true });
    await fs.writeFile(stray, packetIntent({ summary: 'One.', order: [price.id, '00000000-0000-0000-0000-000000000000'] }));
    await fs.writeFile(closed, packetIntent({ summary: 'Two.', order: [gone.id] }));
    await sweepBatchIntents(chatFor(OPTIO), () => {});
    expect(await resultOf(stray)).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/no such ask in this house/) });
    expect(await resultOf(closed)).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/already answered or closed/) });
    expect(await readPacket(WALLET)).toBeNull();
  }, 30000);
});
