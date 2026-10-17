/**
 * The dailies bridge — the task ledger IS the vessel dailies, proven against
 * the REAL stores (RULE 0: real ledger files, real vitals log, real engine
 * transforms; no mock anywhere). Founder's 2026-08-29 ask: […]
 *
 * Isolation rides the module setters (setRealmRoot / setWorkspacesRoot) —
 * the same launch-scoped doors production honors, pointed at a temp ground.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ground = mkdtempSync(join(tmpdir(), 'dailies-bridge-'));

const { setRealmRoot } = await import('../../backend/services/user-realm.js');
const { default: ws, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
setRealmRoot(join(ground, 'realm'));
setWorkspacesRoot(join(ground, 'workspaces'));

const { addTask, updateTask } = await import('../../core/tasks/task-ledger.js');
const { derivedDailies, ensureDerivedDailies, bridgeDailyCompletion }
  = await import('../../backend/services/vessel-daily-bridge.js');
const { appendVital, vitalsSummary } = await import('../../backend/services/user-vitals.js');

const WALLET = `0x${'cd'.repeat(20)}`;
const LANE = 'bridge-proof-lane';
// The summary judges completions against the REAL today, so the fixture's
// "now" must be the real now — a pinned date here time-bombed the suite
// (green on the day it was written, red from the next morning on).
const NOW = new Date().toISOString();
const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';

const addDaily = (id, title) => ws.updateTaskLedger(LANE, (s) => addTask(s, { title, cadence: 'daily' }, { id, now: NOW }).ledger);
const settleDone = (id) => ws.updateTaskLedger(LANE, (s) => updateTask(s, { id, status: 'done' }, { now: NOW }).ledger);
const doneTask = (id, title) => ({ id, title, cadence: 'daily', status: 'done' });

beforeAll(async () => {
  await ws.create(LANE);
});

describe('derivedDailies — the ledger view of the definition', () => {
  it('daily-cadence live tasks are the dailies; dropped and once tasks are not', () => {
    const items = derivedDailies([
      { id: '1', title: 'A', cadence: 'daily', status: 'open' },
      { id: '2', title: 'B', cadence: 'daily', status: 'done' },
      { id: '3', title: 'C', cadence: 'daily', status: 'dropped' },
      { id: '4', title: 'D', cadence: 'once', status: 'open' },
      { id: '5', title: 'E' },
    ]);
    expect(items.map((i) => i.id)).toEqual(['1', '2']);
  });
});

describe('the bridge — finishing a daily in the task list updates the system', () => {
  it('definition syncs from the ledger; one of two done counts nothing yet; both done counts the day; re-settle cannot double-mark', async () => {
    await addDaily(A, 'Pre-desk daily');
    await addDaily(B, 'Dream journal');
    await ensureDerivedDailies({ wallet: WALLET, neumaId: LANE });

    let board = (await vitalsSummary(WALLET)).dailies;
    expect(board.total).toBe(2);
    expect(board.done).toBe(0);

    await settleDone(A);
    await bridgeDailyCompletion({ wallet: WALLET, neumaId: LANE, task: doneTask(A, 'Pre-desk daily'), now: NOW });
    board = (await vitalsSummary(WALLET)).dailies;
    expect(board.done).toBe(1);
    expect((await vitalsSummary(WALLET)).streakDays).toBe(0);

    await settleDone(B);
    await bridgeDailyCompletion({ wallet: WALLET, neumaId: LANE, task: doneTask(B, 'Dream journal'), now: NOW });
    const after = await vitalsSummary(WALLET);
    expect(after.dailies.done).toBe(2);
    expect(after.streakDays).toBe(1);

    const again = await bridgeDailyCompletion({ wallet: WALLET, neumaId: LANE, task: doneTask(B, 'Dream journal'), now: NOW });
    expect(again).toBeNull();
    const settled = await vitalsSummary(WALLET);
    expect(settled.dailies.done).toBe(2);
    expect(settled.streakDays).toBe(1);
  });

  it('while daily tasks exist, the ledger definition wins over a hand-set snapshot', async () => {
    await appendVital(WALLET, { kind: 'dailies-set', items: [{ id: 'hand-1', title: 'Hand set daily' }] });
    await ensureDerivedDailies({ wallet: WALLET, neumaId: LANE });
    const board = (await vitalsSummary(WALLET)).dailies;
    expect(board.items.map((i) => i.title).sort()).toEqual(['Dream journal', 'Pre-desk daily']);
  });

  it('a lane with no daily tasks never touches the log', async () => {
    const before = (await vitalsSummary(WALLET)).dailies;
    const items = await ensureDerivedDailies({ wallet: WALLET, neumaId: LANE.replace(/lane$/, 'empty') });
    expect(items).toEqual([]);
    expect((await vitalsSummary(WALLET)).dailies).toEqual(before);
  });
});

afterAll(() => {
  rmSync(ground, { recursive: true, force: true });
});
