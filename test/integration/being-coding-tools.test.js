/**
 * Neuma coding seat (RULE 0): real WebSocket approval, real policy cascade,
 * real overlay shell, real bubblewrap commands, and production dispatch.
 * No execution, approval, filesystem, or portal boundary is mocked.
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { expirePendingApprovals, resolveToolApproval } from '../../backend/services/tool-approval.js';
import {
  beingCodingToolsFor, discloseTurnTools, disclosedNativeTools,
  stashBeingTurnCatalog, TOOL_DOORS,
} from '../../backend/services/being-tool-surface.js';
import { ensureTurnSandbox } from '../../backend/services/turn-sandbox.js';
import { FS_PRIMITIVE_TOOLS } from '../../backend/services/fs-primitives.js';
import { dispatchPlatformTool } from '../../backend/services/portal-tool-dispatch.js';
import { createWebSettings } from '../../backend/services/web-settings.js';
import { webToolsFor } from '../../backend/services/web-being-tools.js';
import { WITNESS_CODING_TOOLS } from '../../backend/services/witness-tools.js';
import { fixtureGit } from '../helpers/harness-git-kit.js';
import { createSmartGitFixture } from '../helpers/harness-smart-git-kit.js';

const LANE_ID = 'neuma-coding-proof';
const OPERATOR_WALLET = `0x${'c'.repeat(40)}`;
let root;
let source;
let server;
let wss;
let serverWs;
let client;
let connection;
let frames;
let smartGit;
let savedWorkspacesRoot;

const match = (toolName, command) => ({
  server: 'coding',
  toolName,
  tool: `coding/${toolName}`,
  args: command ? { command } : {},
});

const platformMatch = (serverName, toolName) => ({
  server: serverName,
  toolName,
  tool: `${serverName}/${toolName}`,
  args: {},
});

const untilFrame = (predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const started = Date.now();
  const inspect = () => {
    const frame = frames.find(predicate);
    if (frame) resolve(frame);
    else if (Date.now() - started >= timeoutMs) reject(new Error('Expected portal frame did not arrive'));
    else setTimeout(inspect, 10);
  };
  inspect();
});

const dispatch = (call) => dispatchPlatformTool(call, {
  ws: serverWs,
  connection,
  companion: connection.companion,
  policy: null,
  toolMode: connection.toolMode,
  args: call.args,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-coding-seat-'));
  source = path.join(root, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'needle.txt'), 'alpha\nbeta\n');
  await fixtureGit(source, ['init', '--quiet', '--initial-branch', 'sovereign-proof']);
  await fixtureGit(source, ['add', 'needle.txt']);
  await fixtureGit(source, ['commit', '--quiet', '-m', 'proof ground']);
  savedWorkspacesRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(root, 'workspaces'));
  await neumaWorkspace.create(LANE_ID);

  server = http.createServer();
  wss = new WebSocketServer({ server });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const linked = new Promise((resolve) => {
    wss.once('connection', (socket) => { serverWs = socket; resolve(); });
  });
  client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const opened = new Promise((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  frames = [];
  client.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    if (frame.type === 'tool:approval_request') {
      client.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: 'allow' }));
    }
  });
  await Promise.all([linked, opened]);

  connection = {
    ws: serverWs,
    walletAddress: OPERATOR_WALLET,
    toolMode: 'ask',
    toolWorkspace: source,
    activeTurn: new AbortController(),
    companion: { name: 'CodingProof', neumaId: LANE_ID, participantKind: 'neuma' },
  };
  serverWs.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.type === 'tool:approval_response') {
      resolveToolApproval(connection, frame.id, frame.decision);
    }
  });
});

afterEach(async () => {
  connection?.activeTurn?.abort();
  if (connection) expirePendingApprovals(connection);
  const remote = smartGit;
  smartGit = null;
  try { await remote?.close(); }
  finally {
    if (client?.readyState === WebSocket.OPEN) client.terminate();
    if (serverWs?.readyState === WebSocket.OPEN) serverWs.terminate();
    await new Promise((resolve) => wss.close(resolve));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(savedWorkspacesRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('neuma coding tool surface', () => {
  test('THE HOUSE TOOLING LAW: an unfocused seat shells into its own house workspace', async () => {
    // Design note, 2026-09-15: every house member has the same tooling — position
    // divides the work, never capability. No focused folder, no problem: the
    // seat's own workspace on the house ground is the ground.
    const previousRealm = getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    await setHouseWorkspace(OPERATOR_WALLET, path.join(root, 'house-ground'));
    try {
      delete connection.toolWorkspace;
      const tools = await beingCodingToolsFor(connection);
      expect(tools.map(({ name }) => name).sort())
        .toEqual(WITNESS_CODING_TOOLS.map(({ name }) => name).sort());
      // The turn's sandbox is grounded at the seat's own house workspace —
      // per-seat, on the shared ground, never the sovereign lane (the overlay
      // law refuses to mask a being's own home).
      // Load on demand: nothing is prepared before an act; the first one prepares it there.
      expect(connection._turnSandbox).toBe(null);
      expect(connection._turnSandboxSource.sourceRoot).toContain(path.join(root, 'house-ground'));
      expect(await ensureTurnSandbox(connection)).toBeTruthy();
      expect(connection._turnSandboxError ?? null).toBeNull();
    } finally {
      setRealmRoot(previousRealm);
    }
  });

  test('inherits the coding floor with approved ground sight and autonomous local overlay execution', async () => {
    const tools = await beingCodingToolsFor(connection);
    const names = tools.map(({ name }) => name).sort();
    expect(names).toEqual(WITNESS_CODING_TOOLS.map(({ name }) => name).sort());
    const catalog = await stashBeingTurnCatalog(connection, tools, []);
    expect(catalog.find(({ name }) => name === 'ground_git')?.access).toBe('approval_required');
    expect(catalog.find(({ name }) => name === 'ground_sync')?.access).toBe('approval_required');
    expect(catalog.find(({ name }) => name === 'inspect')?.access).toBe('allowed');
    expect(catalog.find(({ name }) => name === 'execute')?.access).toBe('allowed');

    const ground = await dispatch(match('ground_git'));
    expect(ground).toMatchObject({ tool: 'coding/ground_git', status: 'ok' });
    expect(ground.content).toContain('branch:   sovereign-proof');
    expect(ground.content).toContain('head:');
    expect(await untilFrame((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/ground_git'))
      .toBeTruthy();
    const status = await dispatch(match('sandbox_status'));
    expect(status).toMatchObject({ tool: 'coding/sandbox_status', status: 'ok' });
    expect(status.content).toContain('the live focused folder, seen through a kernel overlay');
    const inspection = await dispatch(match('inspect', "grep -n 'alpha' needle.txt"));
    expect(inspection).toMatchObject({ tool: 'coding/inspect', status: 'ok' });
    expect(inspection.content).toContain('1:alpha');

    const execution = await dispatch(match('execute', 'printf "sandbox only\\n" > sandbox-only.txt'));
    expect(execution).toMatchObject({ tool: 'coding/execute', status: 'ok' });
    expect(await fs.readFile(path.join(connection._turnSandbox.workspace, 'sandbox-only.txt'), 'utf8'))
      .toBe('sandbox only\n');
    await expect(fs.stat(path.join(source, 'sandbox-only.txt'))).rejects.toMatchObject({ code: 'ENOENT' });

    expect(frames.some((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/execute')).toBe(false);
    // The offline shell asks for its network grant on the first execute — a
    // separate decision, remembered for the session either way.
    expect(await untilFrame((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/shell_network'))
      .toBeTruthy();
    expect(await untilFrame((frame) => frame.type === 'tool:usage' && frame.tool === 'coding/inspect' && frame.status === 'ok'))
      .toBeTruthy();
    expect(await untilFrame((frame) => frame.type === 'tool:usage' && frame.tool === 'coding/execute' && frame.status === 'ok'))
      .toBeTruthy();
  }, 30_000);

  test('the coding hands are the focused turn\'s own — in its catalog, one exact call away, never on the wire (2026-10-14)', async () => {
    // Design note, 2026-09-05: a resident burned a denied `.git` read and an exit 128
    // before discovering ground_git existed — so the family stands in the
    // catalog with the focus. Design note, 2026-10-14: the wire carries only the two
    // doors (tool-hud.js); the family answers a search with its contract.
    const tools = [...TOOL_DOORS, ...await beingCodingToolsFor(connection)];
    await stashBeingTurnCatalog(connection, tools, []);
    const ids = () => disclosedNativeTools(connection).map(({ server: family, name }) => `${family}/${name}`);
    expect(ids()).toEqual(['system/tool_search', 'system/call']);
    expect(connection._turnCatalog.map(({ server: family, name }) => `${family}/${name}`)).toEqual(expect.arrayContaining([
      'coding/sandbox_status', 'coding/sandbox_recover', 'coding/ground_git', 'coding/ground_sync', 'coding/inspect', 'coding/execute',
    ]));
    const result = await dispatch({
      ...platformMatch('system', 'tool_search'),
      args: { query: 'coding/ground_sync' },
    });
    expect(result).toMatchObject({ tool: 'system/tool_search', status: 'ok', count: 1 });
    expect(JSON.parse(result.content).tools[0]).toMatchObject({
      id: 'coding/ground_sync',
      access: 'approval_required',
    });
    expect(ids()).toEqual(['system/tool_search', 'system/call']); // a search never changes the wire
  });

  test('the fs hands and the coding family stand in the catalog — a miss answers honestly, the wire stays two doors', async () => {
    const tools = [...TOOL_DOORS, ...FS_PRIMITIVE_TOOLS, ...await beingCodingToolsFor(connection)];
    await stashBeingTurnCatalog(connection, tools, []);
    const ids = () => disclosedNativeTools(connection).map(({ server: family, name }) => `${family}/${name}`);
    expect(ids()).toEqual(['system/tool_search', 'system/call']);
    const result = await dispatch({
      ...platformMatch('system', 'tool_search'),
      args: { query: 'web' },
    });
    expect(result).toMatchObject({ tool: 'system/tool_search', status: 'ok', count: 0 });
    expect(JSON.parse(result.content).availableServers).toEqual(['coding', 'fs', 'system']);
    expect(ids()).toEqual(['system/tool_search', 'system/call']);
  });

  test('ground_sync pulls the live checkout behind the operator card', async () => {
    // Clone and sync both traverse Git's real smart HTTP protocol. Only fixture
    // preparation pushes locally; the production transport is never widened.
    smartGit = await createSmartGitFixture(source, root);
    const groundClone = path.join(root, 'ground-clone');
    await fixtureGit(root, ['clone', '--quiet', smartGit.url, groundClone]);
    await fs.writeFile(path.join(source, 'pulled.txt'), 'pulled through the card\n');
    await fixtureGit(source, ['add', 'pulled.txt']);
    await fixtureGit(source, ['commit', '--quiet', '-m', 'upstream work']);
    await fixtureGit(source, ['push', '--quiet', smartGit.remote, 'sovereign-proof']);
    const requestsBeforeSync = smartGit.requests.length;

    connection.toolWorkspace = groundClone;
    const tools = await beingCodingToolsFor(connection);
    await stashBeingTurnCatalog(connection, tools, []);
    const result = await dispatch(match('ground_sync'));
    expect(result).toMatchObject({ tool: 'coding/ground_sync', status: 'ok' });
    expect(result.content).toContain('Fast-forward');
    expect(smartGit.requests.slice(requestsBeforeSync)).toContainEqual({
      method: 'POST', path: '/smart-remote.git/git-upload-pack',
    });
    // The REAL checkout moved — the pull ran where the network lives.
    expect(await fs.readFile(path.join(groundClone, 'pulled.txt'), 'utf8')).toBe('pulled through the card\n');
    expect(await untilFrame((frame) =>
      frame.type === 'tool:approval_request' && frame.tool === 'coding/ground_sync')).toBeTruthy();
    expect(await untilFrame((frame) =>
      frame.type === 'tool:usage' && frame.tool === 'coding/ground_sync' && frame.status === 'ok')).toBeTruthy();
  });

  test('a persisted network grant reads back — the lane remembers its ALWAYS', async () => {
    // Prove the hydrated capability through the real runner and HTTP, not a
    // retired connection flag. Local execution remains independent of network.
    await neumaWorkspace.writeToolPolicy(LANE_ID, { shellNetwork: true });
    const tools = await beingCodingToolsFor(connection);
    await stashBeingTurnCatalog(connection, tools, []);
    let requests = 0;
    server.on('request', (_req, res) => { requests += 1; res.end('persisted-network-proof'); });
    const script = `fetch('http://127.0.0.1:${server.address().port}/network-proof', {signal: AbortSignal.timeout(5000)})`
      + '.then(r => r.text()).then(t => process.stdout.write(t))'
      + '.catch(e => { process.stderr.write(e.message); process.exitCode = 1; })';
    const execution = await dispatch(match('execute', `node -e ${JSON.stringify(script)}`));
    expect(execution).toMatchObject({ tool: 'coding/execute', status: 'ok' });
    expect(execution.content).toContain('persisted-network-proof');
    expect(requests).toBe(1);
    // Neither remembered network consent nor routine local execution asks again.
    expect(frames.some((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/shell_network')).toBe(false);
    expect(frames.some((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/execute')).toBe(false);
  });

  test('keeps persisted web ON and OFF truth discoverable through the same catalog', async () => {
    const settings = createWebSettings({ path: path.join(root, 'web-access.json'), env: {} });
    const webCatalog = async () => [...TOOL_DOORS, ...await webToolsFor(connection, settings)];
    const searchWeb = async (query = 'web') => {
      await stashBeingTurnCatalog(connection, await webCatalog(), []);
      return JSON.parse(discloseTurnTools(connection, { query }).content).tools;
    };

    expect(await settings.isEnabled()).toBe(true);
    expect((await searchWeb('web research')).map(({ id }) => id))
      .toEqual(['web/image_search', 'web/web_fetch', 'web/web_search']);

    await settings.setEnabled(false);
    expect(await settings.isEnabled()).toBe(false);
    expect((await searchWeb()).every(({ description }) => description.includes('[HELD — web access is OFF'))).toBe(true);

    await settings.setEnabled(true);
    expect(await settings.isEnabled()).toBe(true);
    expect((await searchWeb()).every(({ description }) => !description.includes('[HELD'))).toBe(true);
  });

  test('a refused shell answers the act that needed it with the reason', async () => {
    const filePath = path.join(root, 'not-a-folder.txt');
    await fs.writeFile(filePath, 'file\n');
    connection.toolWorkspace = filePath;
    const tools = await beingCodingToolsFor(connection);
    await stashBeingTurnCatalog(connection, tools, []);
    // Load on demand: the refusal surfaces at the first act, not before the message.
    const execution = await dispatch(match('execute', 'true'));
    expect(execution.status).toBe('unavailable');
    expect(execution.error).toContain('The coding shell is unavailable this turn');
    expect(execution.error).toContain('not an existing directory');
    const refusal = await dispatch(match('sandbox_status'));
    expect(refusal.status).toBe('unavailable');
    expect(refusal.error).toContain('The coding shell is unavailable this turn');
    expect(refusal.error).toContain('not an existing directory');
  });

  test('rejects witness calls to every local-custody authority before execution', async () => {
    connection.companion = {
      name: 'BoundaryProbe',
      neumaId: 'witness-openai-BoundaryProbe',
      participantKind: 'witness',
    };
    const calls = [
      // wallet_send/team_run/workspace_run are gone from dispatch (Stage 3):
      // they are intents now, with their seat refusals at validate time —
      // proven in spend-observe-hold.test.js and the intents gnosis suites.
      platformMatch('operator', 'request_seal'),
      platformMatch('refinement', 'refinement_sense'),
    ];
    for (const call of calls) {
      const result = await dispatch(call);
      expect(result).toEqual({
        tool: call.tool,
        status: 'denied',
        error: 'Witness seats cannot invoke local-custody authority.',
      });
      expect(await untilFrame((frame) =>
        frame.type === 'tool:usage'
        && frame.tool === call.tool
        && frame.status === 'denied'
        && frame.summary === 'sovereignty boundary')).toBeTruthy();
    }
  });
});
