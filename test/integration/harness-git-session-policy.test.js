// Real signed approvals, policy IO failure and production binding resets.
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, test, expect } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { gateAct } from '../../backend/services/act-gate.js';
import { clearLaneBinding, clearSessionRuntime } from '../../backend/routes/portal-connections.js';

let kit;
let release;
beforeEach(async () => { kit = await createHarnessTurnKit('git-session-proof'); });
afterEach(async () => { release?.(); release = null; await kit?.close(); });
const gate = () => gateAct(kit.connection, {
  server: 'coding', tool: 'ground_git', args: {}, mode: 'auto', emit: kit.emit,
});
const cards = () => kit.frames.filter((frame) => frame.type === 'tool:approval_request');

test.each([['session reset', clearSessionRuntime], ['lane rebind', clearLaneBinding]])(
  'a real persistence failure grants only this session; %s requires a new card', async (_name, reset) => {
    const first = gate();
    const card = await untilHarness(() => cards()[0]);
    const target = path.join(workspace.pathFor(kit.laneId), 'config', 'tool-policy.json');
    await fs.mkdir(target, { recursive: true });
    await expect(workspace.readToolPolicy(kit.laneId)).rejects.toMatchObject({ code: 'EISDIR' });
    kit.decide(card, 'always');
    expect(await first).toEqual({ ok: true });
    expect(kit.connection._sessionToolPolicy.coding.allowed).toContain('ground_git');
    // Remove the actual storage obstruction; there is still no persisted grant.
    await fs.rmdir(target);
    expect(await workspace.readToolPolicy(kit.laneId)).toBeNull();
    expect(await gate()).toEqual({ ok: true });
    expect(cards()).toHaveLength(1);
    const companion = kit.connection.companion;
    reset(kit.connection);
    kit.connection.companion = companion;
    kit.connection.sessionId = 'next-session';
    expect(kit.connection._sessionToolPolicy).toBeNull();
    const next = gate();
    const nextCard = await untilHarness(() => cards()[1]);
    kit.decide(nextCard, 'deny');
    expect((await next).ok).toBe(false);
  },
);

test('a queued old ALWAYS cannot clear or replace the new binding’s authority', async () => {
  const first = gate();
  const card = await untilHarness(() => cards()[0]);
  let entered = false;
  const held = new Promise((resolve) => { release = resolve; });
  const writer = workspace.updateToolPolicy(kit.laneId, async (policy) => {
    entered = true;
    await held;
    return policy ?? {};
  });
  await untilHarness(() => entered);
  kit.decide(card, 'always');
  await untilHarness(() => kit.handled.some((message) => message.id === card.id));
  clearLaneBinding(kit.connection);
  kit.connection.companion = { neumaId: kit.laneId, name: 'Next binding' };
  kit.connection.sessionId = 'next-session';
  kit.connection._sessionToolPolicy = { coding: { allowed: ['inspect'] } };
  release();
  await writer;
  expect((await first).ok).toBe(false);
  expect(kit.connection._sessionToolPolicy).toEqual({ coding: { allowed: ['inspect'] } });
  expect(await workspace.readToolPolicy(kit.laneId)).toEqual({});
});
