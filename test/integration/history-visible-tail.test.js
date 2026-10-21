/** Actual encrypted session and signed resume socket; no inference. */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { portalResume } from '../../backend/routes/portal-bind-handlers.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { RECENT_ROWS } from '../../core/runtime/memory-section.js';

let kit;
beforeEach(async () => { kit = await createHarnessTurnKit('history-tail-fixture'); });
afterEach(async () => { await kit?.close(); });

const records = () => [
  { role: 'user', content: 'question', turnId: 'tail-turn' },
  { role: 'assistant', content: 'chosen answer', turnId: 'tail-turn', takeIndex: 1 },
  { role: 'assistant', content: 'other answer', turnId: 'tail-turn', takeIndex: 2 },
  ...Array.from({ length: RECENT_ROWS + 10 }, () => ({ role: 'system', branchView: { 'tail-turn': 1 } })),
];

test('display counts visible records after folding takes and discarding bookkeeping', () => {
  const shown = toDisplayMessages(records(), 2);
  expect(shown.map((row) => row.content)).toEqual(['question', 'chosen answer']);
  expect(shown[1]).toMatchObject({ takeIndex: 1, takeCount: 2 });
});

test('signed resume carries the selected question and answer despite trailing view records', async () => {
  const sessionId = kit.connection.sessionId;
  for (const row of records()) await workspace.appendMessage(kit.laneId, sessionId, row);
  const loaded = await workspace.readSession(kit.laneId, sessionId);
  expect(loaded).toHaveLength(RECENT_ROWS + 13);
  expect(await portalResume(kit.connection, { neumaId: kit.laneId, sessionId }, { connectionId: 'tail-proof' })).toBe(true);
  const frame = await untilHarness(() => kit.frames.find((event) => event.type === 'portal:resumed'));
  expect(frame.neumaId).toBe(kit.laneId);
  expect(frame.recentMessages.map((row) => row.content)).toEqual(['question', 'chosen answer']);
  expect(frame.recentMessages.some((row) => row.branchView)).toBe(false);
  expect((await workspace.readSession(kit.laneId, sessionId))).toEqual(loaded);
});

test('signed resume keeps the session summary when a take switch rode it through a real compaction', async () => {
  const sessionId = kit.connection.sessionId;
  const rows = [
    { role: 'user', content: 'plan the garden', turnId: 'switched' },
    { role: 'assistant', content: 'take one', turnId: 'switched', takeIndex: 1 },
    { role: 'assistant', content: 'take two', turnId: 'switched', takeIndex: 2 },
    { role: 'system', branchView: { switched: 1 } },
    ...Array.from({ length: 40 }, (_, i) => (i % 2
      ? { role: 'assistant', content: `answer ${i}`, turnId: `f${i >> 1}`, takeIndex: 1 }
      : { role: 'user', content: `ask ${i}`, turnId: `f${i >> 1}` })),
  ];
  for (const row of rows) await workspace.appendMessage(kit.laneId, sessionId, row);
  expect(await workspace.compactSession(kit.laneId, sessionId, { threshold: 30, keepRecent: 20 })).toBe(true);
  expect(await portalResume(kit.connection, { neumaId: kit.laneId, sessionId }, { connectionId: 'summary-proof' })).toBe(true);
  const frame = await untilHarness(() => kit.frames.find((event) => event.type === 'portal:resumed'));
  expect(frame.recentMessages[0].content).toMatch(/^\[SESSION SUMMARY\]/);
  expect(frame.recentMessages[0].branchView).toEqual({ switched: 1 });
});
