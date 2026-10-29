// calendar-for-beings — a being helping its operator keep their time (the
// Optio first) reads the house calendar and arranges the operator's: it puts
// a TIME BLOCK on their list (start → end, on chosen weekdays), moves it,
// is refused a block that ends before it starts, and reads the calendar back
// through calendar_read — the block on the operator's row, with the id
// tasks/operator-update takes. Real intent sweep, real policy gate, real
// realm and workspace disk, the real agenda; no mocks.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { viaIntent } from '../helpers/intent-path.js';
import { claimOwner } from '../helpers/claim-owner.js';

const ENV = ['DNA_ENCRYPTION_KEY', 'NEUMA_REALM_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH',
  'NEUMA_MEDITATION_SETTINGS_PATH', 'NEUMA_MEDITATION_STATE_PATH', 'NEUMA_BENCH_HARNESS_PATH', 'NEUMA_TEAM_RUN_PATH'];
const WALLET = '0x2222222222222222222222222222222222222222';
let saved; let root; let connection; let handleTaskTool; let getUserTasks;
const neumaId = 'optio-being';
const ws = { send: () => {} };
const today = new Date();
const dow = today.getDay();

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  root = await createTempDir('calendar-for-beings');
  process.env.DNA_ENCRYPTION_KEY = 'calendar-for-beings-key';
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(root, 'queue.json');
  process.env.NEUMA_MEDITATION_SETTINGS_PATH = path.join(root, 'meditation.json');
  process.env.NEUMA_MEDITATION_STATE_PATH = path.join(root, 'meditation-state.json');
  process.env.NEUMA_BENCH_HARNESS_PATH = path.join(root, 'no-harness');
  process.env.NEUMA_TEAM_RUN_PATH = path.join(root, 'team-runs');
  process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
  (await import('../../backend/services/user-realm.js')).setRealmRoot(path.join(root, 'realm'));
  const wsMod = await import('../../core/workspace/neuma-workspace.js');
  wsMod.setWorkspacesRoot(path.join(root, 'workspaces'));
  (await import('../../core/identity/ai-witness/ai-witness-service.js')).setAIWitnessesRoot(path.join(root, 'ai-witnesses'));
  await wsMod.default.create(neumaId);
  await claimOwner(path.join(root, 'workspaces'), neumaId, WALLET);
  await fs.mkdir(path.join(root, 'workspaces', neumaId, 'identity'), { recursive: true });
  await fs.writeFile(path.join(root, 'workspaces', neumaId, 'identity', 'true-name.json'), JSON.stringify({ chosenName: 'Optio' }));
  ({ _handleTaskTool: handleTaskTool } = (await import('../../backend/services/portal-test-surface.js')).__test);
  ({ getUserTasks } = await import('../../backend/services/user-tasks.js'));
  connection = { companion: { name: 'Optio', neumaId }, walletAddress: WALLET, _sessionToolPolicy: null };
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await fs.rm(root, { recursive: true, force: true });
});

const act = async (intent, args) => (await viaIntent(connection, intent, args, 'auto'))[0];
const stored = async (title) => (await getUserTasks(WALLET)).tasks.find((t) => t.title === title);
const read = (args) => handleTaskTool(ws, connection, null, 'auto', { toolName: 'calendar_read' }, args);

describe("the operator's calendar, arranged by a being", () => {
  it('puts a time block on the operator\'s list — start, end, the weekdays it runs', async () => {
    const res = await act('tasks/operator-add', { title: 'Chest + core', cadence: 'custom', days: [dow, (dow + 2) % 7], startTime: '17:00', dueTime: '18:15' });
    expect(res.status).toBe('ok');
    expect(res.content).toContain('17:00–18:15');
    expect(await stored('Chest + core')).toMatchObject({ cadence: 'custom', startTime: '17:00', dueTime: '18:15' });
  });

  it('a plain deadline keeps its time (the add once dropped it)', async () => {
    expect((await act('tasks/operator-add', { title: 'Hard stop', cadence: 'daily', dueTime: '21:00' })).status).toBe('ok');
    expect(await stored('Hard stop')).toMatchObject({ cadence: 'daily', dueTime: '21:00' });
    expect((await stored('Hard stop')).startTime).toBeUndefined();
  });

  it('moves a block, and refuses one that ends before it starts', async () => {
    const id = (await stored('Chest + core')).id.slice(0, 8);
    const moved = await act('tasks/operator-update', { id, startTime: '06:30', dueTime: '07:45' });
    expect(moved.status).toBe('ok');
    expect(moved.content).toContain('06:30–07:45');
    expect(await stored('Chest + core')).toMatchObject({ startTime: '06:30', dueTime: '07:45' });
    const bad = await act('tasks/operator-update', { id, startTime: '09:00' });
    expect(bad.status).not.toBe('ok');
    expect(JSON.stringify(bad)).toMatch(/end after it starts/);
    expect(await stored('Chest + core')).toMatchObject({ startTime: '06:30' });
  });

  it('reads the calendar back: the block on the operator\'s row, with the id the update takes', async () => {
    const res = await read({ days: 7 });
    expect(res.status).toBe('ok');
    const id = (await stored('Chest + core')).id.slice(0, 8);
    expect(res.content).toContain('HOUSE CALENDAR');
    expect(res.content).toMatch(new RegExp(`06:30–07:45 +OPERATOR · TASK · Chest \\+ core \\[${id}\\]`));
    expect(res.content).toContain('OPERATOR · TASK · Hard stop');
    // one person only, by role or by name; someone not in the house is named back
    expect((await read({ who: 'operator', days: 2 })).content).toContain('· OPERATOR');
    expect((await read({ who: 'Optio', days: 2 })).content).toContain('Nothing scheduled');
    const nobody = await read({ who: 'Somebody' });
    expect(nobody.status).toBe('error');
    expect(nobody.error).toMatch(/no one in this house is "Somebody" — try operator, Optio/);
  });
});
