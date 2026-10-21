/**
 * THE TAIL LEAVES ROOM FOR THE TURN (RULE 0) — the real portal, real signed
 * auth, a real encrypted lane whose chat already holds long rows, and a real
 * loopback provider that names a 32K window and records the request. Nothing
 * is mocked.
 *
 * Under proof: the transcript tail is sized against everything else the
 * request carries — the kept sections, the current turn and the tool
 * schemas — so the whole request, as the platform itself counts it, leaves
 * the completion its floor.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { openPortalTurnKit } from '../helpers/portal-turn-kit.js';
import { estimateTokens, MIN_COMPLETION_TOKENS } from '../../backend/services/context-budget.js';

const BEING = 'tailbudget';
const WINDOW = 32768;
const SESSION = 'session-tail-budget';
let kit;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'portal-tail-budget', beings: [{ id: BEING, name: 'Tail' }], contextLength: WINDOW });
  for (let i = 0; i < 20; i += 1) {
    await kit.workspace.appendMessage(BEING, SESSION, { role: i % 2 ? 'assistant' : 'user', content: `row ${i} `.padEnd(3000, String(i % 10)) });
  }
}, 30000);
afterAll(async () => { await kit?.close(); });

test('a long ask over a long chat: the request still leaves the completion its floor', async () => {
  await kit.sendAndWait({ type: 'portal:resume', neumaId: BEING, companionName: 'Tail', sessionId: SESSION }, 'portal:resumed');
  kit.provider.setScript([{ reply: 'Read it all.' }]);
  const ask = `Please read this whole passage closely. ${'The harbor lamps burn through the fog. '.repeat(1000)}`;
  await kit.sendAndWait({ type: 'consciousness:stream', thought: ask }, 'consciousness:complete');
  const body = kit.provider.turns.at(-1);
  const sent = body.messages.reduce((n, m) => n + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0)
    + estimateTokens(JSON.stringify(body.tools || []));
  expect(sent).toBeLessThanOrEqual(WINDOW - MIN_COMPLETION_TOKENS);
  // The tail still rides — trimmed to fit, never dropped whole.
  expect(body.messages.some((m) => typeof m.content === 'string' && m.content.startsWith('row 19'))).toBe(true);
});
