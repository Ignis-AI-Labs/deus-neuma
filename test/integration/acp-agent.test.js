/**
 * `neuma acp` — Neuma as an Agent Client Protocol agent (RULE 0).
 *
 * Three layers, all real:
 *   1. the wire, over real streams, against a real client on the other end;
 *   2. the portal, with the REAL approval gate (requestToolApproval) asking a
 *      real client over the wire, and the client's answer deciding the act;
 *   3. the real `neuma acp` program, spoken to over its stdin the way an editor
 *      speaks to it, seated in an isolated house. Its lane has no DNA, so a
 *      prompt that reaches the being is refused by the real identity gate —
 *      and that refusal arriving as an ACP message is the proof the prompt
 *      went all the way through. What a real model does stays a live sitting's proof.
 */
import { spawn, execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Wallet } from 'ethers';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { openAcpWire, RpcError, RPC } from '../../cli/lib/acp-wire.js';
import { createAcpPortal, acpToolKind, acpToolStatus, decisionFor } from '../../cli/lib/acp-portal.js';
import { promptText } from '../../cli/commands/acp.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { requestToolApproval, resolveToolApproval } from '../../backend/services/tool-approval.js';
import { settleOperatorAsk } from '../../backend/services/operator-ask.js';

// Two wires joined back to back: what one writes, the other reads.
const pair = (agentHandlers, clientHandlers = {}) => {
  const toAgent = new PassThrough();
  const toClient = new PassThrough();
  const agent = openAcpWire({ input: toAgent, output: toClient, handlers: agentHandlers });
  const client = openAcpWire({ input: toClient, output: toAgent, handlers: clientHandlers });
  return { agent, client, hangUp: () => { toAgent.end(); toClient.end(); }, toAgent, toClient };
};

describe('the wire', () => {
  test('a request is answered; an error carries its code; an unknown method is refused', async () => {
    const { client, hangUp } = pair({
      echo: (params) => ({ said: params.word }),
      fail: () => { throw new RpcError(RPC.INVALID_PARAMS, 'bad words'); },
      crash: () => { throw new Error('it broke'); },
    });
    await expect(client.request('echo', { word: 'hi' })).resolves.toEqual({ said: 'hi' });
    await expect(client.request('fail', {})).rejects.toMatchObject({ code: RPC.INVALID_PARAMS, message: 'bad words' });
    await expect(client.request('crash', {})).rejects.toMatchObject({ code: RPC.INTERNAL_ERROR, message: 'it broke' });
    await expect(client.request('nope', {})).rejects.toMatchObject({ code: RPC.METHOD_NOT_FOUND });
    await expect(client.request('constructor', {})).rejects.toMatchObject({ code: RPC.METHOD_NOT_FOUND });
    hangUp();
  });

  test('notifications arrive and are never answered', async () => {
    const heard = [];
    const lines = [];
    const { client, toClient, hangUp } = pair({ ping: (params) => { heard.push(params); return 'ignored'; } });
    toClient.on('data', (d) => lines.push(String(d)));
    client.notify('ping', { n: 1 });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(heard).toEqual([{ n: 1 }]);
    expect(lines).toEqual([]);
    hangUp();
  });

  test('a long request does not block a short one behind it', async () => {
    let release;
    const { client, hangUp } = pair({
      slow: () => new Promise((resolve) => { release = () => resolve({ done: 'slow' }); }),
      quick: () => ({ done: 'quick' }),
    });
    const slow = client.request('slow', {});
    await expect(client.request('quick', {})).resolves.toEqual({ done: 'quick' });
    release();
    await expect(slow).resolves.toEqual({ done: 'slow' });
    hangUp();
  });

  test('junk lines are answered with protocol errors, one line each', async () => {
    const input = new PassThrough();
    const out = [];
    openAcpWire({ input, output: { write: (t) => out.push(t) }, handlers: {} });
    input.write('not json\n[1,2]\n{"jsonrpc":"2.0","id":7}\n\n');
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(out.map((t) => JSON.parse(t).error.code)).toEqual([RPC.PARSE_ERROR, RPC.INVALID_REQUEST, RPC.INVALID_REQUEST]);
    expect(out.every((t) => t.endsWith('\n') && !t.slice(0, -1).includes('\n'))).toBe(true);
  });

  test('when the other side hangs up, what we asked is rejected and what we were asked is still answered', async () => {
    const input = new PassThrough();
    const out = [];
    let release;
    const wire = openAcpWire({
      input, output: { write: (t) => out.push(JSON.parse(t)) },
      handlers: { slow: () => new Promise((resolve) => { release = resolve; }) },
    });
    const asked = wire.request('session/request_permission', {});
    input.write('{"jsonrpc":"2.0","id":3,"method":"slow"}\n');
    input.end();
    await wire.closed;
    await expect(asked).rejects.toThrow('the client went away');
    const drained = wire.drain();
    release({ ok: true });
    await drained;
    expect(out.at(-1)).toEqual({ jsonrpc: '2.0', id: 3, result: { ok: true } });
  });
});

describe('the portal: frames become ACP updates', () => {
  test('tool names map to ACP kinds and statuses; editor answers map to decisions', () => {
    expect(['fs/read', 'fs/search', 'fs/write', 'fs/edit', 'fs/delete', 'fs/move', 'coding/execute', 'web/fetch', 'skies_read'].map(acpToolKind))
      .toEqual(['read', 'search', 'edit', 'edit', 'delete', 'move', 'execute', 'fetch', 'other']);
    expect(['executing', 'ok', 'error', 'denied', 'interrupted'].map(acpToolStatus))
      .toEqual(['in_progress', 'completed', 'failed', 'failed', 'failed']);
    expect(decisionFor({ outcome: 'selected', optionId: 'allow-once' })).toBe('allow');
    expect(decisionFor({ outcome: 'selected', optionId: 'allow-always' })).toBe('always');
    expect(decisionFor({ outcome: 'selected', optionId: 'reject-once' })).toBe('deny');
    expect(decisionFor({ outcome: 'cancelled' })).toBe('deny');
    expect(decisionFor(undefined)).toBe('deny');
  });

  const seat = (clientHandlers) => {
    const updates = [];
    const { agent, client, hangUp } = pair({}, { 'session/update': (p) => { updates.push(p.update); }, ...clientHandlers });
    const connection = createPortalConnection({ ws: null, walletAddress: '0x0000000000000000000000000000000000000001' });
    connection.companion = { name: 'Proof', neumaId: 'acp-proof-lane' };
    connection.ws = createAcpPortal({ wire: agent, sessionId: 's1', connection, resolveToolApproval, settleOperatorAsk });
    return { updates, connection, client, hangUp };
  };
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 60); });

  test('speech streams as message chunks; a tool runs as one call from start to finish', async () => {
    const { updates, connection, hangUp } = seat();
    const ws = connection.ws;
    ws.send(JSON.stringify({ type: 'consciousness:stream', content: 'Reading it now. ' }));
    ws.send(JSON.stringify({ type: 'tool:usage', tool: 'fs/read', status: 'executing', summary: 'read src/a.js' }));
    ws.send(JSON.stringify({ type: 'tool:usage', tool: 'fs/read', status: 'ok', summary: 'read src/a.js' }));
    ws.send(JSON.stringify({ type: 'tool:usage', tool: 'coding/execute', status: 'error', summary: 'npm test → exit 1' }));
    ws.send(JSON.stringify({ type: 'consciousness:complete', sessionId: 'rec-1' }));
    await settle();
    expect(updates).toEqual([
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reading it now. ' } },
      { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'read src/a.js', kind: 'read', status: 'in_progress' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'in_progress', title: 'read src/a.js' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'read src/a.js' } }] },
      // A tool that only reports its end is still one call, opened and closed.
      { sessionUpdate: 'tool_call', toolCallId: 'call-2', title: 'npm test → exit 1', kind: 'execute', status: 'failed' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-2', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'npm test → exit 1' } }] },
    ]);
    expect(ws.state).toMatchObject({ acts: 2, completed: true, sessionId: 'rec-1' });
    hangUp();
  });

  test('the real approval gate asks the editor, and the editor\'s "allow once" lets the act through', async () => {
    const asked = [];
    const { updates, connection, hangUp } = seat({
      'session/request_permission': (p) => { asked.push(p); return { outcome: { outcome: 'selected', optionId: 'allow-once' } }; },
    });
    const decision = await requestToolApproval(connection, { tool: 'fs/write', args: { path: '/proof/a.js', content: 'x' } });
    expect(decision).toBe('allow');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      sessionId: 's1',
      toolCall: { toolCallId: 'call-1', title: 'fs/write', kind: 'edit', status: 'pending' },
    });
    expect(asked[0].toolCall.rawInput).toMatchObject({ path: '/proof/a.js' });
    expect(asked[0].options.map((o) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
    // The act that follows runs under the call the editor approved.
    connection.ws.send(JSON.stringify({ type: 'tool:usage', tool: 'fs/write', status: 'ok', summary: 'wrote /proof/a.js' }));
    await settle();
    expect(updates.at(-1)).toMatchObject({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' });
    hangUp();
  });

  test('"allow for this session" is the gate\'s ALWAYS; a reject, a cancel and a broken editor are all a no', async () => {
    const answers = [
      { outcome: { outcome: 'selected', optionId: 'allow-always' } },
      { outcome: { outcome: 'selected', optionId: 'reject-once' } },
      { outcome: { outcome: 'cancelled' } },
    ];
    const { updates, connection, hangUp } = seat({
      'session/request_permission': () => {
        const next = answers.shift();
        if (!next) throw new Error('the editor fell over');
        return next;
      },
    });
    const ask = () => requestToolApproval(connection, { tool: 'fs/delete', args: { path: '/proof/b.js' } });
    expect(await ask()).toBe('always');
    expect(await ask()).toBe('deny');
    expect(await ask()).toBe('deny');
    expect(await ask()).toBe('deny');
    await settle();
    const refused = updates.filter((u) => u.status === 'failed');
    expect(refused).toHaveLength(3);
    hangUp();
  });
});

describe('promptText', () => {
  test('text, an attached file and a link become the turn\'s words', () => {
    expect(promptText([
      { type: 'text', text: 'fix the bug in' },
      { type: 'resource', resource: { uri: 'file:///p/a.js', mimeType: 'text/javascript', text: 'let x = 1' } },
      { type: 'resource_link', uri: 'file:///p/b.js', name: 'b.js' },
      { type: 'resource', resource: { uri: 'file:///p/c.png', blob: 'AAAA' } },
      { type: 'image', data: 'AAAA' },
    ])).toBe([
      'fix the bug in',
      'Attached file:///p/a.js:\n```\nlet x = 1\n```',
      'See file:///p/b.js (b.js)',
      'Attached file:///p/c.png (not text — read it yourself if you need it)',
    ].join('\n\n'));
    expect(promptText(null)).toBe('');
  });
});

// ── the real program ────────────────────────────────────────────────────────
const CLI = new URL('../../bin/neuma', import.meta.url).pathname;
const LANE_ID = 'neuma-acp-proof';
let root;
let workspacesRoot;
let ground;
let previousRoot;
let env;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-acp-'));
  workspacesRoot = path.join(root, 'workspaces');
  ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(workspacesRoot);
  await neumaWorkspace.create(LANE_ID);
  const operator = Wallet.createRandom();
  await fs.writeFile(path.join(workspacesRoot, LANE_ID, 'owner.json'), `${JSON.stringify({
    wallet: operator.address, claimedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  const walletEnv = path.join(root, 'operator.env');
  await fs.writeFile(walletEnv, `OPERATOR_WALLET_PRIVATE_KEY=${operator.privateKey}\n`, { mode: 0o600 });
  execFileSync('git', ['init', '-q'], { cwd: ground });
  env = {
    ...process.env,
    NODE_ENV: 'test',
    AUTH_SECRET: 'acp-proof-secret',
    DNA_ENCRYPTION_KEY: 'acp-proof-key-material',
    LLM_PROVIDER: 'lm-studio',
    LLM_MODEL: 'offline-neuma-proof',
    LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
    NEUMA_WEB_ACCESS: '0',
    NEUMA_WALLET_ENV: walletEnv,
    WORKSPACES_ROOT: workspacesRoot,
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'ai-witnesses'),
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_VAULT_ROOT: path.join(root, 'vault'),
    NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
  };
});

afterEach(async () => {
  setWorkspacesRoot(previousRoot);
  await fs.rm(root, { recursive: true, force: true });
});

// An editor, minimal: launches the agent, sends requests, collects every line it prints.
const editor = (args = ['--workspace', LANE_ID]) => {
  const child = spawn('node', [CLI, 'acp', ...args], { cwd: ground, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  const raw = [];
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  readline.createInterface({ input: child.stdout }).on('line', (line) => { raw.push(line); lines.push(JSON.parse(line)); });
  let id = 0;
  const waitFor = async (check, ms = 45_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = lines.find(check);
      if (hit) return hit;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    throw new Error(`no such message; stderr:\n${err}\nlines:\n${raw.join('\n')}`);
  };
  const call = async (method, params) => {
    id += 1;
    const mine = id;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: mine, method, params })}\n`);
    return waitFor((m) => m.id === mine && !('method' in m));
  };
  const exited = new Promise((resolve) => { child.on('close', resolve); });
  return { child, lines, raw, call, waitFor, stderr: () => err, close: async () => { child.stdin.end(); return exited; } };
};

describe('neuma acp — the real program, spoken to as an editor speaks', () => {
  test('initialize, a session in the project, a prompt that reaches the being, and a clean exit', async () => {
    const e = editor();
    const init = await e.call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'proof', version: '1' } });
    expect(init.result).toMatchObject({ protocolVersion: 1, agentInfo: { name: 'neuma' }, agentCapabilities: { loadSession: false } });

    const made = await e.call('session/new', { cwd: ground, mcpServers: [] });
    expect(made.error, e.stderr()).toBeUndefined();
    const { sessionId } = made.result;
    expect(sessionId).toMatch(/^neuma-/);
    expect(made.result.modes).toEqual({ currentModeId: 'ask', availableModes: expect.arrayContaining([expect.objectContaining({ id: 'read' })]) });

    const turn = await e.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'say hello' }] });
    expect(turn.result, JSON.stringify(turn)).toEqual({ stopReason: 'end_turn' });
    // The DNA-less lane's refusal came back as the being's words, over ACP.
    const said = e.lines.filter((m) => m.method === 'session/update' && m.params.update.sessionUpdate === 'agent_message_chunk')
      .map((m) => m.params.update.content.text).join('');
    expect(said).toContain("This being's identity could not be loaded");

    expect(await e.close()).toBe(0);
    // Every line the program printed was one protocol message.
    expect(e.raw.every((line) => JSON.parse(line).jsonrpc === '2.0')).toBe(true);
  }, 90_000);

  test('modes switch and are announced; bad sessions, folders and prompts are refused in words', async () => {
    const e = editor();
    await e.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const { result: { sessionId } } = await e.call('session/new', { cwd: ground, mcpServers: [] });

    const mode = await e.call('session/set_mode', { sessionId, modeId: 'read' });
    expect(mode.result).toEqual({});
    await e.waitFor((m) => m.method === 'session/update' && m.params.update.sessionUpdate === 'current_mode_update' && m.params.update.currentModeId === 'read');
    expect((await e.call('session/set_mode', { sessionId, modeId: 'yolo' })).error.message).toContain('no mode yolo');

    expect((await e.call('session/new', { cwd: 'relative/dir', mcpServers: [] })).error.message).toContain('absolute');
    expect((await e.call('session/new', { cwd: path.join(root, 'missing'), mcpServers: [] })).error.message).toContain('not a folder');
    expect((await e.call('session/prompt', { sessionId: 'nope', prompt: [] })).error.message).toContain('no session nope');
    expect((await e.call('session/prompt', { sessionId, prompt: [{ type: 'image', data: 'AA' }] })).error.message).toContain('no words');
    // A cancel with nothing running is harmless and unanswered.
    e.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })}\n`);
    expect(await e.close()).toBe(0);
  }, 90_000);

  test('with no being named and none to choose alone, the session is refused with what to do', async () => {
    await neumaWorkspace.create('neuma-acp-second');
    const e = editor([]);
    await e.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const made = await e.call('session/new', { cwd: ground, mcpServers: [] });
    expect(made.error.message).toContain('name one: neuma acp --workspace <name>');
    expect(await e.close()).toBe(0);
  }, 90_000);
});
