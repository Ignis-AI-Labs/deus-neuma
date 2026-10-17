/**
 * Notification coalescing — the burst-collapse that keeps the bell readable
 * (core/runtime/notification-coalesce.js).
 *
 * Pure module, and deliberately clockless: every test passes `nowMs` in, so the
 * window-boundary cases are ordinary function calls with ordinary expected
 * values. Nothing is faked, because there is nothing to fake (RULE 0).
 */

import { describe, expect, test } from 'vitest';
import {
  COALESCE_WINDOW_MS, initialCoalesceState, coalesceKey, coalesce, pruneCoalesceState,
} from '../../core/runtime/notification-coalesce.js';
import { KIND, STANDING, makeRecord } from '../../core/runtime/notification-record.js';

const T0 = 1_754_400_000_000;

const turn = (id, laneId, kind = KIND.turnDone) => makeRecord({
  id,
  ts: T0,
  kind,
  standing: STANDING.neuma,
  title: 'finished a turn',
  actor: { id: laneId, name: 'Fenna' },
  ref: { sessionId: 's-1' },
});

const system = (id, kind) => makeRecord({
  id, ts: T0, kind, standing: STANDING.system, title: 'machine state',
});

describe('coalesceKey', () => {
  test('groups by kind and lane, not by session', () => {
    const a = makeRecord({
      id: 'a', ts: T0, kind: KIND.turnDone, standing: STANDING.neuma,
      title: 't', actor: { id: 'lane-1', name: 'Fenna' }, ref: { sessionId: 's-1' },
    });
    const b = makeRecord({
      id: 'b', ts: T0, kind: KIND.turnDone, standing: STANDING.neuma,
      title: 't', actor: { id: 'lane-1', name: 'Fenna' }, ref: { sessionId: 's-2' },
    });
    expect(coalesceKey(a)).toBe(coalesceKey(b));
  });

  test('two different beings are two different groups', () => {
    expect(coalesceKey(turn('a', 'lane-1'))).not.toBe(coalesceKey(turn('b', 'lane-2')));
  });

  test('the same being doing two different things is two groups', () => {
    expect(coalesceKey(turn('a', 'lane-1', KIND.turnDone)))
      .not.toBe(coalesceKey(turn('b', 'lane-1', KIND.renderDone)));
  });

  test('a record with no lane becomes its own group, so it never collapses', () => {
    const bare = system('sys-1', KIND.storageWarning);
    expect(coalesceKey(bare)).toContain('sys-1');
  });
});

describe('coalesce', () => {
  test('the first record of a group raises a new card', () => {
    const out = coalesce(initialCoalesceState(), turn('a', 'lane-1'), T0);
    expect(out.action).toBe('raise');
    expect(out.count).toBe(1);
    expect(out.supersedes).toBeNull();
  });

  test('a burst from one lane collapses into one card carrying the count', () => {
    let state = initialCoalesceState();
    const actions = [];
    for (let i = 0; i < 8; i += 1) {
      const out = coalesce(state, turn(`t${i}`, 'lane-1'), T0 + i * 100);
      state = out.state;
      actions.push(out);
    }
    expect(actions[0].action).toBe('raise');
    expect(actions.slice(1).every((a) => a.action === 'replace')).toBe(true);
    expect(actions.at(-1).count).toBe(8);
  });

  test('a replace names the card that OPENED the group, not the previous record', () => {
    let state = initialCoalesceState();
    const first = coalesce(state, turn('opener', 'lane-1'), T0);
    state = first.state;
    const second = coalesce(state, turn('second', 'lane-1'), T0 + 100);
    state = second.state;
    const third = coalesce(state, turn('third', 'lane-1'), T0 + 200);
    expect(second.supersedes).toBe('opener');
    expect(third.supersedes).toBe('opener');
  });

  test('two beings finishing together stay two cards', () => {
    let state = initialCoalesceState();
    const a = coalesce(state, turn('a', 'lane-1'), T0);
    state = a.state;
    const b = coalesce(state, turn('b', 'lane-2'), T0 + 10);
    expect(a.action).toBe('raise');
    expect(b.action).toBe('raise');
  });

  test('past the window the same lane raises a fresh card and the count restarts', () => {
    let state = initialCoalesceState();
    const first = coalesce(state, turn('a', 'lane-1'), T0);
    state = first.state;
    const later = coalesce(state, turn('b', 'lane-1'), T0 + COALESCE_WINDOW_MS + 1);
    expect(later.action).toBe('raise');
    expect(later.count).toBe(1);
    expect(later.supersedes).toBeNull();
  });

  test('exactly at the window boundary is outside it — the window is half-open', () => {
    let state = initialCoalesceState();
    state = coalesce(state, turn('a', 'lane-1'), T0).state;
    const atEdge = coalesce(state, turn('b', 'lane-1'), T0 + COALESCE_WINDOW_MS);
    expect(atEdge.action).toBe('raise');
  });

  test('one millisecond inside the boundary still collapses', () => {
    let state = initialCoalesceState();
    state = coalesce(state, turn('a', 'lane-1'), T0).state;
    const inside = coalesce(state, turn('b', 'lane-1'), T0 + COALESCE_WINDOW_MS - 1);
    expect(inside.action).toBe('replace');
  });

  test('the window slides — a steady drip never expires the group', () => {
    let state = initialCoalesceState();
    let out = coalesce(state, turn('a', 'lane-1'), T0);
    state = out.state;
    for (let i = 1; i <= 5; i += 1) {
      out = coalesce(state, turn(`b${i}`, 'lane-1'), T0 + i * (COALESCE_WINDOW_MS - 1000));
      state = out.state;
    }
    expect(out.action).toBe('replace');
    expect(out.count).toBe(6);
  });

  test('a refusal never collapses — two refusals are two pieces of news', () => {
    let state = initialCoalesceState();
    const first = coalesce(state, turn('a', 'lane-1', KIND.turnRefused), T0);
    state = first.state;
    const second = coalesce(state, turn('b', 'lane-1', KIND.turnRefused), T0 + 10);
    expect(first.action).toBe('raise');
    expect(second.action).toBe('raise');
  });

  test('a disk warning never collapses — the second one means it got worse', () => {
    let state = initialCoalesceState();
    const first = coalesce(state, system('s1', KIND.storageWarning), T0);
    state = first.state;
    const second = coalesce(state, system('s2', KIND.storageWarning), T0 + 10);
    expect(second.action).toBe('raise');
  });

  test('the reload offer never collapses', () => {
    let state = initialCoalesceState();
    for (const kind of [KIND.codeReload]) {
      const a = coalesce(state, system(`${kind}-1`, kind), T0);
      state = a.state;
      const b = coalesce(state, system(`${kind}-2`, kind), T0 + 10);
      expect(b.action).toBe('raise');
      state = b.state;
    }
  });

  test('does not mutate the state it was given', () => {
    const state = initialCoalesceState();
    const frozenBefore = JSON.stringify(state);
    coalesce(state, turn('a', 'lane-1'), T0);
    expect(JSON.stringify(state)).toBe(frozenBefore);
  });

  test('returns frozen state so a caller cannot corrupt it in place', () => {
    const out = coalesce(initialCoalesceState(), turn('a', 'lane-1'), T0);
    expect(Object.isFrozen(out.state)).toBe(true);
    expect(Object.isFrozen(out.state.groups)).toBe(true);
  });

  test('is total — a malformed state or clock does not throw', () => {
    expect(() => coalesce(null, turn('a', 'lane-1'), T0)).not.toThrow();
    expect(() => coalesce({ groups: 'nope' }, turn('a', 'lane-1'), T0)).not.toThrow();
    expect(() => coalesce(initialCoalesceState(), turn('a', 'lane-1'), NaN)).not.toThrow();
    expect(() => coalesce(initialCoalesceState(), null, T0)).not.toThrow();
  });
});

describe('pruneCoalesceState', () => {
  test('drops groups whose window has closed', () => {
    let state = initialCoalesceState();
    state = coalesce(state, turn('a', 'lane-1'), T0).state;
    state = coalesce(state, turn('b', 'lane-2'), T0 + COALESCE_WINDOW_MS).state;
    const pruned = pruneCoalesceState(state, T0 + COALESCE_WINDOW_MS + 1);
    expect(Object.keys(pruned.groups)).toHaveLength(1);
  });

  test('keeps a group still inside its window', () => {
    let state = initialCoalesceState();
    state = coalesce(state, turn('a', 'lane-1'), T0).state;
    const pruned = pruneCoalesceState(state, T0 + 1000);
    expect(Object.keys(pruned.groups)).toHaveLength(1);
  });

  test('a long-lived backend does not accumulate groups forever', () => {
    let state = initialCoalesceState();
    for (let i = 0; i < 200; i += 1) {
      state = coalesce(state, turn(`t${i}`, `lane-${i}`), T0 + i * 1000).state;
    }
    const pruned = pruneCoalesceState(state, T0 + 200 * 1000);
    expect(Object.keys(pruned.groups).length).toBeLessThan(Object.keys(state.groups).length);
  });

  test('is total on malformed input', () => {
    expect(() => pruneCoalesceState(null, T0)).not.toThrow();
    expect(() => pruneCoalesceState({ groups: 5 }, NaN)).not.toThrow();
  });
});
