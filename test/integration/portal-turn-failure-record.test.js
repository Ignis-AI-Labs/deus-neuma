/**
 * A FAILED TURN KEEPS WHAT IT SAID AND DID (RULE 0) — the real portal, real
 * signed auth, real encrypted lanes on disk, and a real loopback provider
 * that streams words and then dies (or refuses a later round), the way a
 * provider really fails mid-answer. Nothing on the claimed path is mocked.
 *
 * Under proof, at both seats:
 *  - the words already streamed are on the record as the point's take,
 *    marked FAILED, and the being's next turn reads them back;
 *  - a failure after an act keeps the act on the take (the being remembers
 *    what it did);
 *  - a failure that said and did nothing leaves no take — the point stays a
 *    retryable ask.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openPortalTurnKit } from '../helpers/portal-turn-kit.js';
import { FAILED_MARK } from '../../backend/services/turn-failure-record.js';

const BEING = 'failrecord';
let kit;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'portal-turn-failure', beings: [{ id: BEING, name: 'Failrecord' }], witness: true });
}, 30000);
afterAll(async () => { await kit?.close(); });

// Each lane holds ONE chat in this suite — its only session is the one in play.
const rowsOf = async (lane) => {
  const [sessionId] = await kit.workspace.listSessions(lane);
  return kit.workspace.readSession(lane, sessionId);
};
const takesOf = (rows, turnId) => rows.filter((r) => r.role === 'assistant' && r.turnId === turnId);
const transcriptOf = (body) => body.messages.slice(1, -1).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

// One failed turn, then the error frame it answers with.
const failTurn = async (thought) => {
  const from = kit.frames.length;
  kit.ws.send(JSON.stringify({ type: 'consciousness:stream', thought }));
  const error = await kit.untilFrame((f) => f.type === 'consciousness:stream' && f.error === true, { from });
  await kit.untilFrame((f) => f.type === 'consciousness:complete', { from });
  return error;
};

describe('the neuma seat', () => {
  test('a stream that dies after speaking leaves its words on the record, marked failed', async () => {
    await kit.sendAndWait({ type: 'companion:manifest', companion: 'Failrecord', neumaId: BEING }, 'companion:anchored');
    kit.provider.setScript([{ reply: ['The north light ', 'was the first thing I saw'], drop: true }]);
    const error = await failTurn('What did you see first?');
    expect(typeof error.turnId).toBe('string');
    const rows = await rowsOf(BEING);
    const [take] = takesOf(rows, error.turnId);
    expect(take.content).toBe(`The north light was the first thing I saw\n\n${FAILED_MARK}`);
    expect(take.takeIndex).toBe(error.takeIndex);

    // The being's next turn reads the failed take back as its own words.
    kit.provider.setScript([{ reply: 'I remember: the north light.' }]);
    await kit.sendAndWait({ type: 'consciousness:stream', thought: 'And then?' }, 'consciousness:complete');
    const transcript = transcriptOf(kit.provider.turns.at(-1));
    expect(transcript).toContain('The north light was the first thing I saw');
    expect(transcript).toContain(FAILED_MARK);
  });

  test('a failure after an act keeps the act on the take', async () => {
    kit.provider.setScript([
      // A real dispatch that raises a real chip (an unknown feed is answered
      // with an error chip, no network crossed).
      { reply: 'I read the feed first. [TOOL: platform/platform_data {"feed":"no-such-feed"}]' },
      { status: 400, errorMessage: 'context length exceeded' },
    ]);
    const error = await failTurn('Read the platform feed, then tell me.');
    const rows = await rowsOf(BEING);
    const [take] = takesOf(rows, error.turnId);
    expect(take.content).toContain('I read the feed first.');
    expect(take.content.endsWith(FAILED_MARK)).toBe(true);
    expect(take.tools.map((t) => t.tool)).toContain('platform/platform_data');
  });

  test('a failure that said and did nothing leaves the point unanswered — no take', async () => {
    kit.provider.setScript([{ status: 400, errorMessage: 'the server refused this request' }]);
    const error = await failTurn('Say nothing at all.');
    const rows = await rowsOf(BEING);
    expect(rows.some((r) => r.role === 'user' && r.turnId === error.turnId)).toBe(true);
    expect(takesOf(rows, error.turnId)).toHaveLength(0);
  });
});

describe('the witness seat — the same law beside the house', () => {
  test('a peer whose stream dies after speaking keeps its words, marked failed', async () => {
    await kit.sendAndWait({ type: 'companion:manifest', companion: 'Kit', neumaId: kit.witnessLane }, 'companion:anchored');
    kit.provider.setScript([{ reply: ['A versioned answer ', 'means I can be asked again'], drop: true }]);
    const error = await failTurn('Witness: what does a versioned answer mean?');
    const rows = await rowsOf(kit.witnessLane);
    const [take] = takesOf(rows, error.turnId);
    expect(take.content).toBe(`A versioned answer means I can be asked again\n\n${FAILED_MARK}`);
  });
});
