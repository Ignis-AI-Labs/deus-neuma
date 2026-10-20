// operator-drop-card — taking something off the operator's list and calendar
// is THEIR yes (Design note, 2026-10-17: […]). Even in AUTO the card rises and names
// exactly what leaves; deny leaves the list whole, allow drops it; with no
// screen to show a card there is no yes, so it is refused; a title that is not the stored one is
// refused before any card; only an explicit standing grant lets it run
// without one. The real intent sweep, approval broker, a real WebSocket pair,
// real realm disk; no mocks.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { viaIntent, granting } from '../helpers/intent-path.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';

const WALLET = '0x3333333333333333333333333333333333333333';
const LANE = 'drop-optio';
let saved; let root; let httpServer; let wss; let serverWs; let client; let clientLog; let decide = null;
let addUserTask; let getUserTasks;

beforeAll(async () => {
  saved = { key: process.env.DNA_ENCRYPTION_KEY, realm: process.env.NEUMA_REALM_ROOT };
  root = await createTempDir('operator-drop-card');
  process.env.DNA_ENCRYPTION_KEY = 'operator-drop-card-key';
  process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
  (await import('../../backend/services/user-realm.js')).setRealmRoot(path.join(root, 'realm'));
  const wsMod = await import('../../core/workspace/neuma-workspace.js');
  wsMod.setWorkspacesRoot(path.join(root, 'workspaces'));
  await wsMod.default.create(LANE);
  ({ addUserTask, getUserTasks } = await import('../../backend/services/user-tasks.js'));

  httpServer = createServer();
  wss = new WebSocketServer({ server: httpServer });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const linked = new Promise((r) => wss.once('connection', (ws) => {
    serverWs = ws;
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(ws.__connection, m.id, m.decision);
    });
    r();
  }));
  client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
  const opened = new Promise((r) => client.once('open', r));
  clientLog = [];
  client.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    clientLog.push(msg);
    if (msg.type === 'tool:approval_request' && decide) client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: decide(msg) }));
  });
  await Promise.all([linked, opened]);
});

afterAll(async () => {
  client?.terminate();
  serverWs?.terminate();
  await new Promise((r) => wss.close(r));
  await new Promise((r) => httpServer.close(r));
  if (saved.key === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = saved.key;
  if (saved.realm === undefined) delete process.env.NEUMA_REALM_ROOT; else process.env.NEUMA_REALM_ROOT = saved.realm;
  await fs.rm(root, { recursive: true, force: true });
});

const connect = (ws = serverWs) => {
  const connection = { ws, companion: { name: 'Optio', neumaId: LANE }, walletAddress: WALLET, _sessionToolPolicy: null };
  if (ws) ws.__connection = connection;
  return connection;
};
const block = async (title) => (await addUserTask(WALLET, { title, cadence: 'daily', startTime: '17:00', dueTime: '18:15' })).task;
const statusOf = async (id) => (await getUserTasks(WALLET)).tasks.find((t) => t.id === id)?.status;
const asks = () => clientLog.filter((m) => m.type === 'tool:approval_request');

describe("taking something off the operator's calendar is their yes", () => {
  it('even in AUTO the card rises, naming exactly what leaves — deny keeps it, allow drops it', async () => {
    const task = await block('Late-night coding');
    decide = () => 'deny';
    await viaIntent(connect(), 'tasks/operator-drop', { id: task.id.slice(0, 8), title: 'late-night coding', reason: 'the hard stop is 21:00 now' }, 'auto');
    const card = asks().at(-1);
    expect(JSON.stringify(card)).toContain('REMOVE from your list and calendar: \\"late-night coding\\" — the hard stop is 21:00 now');
    expect(await statusOf(task.id)).toBe('open');

    decide = () => 'allow';
    await viaIntent(connect(), 'tasks/operator-drop', { id: task.id.slice(0, 8), title: 'Late-night coding', reason: 'the hard stop is 21:00 now' }, 'auto');
    expect(await statusOf(task.id)).toBe('dropped');
    decide = null;
  });

  it('with no screen to show the card, there is no yes — it is refused and nothing leaves', async () => {
    const task = await block('Weekend sprint');
    const before = asks().length;
    const connection = { companion: { name: 'Optio', neumaId: LANE }, walletAddress: WALLET, _sessionToolPolicy: null };
    await viaIntent(connection, 'tasks/operator-drop', { id: task.id.slice(0, 8), title: 'Weekend sprint', reason: 'rest day' }, 'auto');
    // the broker settles it as a refusal — no card could be shown, so no yes was given
    const result = JSON.parse(await fs.readFile(path.join(root, 'workspaces', LANE, 'intents', 'act.result.json'), 'utf8'));
    expect(result.status).toBe('denied');
    expect(asks().length).toBe(before);
    expect(await statusOf(task.id)).toBe('open');
  });

  it('a title that is not the stored one is refused before any card', async () => {
    const task = await block('Deep work');
    const before = asks().length;
    const [receipt] = await viaIntent(connect(), 'tasks/operator-drop', { id: task.id.slice(0, 8), title: 'Something else', reason: 'x' }, 'auto');
    expect(receipt.status).toBe('error');
    expect(receipt.error).toMatch(/reads "Deep work", not "Something else"/);
    expect(asks().length).toBe(before);
    expect(await statusOf(task.id)).toBe('open');
  });

  it('only an explicit standing grant lets it run without a card', async () => {
    const task = await block('Evening scroll');
    const before = asks().length;
    await viaIntent(connect(), 'tasks/operator-drop', { id: task.id.slice(0, 8), title: 'Evening scroll', reason: 'asked to clear it' }, 'auto', granting('tasks.operator-drop'));
    expect(asks().length).toBe(before);
    expect(await statusOf(task.id)).toBe('dropped');
  });
});
