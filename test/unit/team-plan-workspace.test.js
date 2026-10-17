// The plan's assigned-workspace grammar (#171) — pure normalization: the
// directory all the team's file work is confined to, plus its byte budget.

import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  normalizeWorkspace, normalizePlanArgs, DEFAULT_WORKSPACE_BUDGET_BYTES,
} from '../../backend/services/team-plan.js';

describe('normalizeWorkspace', () => {
  it('is null when no workspace is asked for', () => {
    expect(normalizeWorkspace(undefined)).toBe(null);
    expect(normalizeWorkspace(null)).toBe(null);
  });

  it('resolves the root and applies the default budget', () => {
    const ws = normalizeWorkspace({ root: '/tmp/bench-arena' });
    expect(ws.root).toBe(path.resolve('/tmp/bench-arena'));
    expect(ws.budgetBytes).toBe(DEFAULT_WORKSPACE_BUDGET_BYTES);
    expect(Object.isFrozen(ws)).toBe(true);
  });

  it('honors an explicit budget and refuses a nonsensical one', () => {
    expect(normalizeWorkspace({ root: '/tmp/a', budgetBytes: 1024 }).budgetBytes).toBe(1024);
    expect(() => normalizeWorkspace({ root: '/tmp/a', budgetBytes: 0 })).toThrow(/positive/);
    expect(() => normalizeWorkspace({ root: '/tmp/a', budgetBytes: 'lots' })).toThrow(/positive/);
  });

  it('refuses a workspace without a root — the correction names the field', () => {
    expect(() => normalizeWorkspace({})).toThrow(/workspace\.root/);
    expect(() => normalizeWorkspace({ root: '   ' })).toThrow(/workspace\.root/);
  });
});

describe('normalizePlanArgs carries the workspace', () => {
  const base = { goal: 'one-shot the heptagon', steps: [{ id: 'build', member: 'Keir', task: 'write it' }] };

  it('rides the plan when given, null when absent', () => {
    expect(normalizePlanArgs(base).workspace).toBe(null);
    const withWs = normalizePlanArgs({ ...base, workspace: { root: '/tmp/arena' } });
    expect(withWs.workspace.root).toBe(path.resolve('/tmp/arena'));
  });

  it('a malformed workspace fails the WHOLE submission — never a silent drop', () => {
    expect(() => normalizePlanArgs({ ...base, workspace: { budgetBytes: 5 } })).toThrow(/workspace\.root/);
  });
});

describe('structured args that arrive as TEXT (text tool dialects)', () => {
  // Text dialects (Qwen-native parameters, relaxed parses) hand every arg
  // over as a string — the plan gate must read the JSON the being actually
  // wrote instead of bouncing it with a correction it cannot act on.
  const goal = 'one-shot the hexagon';

  it('steps as a JSON string parse into real steps', () => {
    const steps = JSON.stringify([{ id: 'build', member: 'Galen', task: 'write the physics' }]);
    const plan = normalizePlanArgs({ goal, steps });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ id: 'build', member: 'Galen' });
  });

  it('a real newline inside a task string is repaired, not lost', () => {
    const steps = '[{"id": "build", "member": "Galen", "task": "line one\nline two"}]';
    const plan = normalizePlanArgs({ goal, steps });
    expect(plan.steps[0].task).toBe('line one\nline two');
  });

  it('workspace as a JSON string parses and resolves its root', () => {
    const plan = normalizePlanArgs({
      goal,
      steps: [{ id: 'build', member: 'Galen', task: 'write it' }],
      workspace: '{"root": "/tmp/arena"}',
    });
    expect(plan.workspace.root).toBe(path.resolve('/tmp/arena'));
  });

  it('steps text that never parses to an array still gets the steps correction', () => {
    expect(() => normalizePlanArgs({ goal, steps: 'build it, then verify' })).toThrow(/needs steps/);
  });

  it('workspace text that never parses to an object names the expected shape', () => {
    expect(() => normalizePlanArgs({
      goal,
      steps: [{ id: 'build', member: 'Galen', task: 'write it' }],
      workspace: 'the bench arena',
    })).toThrow(/workspace.*object/i);
  });
});
