/**
 * THE DRAIN EPOCH (RULE 0) — held words over the real portal: signed auth,
 * the real portal WebSocket and handlers, the real held-words queue, the real
 * substrate line, real encrypted lanes, and a real loopback provider whose
 * first answer takes its time (a turn genuinely in flight). Nothing on the
 * claimed path is mocked.
 *
 * Under proof:
 *  - a word held for being A never runs after the operator switches to B;
 *  - a word held for one chat never opens the next one (new session);
 *  - an urgent "now" takes the floor ahead of the held words, which follow it
 *    one at a time — never two turns streaming into one chat at once.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openPortalTurnKit, lastUserText } from '../helpers/portal-turn-kit.js';

const A = 'drainbeinga';
const B = 'drainbeingb';
let kit;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'portal-drain-epoch', beings: [{ id: A, name: 'Alder' }, { id: B, name: 'Birch' }] });
}, 30000);
afterAll(async () => { await kit?.close(); });

// What each request asked, past the local wire's harness block.
const asked = () => kit.provider.turns.map((body) => lastUserText(body).split('</harness-context>\n\n').pop());
const send = (frame) => kit.ws.send(JSON.stringify({ type: 'consciousness:stream', ...frame }));
// A turn in flight: the provider holds its answer back, and the request has arrived.
const turnInFlight = async (thought) => {
  kit.provider.setScript([{ reply: 'A slow answer.', delayMs: 4000 }, { reply: 'A quick answer.' }]);
  send({ thought });
  await kit.until(() => kit.provider.turns.length === 1);
};
const held = async (thought) => {
  const from = kit.frames.length;
  send({ thought });
  await kit.untilFrame((f) => f.type === 'consciousness:queued', { from });
};
const settle = () => new Promise((r) => { setTimeout(r, 600); });

describe('held words belong to the chat and being they were said to', () => {
  test('a word held for A never runs once the operator switches to B', async () => {
    await kit.sendAndWait({ type: 'companion:manifest', companion: 'Alder', neumaId: A }, 'companion:anchored');
    await turnInFlight('Alder, a long question first.');
    await held('H1 held for Alder');
    await kit.sendAndWait({ type: 'companion:manifest', companion: 'Birch', neumaId: B }, 'companion:anchored');
    await settle();
    expect(asked().some((t) => t.includes('H1 held for Alder'))).toBe(false);
    const sessions = await kit.workspace.listSessions(B);
    for (const id of sessions) {
      const rows = await kit.workspace.readSession(B, id);
      expect(rows.some((r) => String(r.content).includes('H1 held for Alder'))).toBe(false);
    }
  });

  test('a word held for one chat never opens the next one', async () => {
    await turnInFlight('Birch, a long question in this chat.');
    await held('H2 held for the old chat');
    await kit.sendAndWait({ type: 'portal:new-session' }, 'portal:session-reset');
    await settle();
    expect(asked().some((t) => t.includes('H2 held for the old chat'))).toBe(false);
    kit.provider.setScript([{ reply: 'Fresh.' }]);
    await kit.sendAndWait({ type: 'consciousness:stream', thought: 'The first words of the new chat.' }, 'consciousness:complete');
    expect(asked()).toEqual(['The first words of the new chat.']);
  });
});

describe('an urgent "now" takes the floor', () => {
  test('it runs before the held words, and they follow one at a time', async () => {
    await turnInFlight('Birch, another long question.');
    await held('H3 held behind the turn');
    kit.provider.setScript([{ reply: 'Urgent heard.', delayMs: 300 }, { reply: 'Held word heard.', delayMs: 300 }]);
    const from = kit.frames.length;
    send({ thought: 'U-now interjects', urgency: 'now' });
    // The moment the second request lands, the first must already be answered:
    // the cut turn's complete plus the interjection's.
    const completesAtSecond = await kit.until(() => (kit.provider.turns.length >= 2
      ? kit.frames.slice(from).filter((f) => f.type === 'consciousness:complete').length + 1 : 0), 15000) - 1;
    await settle();
    expect(asked()).toEqual(['U-now interjects', 'H3 held behind the turn']);
    expect(completesAtSecond).toBeGreaterThanOrEqual(2);
  });
});
