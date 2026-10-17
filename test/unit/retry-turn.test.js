/**
 * RETRY-ANYWHERE — resolveRetryTurn against the REAL record (RULE 0): the
 * session file is written through the real appendTurnPoint/appendTake into a
 * real temp workspace on real encrypted disk, then resolved through the real
 * exported resolver — no stub anywhere in the path being claimed.
 *
 * Tables pinned here:
 *   - a retry descriptor carrying a revised thought resolves to the REVISED
 *     words and marks the resolution `revised: true`
 *   - no thought (or a blank one) falls back to the recorded asking, unmarked
 *   - the take identity is the point's turnId with takeIndex = takes + 1
 *   - the recorded user row is never rewritten by a revised retry (append-only)
 *   - every pre-existing refusal shape still answers { ok: false, reason }
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { resolveRetryTurn } from '../../backend/services/portal-turn-input.js';
import { foldBranchView, takeCounts } from '../../core/workspace/branch-view.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const KEY = 'retry-turn-test-key-long-enough';
const NEUMA = 'retryecho';
const SESSION = 'sess-retry';

let origRoot;

beforeAll(async () => {
  process.env.DNA_ENCRYPTION_KEY = KEY;
  origRoot = getWorkspacesRoot();
  setWorkspacesRoot(await createTempDir('retry-turn-ws'));
  await workspace.create(NEUMA);
});

afterAll(() => {
  vi.restoreAllMocks();
  setWorkspacesRoot(origRoot);
  delete process.env.DNA_ENCRYPTION_KEY;
});

describe('resolveRetryTurn — the EDIT-FORK against the real record', () => {
  test('a revised thought resolves to the new words, marked revised, take = takes + 1', async () => {
    const point = await workspace.appendTurnPoint(NEUMA, SESSION, { role: 'user', content: 'first asking' });
    await workspace.appendTake(NEUMA, SESSION, point.turnId, 1, { role: 'assistant', content: 'first answer' });

    const resolved = await resolveRetryTurn(NEUMA, SESSION, { turnId: point.turnId, thought: 'revised asking' });
    expect(resolved.ok).toBe(true);
    expect(resolved.thought).toBe('revised asking');
    expect(resolved.revised).toBe(true);
    expect(resolved.take).toEqual({ turnId: point.turnId, takeIndex: 2 });
  });

  test('the revised take persists with its ask; the recorded asking never moves', async () => {
    const records0 = await workspace.readSession(NEUMA, SESSION);
    const turnId = records0.find((r) => r.role === 'user').turnId;
    const resolved = await resolveRetryTurn(NEUMA, SESSION, { turnId, thought: 'revised asking' });
    // The caller's half of the contract: the take row carries the revised ask.
    await workspace.appendTake(NEUMA, SESSION, resolved.take.turnId, resolved.take.takeIndex,
      { role: 'assistant', content: 'second answer', ask: resolved.thought });

    const records = await workspace.readSession(NEUMA, SESSION);
    expect(records.filter((r) => r.role === 'user')).toHaveLength(1); // append-only: one asking
    expect(records.find((r) => r.role === 'user').content).toBe('first asking');
    const take2 = records.find((r) => r.role === 'assistant' && r.takeIndex === 2);
    expect(take2.ask).toBe('revised asking');
    expect(takeCounts(records)).toEqual({ [turnId]: 2 });
    // The fold of the same record shows the viewed take's ask (latest by default)…
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['revised asking', 'second answer']);
    // …and viewing take 1 shows the FIRST asking again.
    expect(foldBranchView(records, { [turnId]: 1 }).map((r) => r.content)).toEqual(['first asking', 'first answer']);
  });

  test('no thought falls back to the recorded asking, unmarked', async () => {
    const records = await workspace.readSession(NEUMA, SESSION);
    const turnId = records.find((r) => r.role === 'user').turnId;
    const resolved = await resolveRetryTurn(NEUMA, SESSION, { turnId });
    expect(resolved.ok).toBe(true);
    expect(resolved.thought).toBe('first asking');
    expect(resolved.revised).toBeUndefined();
    expect(resolved.take).toEqual({ turnId, takeIndex: 3 }); // two takes on disk by now
  });

  test('a blank thought is treated as absent — trimmed, never an empty asking', async () => {
    const records = await workspace.readSession(NEUMA, SESSION);
    const turnId = records.find((r) => r.role === 'user').turnId;
    const resolved = await resolveRetryTurn(NEUMA, SESSION, { turnId, thought: '   ' });
    expect(resolved.ok).toBe(true);
    expect(resolved.thought).toBe('first asking');
    expect(resolved.revised).toBeUndefined();
  });

  test('the recorded attachments ride the retry even when the words were revised', async () => {
    const point = await workspace.appendTurnPoint(NEUMA, SESSION, {
      role: 'user', content: 'look at this', images: ['data:image/png;base64,AAAA'],
    });
    const resolved = await resolveRetryTurn(NEUMA, SESSION, { turnId: point.turnId, thought: 'look again, closer' });
    expect(resolved.ok).toBe(true);
    expect(resolved.thought).toBe('look again, closer');
    expect(resolved.images).toEqual(['data:image/png;base64,AAAA']);
  });

  test('every refusal shape still answers out loud, never throws', async () => {
    expect(await resolveRetryTurn(NEUMA, SESSION, { turnId: 'no-such-point' }))
      .toMatchObject({ ok: false });
    expect(await resolveRetryTurn(NEUMA, SESSION, null)).toMatchObject({ ok: false });
    expect(await resolveRetryTurn(null, SESSION, { turnId: 'x' })).toMatchObject({ ok: false });
    expect(await resolveRetryTurn(NEUMA, 'no-such-session', { turnId: 'x' })).toMatchObject({ ok: false });
  });

  test('a legacy anchor (content+timestamp) still resolves, revised or not', async () => {
    const legacy = await workspace.appendMessage(NEUMA, SESSION, {
      role: 'user', content: 'old words', timestamp: '2026-07-27T00:00:00.000Z',
    });
    const resolved = await resolveRetryTurn(NEUMA, SESSION,
      { content: 'old words', timestamp: legacy.timestamp, thought: 'new words for the old point' });
    expect(resolved.ok).toBe(true);
    expect(resolved.thought).toBe('new words for the old point');
    expect(resolved.revised).toBe(true);
    expect(resolved.take.takeIndex).toBe(1); // the forward-minted point's first take
  });
});
