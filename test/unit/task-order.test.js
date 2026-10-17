/**
 * TASK ORDER — size, hard blocking, and the operator's chosen order.
 *
 * Design note, 2026-08-03: […]
 *
 * Pure module, so every case here is the real law with real inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  TASK_SIZES, MAX_BLOCKERS, sizeWeight, sizeLabel, normalizeSize,
  normalizeBlockedBy, blockersOf, isBlocked, blockedReason,
  ORDER_MODES, orderMode, orderBySize,
} from '../../core/tasks/task-order.js';

const task = (id, over = {}) => ({ id, title: `task ${id}`, status: 'open', ...over });

describe('size', () => {
  it('weighs the four sizes in order, and an unsized task at zero', () => {
    expect(TASK_SIZES).toEqual(['quick', 'half', 'deep', 'epic']);
    const weights = TASK_SIZES.map((size) => sizeWeight({ size }));
    expect(weights).toEqual([1, 2, 3, 4]);
    expect(sizeWeight({})).toBe(0);
    expect(sizeWeight({ size: 'enormous' })).toBe(0);
    expect(sizeWeight(null)).toBe(0);
  });

  it('labels a size for display and says nothing for an unsized task', () => {
    expect(sizeLabel({ size: 'deep' })).toBe('DEEP');
    expect(sizeLabel({})).toBe('');
    expect(sizeLabel({ size: 'bogus' })).toBe('');
  });

  it('accepts the four sizes and refuses anything else with a correction', () => {
    for (const size of TASK_SIZES) expect(normalizeSize(size)).toBe(size);
    let err;
    try { normalizeSize('medium'); } catch (e) { err = e; }
    expect(err?.correction).toBe(true);
    expect(err.message).toContain('quick, half, deep, epic');
  });

  it('lets a wrong size be UNSAID — null and empty clear it', () => {
    // Once a task has been mis-sized, […] has to
    // stay sayable, or the first guess is permanent.
    expect(normalizeSize(null)).toBe(null);
    expect(normalizeSize('')).toBe(null);
  });
});

describe('blocking — the hard constraint', () => {
  const LIST = [task('a'), task('b'), task('c')];

  it('resolves ids, including the prefix ids the ledger lines print', () => {
    const long = [task('11111111-2222', { title: 'first' }), task('99999999-3333')];
    expect(normalizeBlockedBy(['11111111'], { tasks: long, selfId: '99999999-3333' }))
      .toEqual(['11111111-2222']);
  });

  it('refuses an id no task has — waiting on nothing is waiting forever', () => {
    let err;
    try { normalizeBlockedBy(['ghost'], { tasks: LIST, selfId: 'a' }); } catch (e) { err = e; }
    expect(err?.correction).toBe(true);
    expect(err.message).toContain('not on the list');
  });

  it('refuses a task waiting on itself', () => {
    expect(() => normalizeBlockedBy(['a'], { tasks: LIST, selfId: 'a' }))
      .toThrow(/cannot wait on itself/);
  });

  it('refuses a CYCLE — the deadlock nobody could refuse later', () => {
    // b already waits on a. Making a wait on b closes the loop, and both would
    // be permanently unstartable with nothing to explain why.
    const tasks = [task('a'), task('b', { blockedBy: ['a'] })];
    let err;
    try { normalizeBlockedBy(['b'], { tasks, selfId: 'a' }); } catch (e) { err = e; }
    expect(err?.correction).toBe(true);
    expect(err.message).toContain('wait on each other');
  });

  it('refuses a cycle formed through a THIRD task, not just a direct swap', () => {
    const tasks = [task('a'), task('b', { blockedBy: ['a'] }), task('c', { blockedBy: ['b'] })];
    expect(() => normalizeBlockedBy(['c'], { tasks, selfId: 'a' }))
      .toThrow(/wait on each other/);
  });

  it('allows a diamond — two tasks waiting on the same blocker is not a cycle', () => {
    const tasks = [task('a'), task('b', { blockedBy: ['a'] }), task('c')];
    expect(normalizeBlockedBy(['a'], { tasks, selfId: 'c' })).toEqual(['a']);
  });

  it('dedupes, caps, and clears', () => {
    expect(normalizeBlockedBy(['a', 'a', 'b'], { tasks: LIST, selfId: 'c' })).toEqual(['a', 'b']);
    expect(normalizeBlockedBy(null, { tasks: LIST, selfId: 'c' })).toBe(null);
    expect(normalizeBlockedBy([], { tasks: LIST, selfId: 'c' })).toBe(null);
    const many = Array.from({ length: MAX_BLOCKERS + 1 }, (_, i) => task(`t${i}`));
    expect(() => normalizeBlockedBy(many.map((t) => t.id), { tasks: many, selfId: 'c' }))
      .toThrow(/at most 8/);
  });

  it('names only the blockers still standing — settling one IS the unblock', () => {
    const tasks = [
      task('a', { status: 'done', title: 'the migration' }),
      task('b', { status: 'active', title: 'the schema' }),
      task('c', { blockedBy: ['a', 'b'] }),
    ];
    const c = tasks[2];
    expect(isBlocked(c, tasks)).toBe(true);
    expect(blockersOf(c, tasks)).toEqual([{ id: 'b', title: 'the schema', status: 'active' }]);

    // Nothing had to remember to unblock it: the blocker's status IS the answer.
    const settled = tasks.map((t) => (t.id === 'b' ? { ...t, status: 'done' } : t));
    expect(isBlocked(c, settled)).toBe(false);
    expect(blockersOf(c, settled)).toEqual([]);
  });

  it('treats a dropped blocker as settled — an abandoned blocker blocks nothing', () => {
    const tasks = [task('a', { status: 'dropped' }), task('b', { blockedBy: ['a'] })];
    expect(isBlocked(tasks[1], tasks)).toBe(false);
  });

  it('treats a VANISHED blocker as settled, not as blocking forever', () => {
    // Done one-shots get pruned out of the ledger. If a missing blocker counted
    // as live, the waiting task would be unstartable forever with nothing on
    // screen to explain it — the one failure mode with no way out.
    const tasks = [task('b', { blockedBy: ['pruned-long-ago'] })];
    expect(isBlocked(tasks[0], tasks)).toBe(false);
    expect(blockersOf(tasks[0], tasks)).toEqual([]);
  });

  it('says nothing when nothing blocks, and names what does', () => {
    expect(blockedReason([])).toBe('');
    expect(blockedReason([{ title: 'the schema' }])).toContain('waiting on "the schema"');
    const many = Array.from({ length: 5 }, (_, i) => ({ title: `t${i}` }));
    expect(blockedReason(many)).toContain('and 2 more');
  });
});

describe('order — the operator chooses', () => {
  const LIST = [
    task('a', { size: 'quick' }),
    task('b', { size: 'epic' }),
    task('c'),
    task('d', { size: 'half' }),
  ];

  it('leaves MY ORDER exactly as the store gave it — but hands back a COPY', () => {
    expect(orderBySize(LIST, 'mine').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    // Never the caller's own array: a downstream in-place sort would otherwise
    // silently reorder the ledger every other surface reads.
    expect(orderBySize(LIST, 'mine')).not.toBe(LIST);
    orderBySize(LIST, 'mine').sort((x, y) => x.id.localeCompare(y.id)).reverse();
    expect(LIST.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(orderBySize(LIST, 'nonsense').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(ORDER_MODES).toEqual(['mine', 'heaviest', 'lightest']);
    expect(orderMode('heaviest')).toBe('heaviest');
    expect(orderMode(undefined)).toBe('mine');
  });

  it('takes the hardship first under HEAVIEST FIRST', () => {
    expect(orderBySize(LIST, 'heaviest').map((t) => t.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('takes the small wins first under LIGHTEST FIRST', () => {
    expect(orderBySize(LIST, 'lightest').map((t) => t.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('trails the UNSIZED in both directions — they claim neither', () => {
    const mixed = [task('u1'), task('sized', { size: 'deep' }), task('u2')];
    expect(orderBySize(mixed, 'heaviest').map((t) => t.id)).toEqual(['sized', 'u1', 'u2']);
    expect(orderBySize(mixed, 'lightest').map((t) => t.id)).toEqual(['sized', 'u1', 'u2']);
  });

  it('keeps the store order among equals, by index and not by luck', () => {
    const same = ['a', 'b', 'c', 'd'].map((id) => task(id, { size: 'deep' }));
    expect(orderBySize(same, 'heaviest').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(orderBySize(same, 'lightest').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not mutate what it was handed', () => {
    const before = LIST.map((t) => t.id);
    orderBySize(LIST, 'heaviest');
    expect(LIST.map((t) => t.id)).toEqual(before);
  });

  it('survives the empty and the absent', () => {
    expect(orderBySize([], 'heaviest')).toEqual([]);
    expect(orderBySize(null, 'heaviest')).toEqual([]);
    expect(orderBySize(undefined, 'mine')).toEqual([]);
  });
});
