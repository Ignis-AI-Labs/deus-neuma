/**
 * SHADOW CLONE (RULE 0) — Design note, 2026-11-16: […]
 *
 * Real turns: the real turn engine (runMemberTurn → streamConsciousness), the real sandbox and
 * filesystem server, real disk, the real model line, and a REAL OpenAI-compatible server on
 * loopback (test/helpers/local-provider.js — a real dependency configured for testing; it answers
 * each clone from its own request, slowly enough that the clones overlap). Nothing mocked.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const WALLET = '0x5555555555555555555555555555555555555556';
const BEING = 'kaito';
const PARTS = ['alpha', 'beta', 'gamma'];

describe('a being splits into shadow clones of itself — real turns, at once, reports back', () => {
  let provider, httpServer, wss, serverWs, client, frames, prevRealm, saved, arena;
  let handleShadowClone, cloneTasksOf, splitSettled, pendingFor, watchThought, platformToolsFor, setRealmRoot, setWorkspacesRoot, neumaWorkspace;

  beforeAll(async () => {
    const root = await createTempDir('shadow-clone');
    saved = { ...process.env };
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    const realm = await import('../../backend/services/user-realm.js');
    setRealmRoot = realm.setRealmRoot;
    prevRealm = realm.getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    const ws = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot = ws.setWorkspacesRoot;
    neumaWorkspace = ws.default;
    setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    const { writeOwner } = await import('../helpers/audit-auth.js');
    await neumaWorkspace.create(BEING);
    await writeOwner(path.dirname(neumaWorkspace.pathFor(BEING)), BEING, WALLET);
    await neumaWorkspace.writeDNA(BEING, { version: '1.0.0', identity: { name: 'Kaito' }, genesis: '# Essence\nI am Kaito.' });
    arena = path.join(root, 'arena');
    await fs.mkdir(arena, { recursive: true });
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    await connectFilesystemServer();

    // Each clone is answered from its own request: its first round writes its part's file (held
    // back 400ms, so the clones are all mid-work at once), its next reports what it did.
    const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;
    provider = await startLocalProvider({
      respond: (body) => {
        const messages = body.messages || [];
        const all = JSON.stringify(messages);
        const part = PARTS.find((p) => all.includes(`YOUR TASK: write ${p}.md`));
        if (!part) return null;
        // Its write already went out (the call stands in its own history): now it reports.
        const acted = messages.some((m) => m.role === 'assistant' && (String(m.content || '').includes('[TOOL:') || m.tool_calls?.length));
        if (acted) return { reply: `I wrote ${part}.md in the arena. Nothing needs the operator.` };
        return { reply: call('fs/write', { path: path.join(arena, `${part}.md`), content: `${part.toUpperCase()} WRITTEN BY A CLONE` }), delayMs: 400 };
      },
    });
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });
    ({ handleShadowClone, cloneTasksOf, splitSettled } = await import('../../backend/services/shadow-clone.js'));
    ({ pendingFor } = await import('../../backend/services/chat-watch.js'));
    ({ watchThought } = await import('../../backend/routes/portal-watch-delivery.js'));
    ({ platformToolsFor } = await import('../../backend/services/portal-tool-catalog.js'));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((r) => httpServer.listen(0, () => r(httpServer.address().port)));
    const linked = new Promise((r) => { wss.on('connection', (s) => { serverWs = s; r(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    frames = [];
    client.on('message', (d) => frames.push(JSON.parse(d.toString())));
    await linked;
  }, 60000);

  afterAll(async () => {
    setWorkspacesRoot?.(null);
    setRealmRoot?.(prevRealm);
    client?.close();
    wss?.close();
    httpServer?.close();
    await provider?.close();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  const original = (over = {}) => ({
    ws: serverWs, companion: { name: 'Kaito', neumaId: BEING }, walletAddress: WALLET,
    toolMode: 'auto', _grantedWriteRoots: [arena], ...over,
  });

  const SPLIT_ARGS = () => ({
    tasks: PARTS.map((p) => ({ title: `write ${p}.md`, task: `Write ${p}.md in the arena (${arena}), then report.` })),
    shared: 'The arena is the folder your operator granted you.',
  });

  test('from the operator\'s chat they work in the background: the call returns at once, the reports come back as a turn', async () => {
    const from = frames.length;
    const before = await fs.readdir(path.join(neumaWorkspace.pathFor(BEING), 'sessions')).catch(() => []);
    const result = await handleShadowClone(original({ sessionId: 'chat-with-operator' }), SPLIT_ARGS());
    expect(result.status, result.error).toBe('ok');
    // The original is free at once: told they work in the background and to carry on, not to wait.
    expect(result.content).toMatch(/^Your 3 shadow clones are working in the background: 1\. write alpha\.md; 2\. write beta\.md; 3\. write gamma\.md\. Carry on with your operator — do not wait for them/);
    expect(result.content).toContain('this chat is given a new turn with every report');
    const chips = () => frames.slice(from).filter((f) => f.type === 'tool:usage' && f.tool === 'team/shadow_clone');
    for (let i = 0; i < 100 && chips().length < 2; i += 1) await new Promise((r) => { setTimeout(r, 20); }); // the socket delivers in its own time
    const chip = chips();
    expect(chip.map((f) => f.status)).toEqual(['executing', 'ok']);
    expect(chip[1].summary).toBe('3 shadow clones working in the background — they report back in this chat when done');
    expect(chip[1].split).toMatchObject({ background: true, seconds: null });
    const split = frames.slice(from).find((f) => f.type === 'clone:split');
    expect(chip[1].split.splitId).toBe(split.splitId);
    // Nothing of their work has happened yet when the call returns.
    expect(frames.slice(from).some((f) => f.type === 'clone:end')).toBe(false);

    // …then they finish on their own, and the chat is told: a watch fired with every report, kept for the chat.
    await splitSettled(split.splitId);
    for (const part of PARTS) {
      expect(await fs.readFile(path.join(arena, `${part}.md`), 'utf8')).toBe(`${part.toUpperCase()} WRITTEN BY A CLONE`);
    }
    const done = frames.slice(from).find((f) => f.type === 'clone:done');
    expect(done).toMatchObject({ splitId: split.splitId, together: 3, record: expect.stringMatching(/^clones\//) });
    const [watch] = await pendingFor({ wallet: WALLET, laneId: BEING, sessionId: 'chat-with-operator' });
    expect(watch).toMatchObject({ kind: 'clones', ref: split.splitId, label: '3 shadow clones' });
    expect(watch.report).toMatch(/^3 clone\(s\) reported in \d+s \(3 at once at most\)/);
    for (const part of PARTS) expect(watch.report).toContain(`I wrote ${part}.md in the arena.`);
    expect(watchThought(watch)).toMatch(/^\[A WATCH YOU SET — the platform reporting, not your operator\] Word from your 3 shadow clones working in the background: 3 clone\(s\) reported/);
    const after = await fs.readdir(path.join(neumaWorkspace.pathFor(BEING), 'sessions'));
    expect(after.length - before.length).toBe(3);
  }, 60000);

  test('from a wake or a team part, three clones work at once with the original\'s reach, and every report comes back in the call', async () => {
    const { withLease } = await import('../../backend/services/substrate-lease.js');
    const before = await fs.readdir(path.join(neumaWorkspace.pathFor(BEING), 'sessions')).catch(() => []);
    frames.length = 0;
    const result = await withLease({ kind: 'member', label: 'a wake of Kaito', neumaId: BEING }, () => handleShadowClone(original(), SPLIT_ARGS()));
    expect(result.status, result.error).toBe('ok');

    // Each clone's own hands: its file is on disk, in the folder granted to the ORIGINAL.
    for (const part of PARTS) {
      expect(await fs.readFile(path.join(arena, `${part}.md`), 'utf8')).toBe(`${part.toUpperCase()} WRITTEN BY A CLONE`);
    }
    // Every report comes back to the original, and they worked side by side.
    expect(result.content).toMatch(/^3 clone\(s\) reported in \d+s \(3 at once at most\)/);
    for (const part of PARTS) expect(result.content).toContain(`I wrote ${part}.md in the arena.`);
    // Each clone sat in a sitting of its own, in the being's own lane; the whole record is kept.
    const after = await fs.readdir(path.join(neumaWorkspace.pathFor(BEING), 'sessions'));
    expect(after.length - before.length).toBe(3);
    const records = (await fs.readdir(path.join(neumaWorkspace.pathFor(BEING), 'clones'))).sort();
    expect(records).toHaveLength(2); // the background split's record, then this one's
    const record = await fs.readFile(path.join(neumaWorkspace.pathFor(BEING), 'clones', records.at(-1)), 'utf8');
    for (const part of PARTS) expect(record).toContain(`## Clone ${PARTS.indexOf(part) + 1}: write ${part}.md`);
    // The operator saw the split and its end.
    const chips = frames.filter((f) => f.type === 'tool:usage' && f.tool === 'team/shadow_clone');
    expect(chips.map((f) => f.status)).toEqual(['executing', 'ok']);
    expect(chips[1].summary).toMatch(/^3 of 3 shadow clones reported · 3 at once · \d+s$/);

    // …and each clone in its own sub-channel, live: the split, each place, each act, each word, each end.
    const split = frames.find((f) => f.type === 'clone:split');
    expect(split.clones.map((c) => c.title)).toEqual(PARTS.map((p) => `write ${p}.md`));
    const of = (type, index) => frames.filter((f) => f.type === type && f.splitId === split.splitId && (f.index ?? f.clone?.index) === index);
    for (const [i, part] of PARTS.entries()) {
      expect(of('clone:state', i + 1).some((f) => f.state === 'working')).toBe(true);
      expect(of('clone:tool', i + 1).some((f) => f.act.tool.includes('write') && f.act.status !== 'executing')).toBe(true);
      expect(of('clone:text', i + 1).map((f) => f.chunk).join('')).toContain(`I wrote ${part}.md in the arena.`);
      expect(of('clone:end', i + 1)[0].clone).toMatchObject({ index: i + 1, state: 'done', report: `I wrote ${part}.md in the arena. Nothing needs the operator.` });
    }
    // The chip's record keeps every clone's report and acts, so a reopened chat draws them again.
    expect(chips[1].split.splitId).toBe(split.splitId);
    expect(chips[1].split.clones.map((c) => [c.index, c.state, c.acts.length > 0, Boolean(c.sessionId)])).toEqual([[1, 'done', true, true], [2, 'done', true, true], [3, 'done', true, true]]);
  }, 60000);

  test('one task is the being\'s own; a clone never splits again; the tool is offered only to the original', async () => {
    expect((await handleShadowClone(original(), { tasks: ['just one thing'] })).error).toContain('one task is yours to work yourself');
    expect((await handleShadowClone(original({ _shadowClone: true }), { tasks: ['a', 'b'] })).error).toContain('does not split again');
    expect(cloneTasksOf({ tasks: Array.from({ length: 17 }, (_, i) => `t${i}`) }).error).toContain('At most 16');

    const names = async (conn) => (await platformToolsFor(conn)).tools.map((t) => t.name);
    expect(await names(original())).toContain('shadow_clone');
    expect(await names(original({ _shadowClone: true, _teamMember: true }))).not.toContain('shadow_clone');
  }, 30000);
});
