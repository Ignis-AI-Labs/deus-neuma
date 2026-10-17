/**
 * A RESUME OF THE CHAT ALREADY BOUND NEVER CUTS THE TURN IN FLIGHT (RULE 0) —
 * Design note, 2026-10-14, after a harness message sent right after a server switch came
 * back […]: the desk's own late link-up
 * bind named the very session the socket was on, and the portal settled (cut)
 * the running turn to re-bind to the same place.
 *
 * Real signed-wallet socket pair, real encrypted lane on disk, the real portal
 * dispatcher (handlePortalMessage → portalResume). The running turn is the
 * connection's own turn state: an AbortController and the promise the
 * navigation chain waits on.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace from '../../core/workspace/neuma-workspace.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';

const SESSION = 'session-harness-origin';
let kit; let priorKey;

// a turn in flight on this connection, settling only when it is aborted (or the test ends)
const startTurn = (connection) => {
  const controller = new AbortController();
  connection.activeTurn = controller;
  connection.turnPromise = new Promise((resolve) => controller.signal.addEventListener('abort', resolve, { once: true }));
  return controller;
};

beforeEach(async () => {
  priorKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'portal-resume-same-session-key-long-enough';
  kit = await createHarnessTurnKit('neuma-resume-fixture');
  await workspace.appendMessage(kit.laneId, SESSION, { role: 'user', content: 'An earlier question' });
  await workspace.appendMessage(kit.laneId, SESSION, { role: 'assistant', content: 'An earlier answer' });
  kit.connection.neumaId = kit.laneId;
});

afterEach(async () => {
  kit.connection.activeTurn?.abort();
  await kit.close();
  if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = priorKey;
});

describe('portal:resume while a turn runs', () => {
  test('naming the session the socket is already on: the turn and its held words stand', async () => {
    const turn = startTurn(kit.connection);
    kit.connection.pendingThoughts = [{ thought: 'a held word' }];
    kit.client.send(JSON.stringify({ type: 'portal:resume', neumaId: kit.laneId, companionName: 'HarnessFixture', sessionId: SESSION }));
    const resumed = await untilHarness(() => kit.frames.find((f) => f.type === 'portal:resumed'));
    expect(resumed).toMatchObject({ neumaId: kit.laneId, sessionId: SESSION });
    expect(turn.signal.aborted).toBe(false);
    expect(kit.connection.pendingThoughts).toEqual([{ thought: 'a held word' }]);
    expect(kit.connection.sessionId).toBe(SESSION);
  });

  test('naming ANOTHER session still settles the running turn first — a real navigation', async () => {
    const turn = startTurn(kit.connection);
    await workspace.appendMessage(kit.laneId, 'session-elsewhere', { role: 'user', content: 'Another chat' });
    kit.client.send(JSON.stringify({ type: 'portal:resume', neumaId: kit.laneId, companionName: 'HarnessFixture', sessionId: 'session-elsewhere' }));
    await untilHarness(() => kit.frames.find((f) => f.type === 'portal:resumed' && f.sessionId === 'session-elsewhere'));
    expect(turn.signal.aborted).toBe(true);
    expect(kit.connection.sessionId).toBe('session-elsewhere');
  });
});
