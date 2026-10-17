// The `vessel` flag on the assigned plan — pure-module proof, no mocks (RULE 0:
// real inputs, real outputs). The flag marks a daily on the operator's own list
// as one of their vessel dailies; the dailies bridge (backend/services/
// vessel-daily-bridge.js) unions flagged dailies into the definition and marks
// the vessel log on settle.

import { describe, it, expect } from 'vitest';
import { emptyPlan, addAssigned, updateAssigned } from '../../core/tasks/assigned-plan.js';
import { validatePresetSpec, instantiatePreset, BUILTIN_PRESETS } from '../../core/tasks/task-presets.js';

const NOW = '2026-08-31T08:00:00.000Z';
let seq = 0;
const mintId = () => `v-${(seq++).toString(16).padStart(4, '0')}`;

describe('assigned plan — the vessel flag', () => {
  it('addAssigned stores the flag only when true — absence IS "not a vessel daily"', () => {
    const flagged = addAssigned(emptyPlan(), { title: 'Work out', cadence: 'daily', vessel: true }, { id: mintId(), now: NOW }).task;
    expect(flagged.vessel).toBe(true);

    const off = addAssigned(emptyPlan(), { title: 'Read', cadence: 'daily', vessel: false }, { id: mintId(), now: NOW }).task;
    expect('vessel' in off).toBe(false);

    const absent = addAssigned(emptyPlan(), { title: 'Write', cadence: 'daily' }, { id: mintId(), now: NOW }).task;
    expect('vessel' in absent).toBe(false);
  });

  it('a non-boolean vessel is a tagged correction naming the fix', () => {
    let err = null;
    try {
      addAssigned(emptyPlan(), { title: 'x', cadence: 'daily', vessel: 'yes' }, { id: mintId(), now: NOW });
    } catch (e) { err = e; }
    expect(err?.correction).toBe(true);
    expect(err?.message).toMatch(/vessel must be true or false/);
  });

  it('updateAssigned sets and clears the flag in place', () => {
    const { plan, task } = addAssigned(emptyPlan(), { title: 'Work out', cadence: 'daily' }, { id: mintId(), now: NOW });

    const set = updateAssigned(plan, { id: task.id, vessel: true }, { now: NOW });
    expect(set.task.vessel).toBe(true);

    const cleared = updateAssigned(set.plan, { id: task.id, vessel: false }, { now: NOW });
    expect('vessel' in cleared.task).toBe(false);

    let err = null;
    try {
      updateAssigned(cleared.plan, { id: task.id, vessel: 1 }, { now: NOW });
    } catch (e) { err = e; }
    expect(err?.correction).toBe(true);
    expect(err?.message).toMatch(/vessel must be true or false/);
  });
});

describe('task presets — the vessel flag', () => {
  it('the flag carries through validation and instantiation; non-boolean is refused', () => {
    const spec = { name: 'Body', tasks: [{ title: 'Lift', cadence: 'daily', vessel: true }] };
    const valid = validatePresetSpec(spec);
    expect(valid.tasks[0].vessel).toBe(true);

    const { added } = instantiatePreset(emptyPlan(), spec, { mintId, now: NOW });
    expect(added[0].vessel).toBe(true);

    let err = null;
    try {
      validatePresetSpec({ name: 'Broken', tasks: [{ title: 'Lift', vessel: 'yes' }] });
    } catch (e) { err = e; }
    expect(err?.correction).toBe(true);
    expect(err?.message).toMatch(/vessel must be true or false/);
  });

  it('the body dailies of the built-in catalog ship flagged; the rest do not', () => {
    const byId = Object.fromEntries(BUILTIN_PRESETS.map((p) => [p.id, p]));
    expect(byId['builtin:daily-training'].tasks[0].vessel).toBe(true);
    expect(byId['builtin:morning-reset'].tasks[0].vessel).toBe(true);
    expect(byId['builtin:deep-work'].tasks[0].vessel).toBeUndefined();
    expect(byId['builtin:weekly-review'].tasks[0].vessel).toBeUndefined();
    // The catalog still validates whole under its own law.
    for (const p of BUILTIN_PRESETS) expect(() => validatePresetSpec(p)).not.toThrow();
  });
});
