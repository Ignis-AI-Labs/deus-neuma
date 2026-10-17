/** H2: authenticated frames reach the actual dispatcher, broker and task store. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace from '../../core/workspace/neuma-workspace.js';
import { sweepBatchIntents } from '../../backend/services/intents/intent-sweep.js';
import { settleActiveTurn } from '../../backend/routes/portal-context.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';

let kit;
let file;
beforeEach(async () => {
  kit = await createHarnessTurnKit();
  file = path.join(workspace.pathFor(kit.laneId), 'intents', 'interrupt-me.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ type: 'tasks/add', title: 'must stay pending' }));
  await workspace.writeToolPolicy(kit.laneId, { intents: { requireApproval: ['tasks.add'] } });
});
afterEach(async () => { await kit?.close(); });

const pendingCard = () => untilHarness(() => kit.frames.find((frame) => frame.type === 'tool:approval_request'));
const assertPending = async () => {
  expect(kit.connection._pendingApprovals.size).toBe(0);
  await expect(fs.stat(file.replace(/\.json$/, '.result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(0);
  expect((await workspace.readToolPolicy(kit.laneId)).intents.allowed || []).not.toContain('tasks.add');
};

describe('detached settlement cancellation ingress', () => {
  test.each(['consciousness:interrupt', 'voice:speech_start'])('%s cancels pending and queued sweeps after turn handles clear', async (type) => {
    const original = kit.connection.activeTurn;
    const first = sweepBatchIntents(kit.connection, kit.emit);
    const card = await pendingCard();
    const queued = sweepBatchIntents(kit.connection, kit.emit);
    kit.connection.activeTurn = null;
    kit.connection.turnPromise = null;
    kit.client.send(JSON.stringify({ type, gen: 1 }));
    expect(await first).toEqual([]);
    expect(await queued).toEqual([]);
    await untilHarness(() => kit.frames.find((frame) => frame.type === 'tool:approval_resolved' && frame.id === card.id));
    expect(kit.frames.find((frame) => frame.type === 'tool:approval_resolved' && frame.id === card.id).decision).toBe('interrupted');
    expect(original.signal.aborted).toBe(false); // only the real ingress registry cut the sweep
    kit.decide(card, 'always');
    await untilHarness(() => kit.handled.some((frame) => frame.type === 'tool:approval_response' && frame.id === card.id));
    await assertPending();
    expect(kit.frames.filter((frame) => frame.type === 'tool:approval_request')).toHaveLength(1);

    // Cancellation is not a sticky denial: a later valid sweep can ask anew.
    kit.connection.activeTurn = new AbortController();
    const next = sweepBatchIntents(kit.connection, kit.emit);
    const nextCard = await untilHarness(() => kit.frames.find((frame) => frame.type === 'tool:approval_request' && frame.id !== card.id));
    kit.decide(nextCard, 'allow');
    expect((await next)[0].status).toBe('ok');
    expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(1);
  });

  test('a real retry cancels the old sweep before early history IO, without creating a new controller', async () => {
    const original = kit.connection.activeTurn;
    const run = sweepBatchIntents(kit.connection, kit.emit);
    const card = await pendingCard();
    kit.connection.activeTurn = null;
    kit.connection.turnPromise = null;
    // Missing persisted turn is a real early-IO refusal, never model inference.
    kit.client.send(JSON.stringify({ type: 'consciousness:retry', retry: { turnId: 'not-a-persisted-turn' } }));
    expect(await run).toEqual([]);
    await untilHarness(() => kit.handled.some((frame) => frame.type === 'consciousness:retry'));
    const resolved = await untilHarness(() => kit.frames.find((frame) => frame.type === 'tool:approval_resolved' && frame.id === card.id));
    expect(resolved.decision).toBe('interrupted');
    await untilHarness(() => kit.frames.find((frame) => frame.type === 'consciousness:complete'));
    expect(kit.connection.activeTurn).toBeNull();
    expect(original.signal.aborted).toBe(false);
    await assertPending();
  });

  test('captured turnPromise detects a replacement even with no active controller', async () => {
    kit.connection.turnPromise = fs.readFile(file, 'utf8');
    const run = sweepBatchIntents(kit.connection, kit.emit);
    await pendingCard();
    await kit.connection.turnPromise;
    kit.connection.activeTurn = null;
    kit.connection.turnPromise = fs.readFile(file, 'utf8');
    expect(await run).toEqual([]);
    await kit.connection.turnPromise;
    await assertPending();
  });

  test('navigation settling cancels a detached card even with no turnPromise', async () => {
    const run = sweepBatchIntents(kit.connection, kit.emit);
    await pendingCard();
    kit.connection.activeTurn = null;
    kit.connection.turnPromise = null;
    await settleActiveTurn(kit.connection);
    expect(await run).toEqual([]);
    await assertPending();
  });
});
