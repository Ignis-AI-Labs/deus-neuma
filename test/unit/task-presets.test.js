// Task presets — validation, atomic instantiation, the built-in catalog.
// Pure module under test: real specs in, real plans out, no mocks.

import { describe, it, expect } from 'vitest';
import { validatePresetSpec, instantiatePreset, BUILTIN_PRESETS, PRESET_MAX_TASKS } from '../../core/tasks/task-presets.js';
import { emptyPlan, addAssigned, ASSIGNED_MAX_LIVE } from '../../core/tasks/assigned-plan.js';

describe('task presets — validation', () => {
  it('normalizes a spec: trims, defaults cadence to once, accepts string subtasks', () => {
    const valid = validatePresetSpec({
      name: ' Push Day ',
      tasks: [{ title: ' Bench press ', subtasks: [{ title: 'warm-up' }, '4×8'] }],
    });
    expect(valid.name).toBe('Push Day');
    expect(valid.tasks[0].title).toBe('Bench press');
    expect(valid.tasks[0].cadence).toBe('once');
    expect(valid.tasks[0].subtasks.map((s) => s.title)).toEqual(['warm-up', '4×8']);
  });

  it('refuses malformed specs with tagged corrections naming the fix', () => {
    const attempt = (spec) => {
      try { validatePresetSpec(spec); return null; } catch (e) { return e; }
    };
    let e = attempt({ name: '  ', tasks: [{ title: 'x' }] });
    expect(e.message).toMatch(/needs a name/);
    expect(e.correction).toBe(true);
    e = attempt({ name: 'X', tasks: [] });
    expect(e.message).toMatch(/at least one task/);
    e = attempt({ name: 'X', tasks: Array.from({ length: PRESET_MAX_TASKS + 1 }, (_, i) => ({ title: `t${i}` })) });
    expect(e.message).toMatch(/at most/);
    e = attempt({ name: 'X', tasks: [{ title: 'x', cadence: 'hourly' }] });
    expect(e.message).toMatch(/cadence must be one of/);
    e = attempt({ name: 'X', tasks: [{ title: 'x', cadence: 'daily', dueDate: '2026-08-01' }] });
    expect(e.message).toMatch(/due date only makes sense on a milestone or a one-shot/);
    e = attempt({ name: 'X', tasks: [{ title: 'x', subtasks: [{ title: '  ' }] }] });
    expect(e.message).toMatch(/subtask 1 needs a title/);
  });

  it('the built-in catalog is valid, frozen, and namespaced', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(Object.isFrozen(BUILTIN_PRESETS)).toBe(true);
    for (const p of BUILTIN_PRESETS) {
      expect(p.id).toMatch(/^builtin:/);
      expect(() => validatePresetSpec(p)).not.toThrow();
    }
  });
});

describe('task presets — instantiation', () => {
  let seq = 0;
  const mintId = () => `p-${(seq++).toString(16).padStart(4, '0')}`;
  const NOW = '2026-07-18T08:00:00.000Z';

  it('applies a bundle whole — tasks, cadences, due dates, subtasks', () => {
    const { plan, added } = instantiatePreset(emptyPlan(), {
      name: 'X',
      tasks: [
        { title: 'A', cadence: 'daily', subtasks: [{ title: 'a1' }, { title: 'a2' }] },
        { title: 'B', cadence: 'milestone', dueDate: '2026-09-01' },
      ],
    }, { mintId, now: NOW });
    expect(plan.tasks).toHaveLength(2);
    expect(added[0]).toMatchObject({ title: 'A', cadence: 'daily', status: 'open' });
    expect(added[0].subtasks.map((s) => s.title)).toEqual(['a1', 'a2']);
    expect(added[0].subtasks.every((s) => s.status === 'open')).toBe(true);
    expect(added[1]).toMatchObject({ title: 'B', cadence: 'milestone', dueDate: '2026-09-01' });
  });

  it('refuses atomically when the bundle would breach the live cap', () => {
    let plan = emptyPlan();
    for (let i = 0; i < ASSIGNED_MAX_LIVE; i++) {
      ({ plan } = addAssigned(plan, { title: `t${i}`, cadence: 'once' }, { id: `x${i}`, now: NOW }));
    }
    expect(() => instantiatePreset(plan, { name: 'X', tasks: [{ title: 'one more' }] }, { mintId, now: NOW }))
      .toThrow(/would push this list past/);
    // Nothing half-applied.
    expect(plan.tasks).toHaveLength(ASSIGNED_MAX_LIVE);
  });
});

// A preset carrying the witness-designed custom rhythm — days validated and
// carried through instantiation; a dayless custom spec is refused whole.
describe('presets — custom cadence days', () => {
  it('a custom spec carries its days into the spawned task; dayless is refused', () => {
    const mint = (() => { let n = 0; return () => `p-${n++}`; })();
    const { plan, added } = instantiatePreset(
      { tasks: [] },
      { name: 'Training', tasks: [{ title: 'Lift', cadence: 'custom', days: [5, 1] }] },
      { mintId: mint, now: '2026-07-19T10:00:00.000Z' },
    );
    expect(added[0]).toMatchObject({ cadence: 'custom', days: [1, 5] });
    expect(plan.tasks[0].days).toEqual([1, 5]);
    let err = null;
    try {
      validatePresetSpec({ name: 'Broken', tasks: [{ title: 'Lift', cadence: 'custom' }] });
    } catch (e) { err = e; }
    expect(err?.message).toMatch(/custom cadence needs its days/);
    err = null;
    try {
      validatePresetSpec({ name: 'Broken', tasks: [{ title: 'Run', cadence: 'daily', days: [1] }] });
    } catch (e) { err = e; }
    expect(err?.message).toMatch(/days only make sense on a custom cadence/);
  });
});
