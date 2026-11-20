/**
 * EVERYTHING WAITS BEHIND A COMPACTION (RULE 0) — Design note, 2026-11-19, a message sent while the screen said […]: […]
 * Over the real portal: signed auth, the real WebSocket and handlers, the real held-words queue, a real chat on disk
 * long enough to compact, and a real loopback provider whose answer to the summing-up takes its time (a compaction
 * genuinely running). A word said meanwhile is HELD — told so, even marked NOW — and runs the moment the compaction
 * is done, never against the conversation while it is being rewritten.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openPortalTurnKit, lastUserText } from '../helpers/portal-turn-kit.js';

const A = 'compactholdbeing';
let kit;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'portal-compact-holds', beings: [{ id: A, name: 'Alder' }] });
}, 30000);
afterAll(async () => { await kit?.close(); });

const WORDS = ' The keeper logs the weather, trims the wick and writes the passing ships down.'.repeat(40);
const send = (frame) => kit.ws.send(JSON.stringify(frame));

describe('a word said while the conversation is being summed up', () => {
  test('is held, told so, and runs once the compaction is done — after it, never during it', async () => {
    await kit.sendAndWait({ type: 'companion:manifest', companion: 'Alder', neumaId: A }, 'companion:anchored');
    // One real turn opens the chat on disk; then it is made long enough to be worth summing up.
    kit.provider.setScript([{ reply: 'Opened.' }]);
    await kit.sendAndWait({ type: 'consciousness:stream', thought: 'Open the chat.' }, 'consciousness:complete');
    const [sessionId] = await kit.workspace.listSessions(A);
    for (let i = 0; i < 20; i += 1) {
      await kit.workspace.appendMessage(A, sessionId, { role: 'user', content: `question ${i} about the lighthouse${WORDS}` });
      await kit.workspace.appendMessage(A, sessionId, { role: 'assistant', content: `answer ${i}: the light keeps its watch${WORDS}` });
    }
    const turnsBefore = kit.provider.turns.length;
    // The summing-up takes its time; the held word's own turn answers quickly.
    kit.provider.setScript([{ reply: 'SUMMARY: the lighthouse keeper and the ships. TORCH: keep the light.', delayMs: 2500 }, { reply: 'Held word heard.' }]);
    const from = kit.frames.length;
    send({ type: 'session:compact' });
    await kit.untilFrame((f) => f.type === 'session:compact' && f.state === 'running', { from });

    // Said mid-compaction — even marked NOW — it is held, and the desk is told why.
    send({ type: 'consciousness:stream', thought: 'H1 said while compacting', urgency: 'now' });
    const queued = await kit.untilFrame((f) => f.type === 'consciousness:queued', { from });
    expect(queued.message).toBe('Held — it goes as soon as the compaction finishes.');
    const done = await kit.untilFrame((f) => f.type === 'session:compact' && f.state === 'done', { from });
    expect(done.state).toBe('done');
    await kit.untilFrame((f) => f.type === 'consciousness:complete', { from });

    // The held word's turn ran once, after the compaction — the only chat turn since it began.
    const asked = kit.provider.turns.slice(turnsBefore).map((body) => lastUserText(body).split(/<\/harness-context:[^>]+>\n\n/).pop());
    expect(asked).toEqual(['H1 said while compacting']);
    const order = kit.frames.slice(from).map((f) => (f.type === 'session:compact' ? `compact:${f.state}` : f.type)).filter((t) => ['compact:running', 'consciousness:queued', 'compact:done', 'consciousness:complete'].includes(t));
    expect(order).toEqual(['compact:running', 'consciousness:queued', 'compact:done', 'consciousness:complete']);
    // The held word landed in the compacted chat, after the summary.
    const rows = await kit.workspace.readSession(A, sessionId);
    const summaryAt = rows.findIndex((r) => r.compacted);
    const heldAt = rows.findIndex((r) => r.role === 'user' && String(r.content).includes('H1 said while compacting'));
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    expect(heldAt).toBeGreaterThan(summaryAt);
  }, 60000);
});
