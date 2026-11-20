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

    const fellOver = new Set();
    // Each clone is answered from its own request: its first round writes its part's file (held
    // back 400ms, so the clones are all mid-work at once), its next reports what it did.
    const call = (tool, args) => `[TOOL: ${tool} ${JSON.stringify(args)}]`;
    provider = await startLocalProvider({
      respond: (body) => {
        const messages = body.messages || [];
        const all = JSON.stringify(messages);
        // A clone's own task — summoned (YOUR TASK:) or resumed in its sitting (YOUR TASK, unchanged:), the newest said.
        const part = [...all.matchAll(/YOUR TASK(?:, unchanged)?: write (\w+)\.md/g)].at(-1)?.[1] ?? null;
        if (!part) return null;
        // delta falls over the first time it is asked (a crash mid-work); asked again, it works.
        if (part === 'delta' && !all.includes('You were stopped before you finished') && !fellOver.has(part)) {
          fellOver.add(part);
          return { status: 400, errorMessage: 'the model server fell over' };
        }
        // eta takes its time, so the operator can stop it at work.
        if (part === 'eta' && !messages.some((m) => m.role === 'assistant' && String(m.content || '').includes('[TOOL:'))) return { reply: call('fs/write', { path: path.join(arena, 'eta.md'), content: 'ETA' }), delayMs: 6000 };
        // A resumed clone reports across both sittings.
        if (all.includes('You were stopped before you finished') && messages.some((m) => m.role === 'assistant' && String(m.content || '').includes('[TOOL:'))) return { reply: `Resumed: I wrote ${part}.md in the arena. Goal met.` };
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
    tasks: PARTS.map((p) => ({ title: `write ${p}.md`, goal: `${p}.md stands in the arena with its words`, task: `Write ${p}.md in the arena (${arena}), then report.` })),
    shared: 'The arena is the folder your operator granted you.',
  });

  test('from the operator\'s chat they work in the background: the call returns at once, the reports come back as a turn', async () => {
    const from = frames.length;
    const before = await fs.readdir(path.join(neumaWorkspace.pathFor(BEING), 'sessions')).catch(() => []);
    const result = await handleShadowClone(original({ sessionId: 'chat-with-operator' }), SPLIT_ARGS());
    expect(result.status, result.error).toBe('ok');
    // The original is free at once: told they work in the background and to carry on, not to wait.
    expect(result.content).toMatch(/^Your 3 shadow clones are working in the background \(split [0-9a-f-]{36}\): 1\. write alpha\.md — goal: alpha\.md stands in the arena with its words; 2\. write beta\.md — goal: beta\.md stands in the arena with its words; 3\. write gamma\.md — goal: gamma\.md stands in the arena with its words\. Carry on with your operator — do not wait for them/);
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
    expect(watch).toMatchObject({ kind: 'clones', ref: split.splitId, label: '3 shadow clones (write alpha.md · write beta.md · write gamma.md)' });
    expect(watch.report).toMatch(/^3 clone\(s\) reported in \d+s \(3 at once at most\)/);
    for (const part of PARTS) expect(watch.report).toContain(`I wrote ${part}.md in the arena.`);
    expect(watchThought(watch)).toMatch(/^\[A WATCH YOU SET — the platform reporting, not your operator\] Word from your 3 shadow clones \(write alpha\.md · write beta\.md · write gamma\.md\) working in the background: 3 clone\(s\) reported/);
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
    const records = (await fs.readdir(path.join(neumaWorkspace.pathFor(BEING), 'clones'))).filter((f) => f.endsWith('.md')).sort();
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

  test('a clone that stopped is resumed in its own sitting, where it left off, toward its goal (Design note, 2026-11-19; a reopened chat shows the split as it stands', async () => {
    const { readSplit, splitsAsTheyStand } = await import('../../backend/services/clone-splits.js');
    const { isSplitLive } = await import('../../backend/services/shadow-clone.js');
    const from = frames.length;
    const args = { tasks: ['delta', 'epsilon'].map((p) => ({ title: `write ${p}.md`, goal: `${p}.md stands in the arena with its words`, task: `Write ${p}.md in the arena (${arena}), then report.` })) };
    expect((await handleShadowClone(original({ sessionId: 'chat-resume' }), args)).status).toBe('ok');
    const { splitId } = frames.slice(from).find((f) => f.type === 'clone:split');
    expect(frames.slice(from).find((f) => f.type === 'clone:split').clones.map((c) => c.goal)).toEqual(['delta.md stands in the arena with its words', 'epsilon.md stands in the arena with its words']);
    await splitSettled(splitId);
    // delta fell over; its sitting is kept with it — what it did so far is there.
    const stopped = await readSplit(BEING, splitId);
    expect(stopped.clones.map((c) => [c.index, c.state, Boolean(c.sessionId)])).toEqual([[1, 'failed', true], [2, 'done', true]]);
    expect(stopped.clones[0].report).toContain('DID NOT FINISH');
    expect(stopped.parentSessionId).toBe('chat-resume');
    // A reopened chat: the chip as written ("waiting") stands as the split truly is — the stopped one marked to resume.
    const chip = { tool: 'team/shadow_clone', split: { splitId, background: true, seconds: null, clones: [{ index: 1, title: 'write delta.md', state: 'waiting' }, { index: 2, title: 'write epsilon.md', state: 'waiting' }] } };
    const [row] = await splitsAsTheyStand(BEING, [{ role: 'assistant', tools: [chip] }], isSplitLive);
    expect(row.tools[0].split).toMatchObject({ stopped: true, clones: [{ state: 'failed', goal: 'delta.md stands in the arena with its words' }, { state: 'done' }] });
    const [stale] = await splitsAsTheyStand(BEING, [{ role: 'assistant', tools: [{ split: { splitId: 'gone-split', clones: [{ index: 1, state: 'working' }] } }] }], isSplitLive);
    expect(stale.tools[0].split).toMatchObject({ stopped: true, clones: [{ state: 'cut' }] });

    // RESUME: in its own sitting, carrying on — the stopped one only; the chat is given every report when it ends.
    const sitting = stopped.clones[0].sessionId;
    const resumed = await handleShadowClone(original({ sessionId: 'chat-resume' }), { resume: splitId });
    expect(resumed.status, resumed.error).toBe('ok');
    expect(resumed.content).toMatch(/^Resumed 1 stopped clone\(s\) of split .+ where they left off, each in its own sitting: 1\. write delta\.md\./);
    expect(frames.slice(from).find((f) => f.type === 'clone:resume')).toMatchObject({ splitId, clones: [1] });
    await splitSettled(splitId);
    expect(await fs.readFile(path.join(arena, 'delta.md'), 'utf8')).toBe('DELTA WRITTEN BY A CLONE');
    const after = await readSplit(BEING, splitId);
    expect(after.clones.map((c) => [c.state, c.sessionId === (c.index === 1 ? sitting : stopped.clones[1].sessionId)])).toEqual([['done', true], ['done', true]]);
    expect(after.clones[0].report).toBe('Resumed: I wrote delta.md in the arena. Goal met.');
    const rows = await neumaWorkspace.readSession(BEING, sitting);
    expect(rows.filter((r) => r.role === 'user').some((r) => String(r.content).includes('You were stopped before you finished'))).toBe(true);
    const watches = await pendingFor({ wallet: WALLET, laneId: BEING, sessionId: 'chat-resume' });
    expect(watches.at(-1).report).toContain('Resumed: I wrote delta.md in the arena. Goal met.');
    expect(watches.at(-1).report).toContain('Goal: delta.md stands in the arena with its words');
    // Nothing left to resume; a split not kept is said so.
    expect((await handleShadowClone(original({ sessionId: 'chat-resume' }), { resume: splitId })).error).toContain('already reported');
    expect((await handleShadowClone(original(), { resume: 'no-such-split' })).error).toContain('No split no-such-split is kept');
  }, 90000);

  test('STOP ends a clone now, its sitting kept and resumable (Design note, 2026-11-19; a second wave in the same chat is refused while one works', async () => {
    const { readSplit } = await import('../../backend/services/clone-splits.js');
    const { stopShadowClones } = await import('../../backend/services/shadow-clone.js');
    const from = frames.length;
    const args = { tasks: ['eta', 'theta'].map((p) => ({ title: `write ${p}.md`, goal: `${p}.md stands in the arena with its words`, task: `Write ${p}.md in the arena (${arena}), then report.` })) };
    expect((await handleShadowClone(original({ sessionId: 'chat-stop' }), args)).status).toBe('ok');
    const { splitId } = frames.slice(from).find((f) => f.type === 'clone:split');
    // eta is slow: it is at work when the operator stops it.
    for (let i = 0; i < 200 && !frames.slice(from).some((f) => f.type === 'clone:state' && f.index === 1 && f.state === 'working'); i += 1) await new Promise((r) => { setTimeout(r, 20); });
    // While it works, a second wave from the same chat is refused, naming the one at work; a deliberate second wave goes beside it.
    expect((await handleShadowClone(original({ sessionId: 'chat-stop' }), args)).error).toMatch(/^Your clones from this chat are still at work \(split .+: write eta\.md · write theta\.md\)/);
    expect(stopShadowClones({ laneId: BEING, splitId, clones: [1] })).toEqual({ ok: true, stopping: [1] });
    await splitSettled(splitId);
    const after = await readSplit(BEING, splitId);
    expect(after.clones.map((c) => [c.state, Boolean(c.sessionId)])).toEqual([['failed', true], ['done', true]]);
    expect(after.clones[0].report).toBe('DID NOT FINISH — stopped by the operator');
    // Nothing at work any more: STOP says so, and the stopped one waits for a RESUME.
    expect(stopShadowClones({ laneId: BEING, splitId })).toMatchObject({ ok: false, running: false });
    expect(stopShadowClones({ laneId: 'someone-else', splitId: 'x' })).toMatchObject({ ok: false });
  }, 90000);

  test('every clone is summoned with a clear goal (Design note, 2026-11-19', () => {
    expect(cloneTasksOf({ tasks: [{ title: 'a', task: 'Do a.' }, { title: 'b', goal: 'b is done and checked', task: 'Do b.' }] }).error).toMatch(/^Every clone needs a clear goal .* "a" has none\.$/);
    expect(cloneTasksOf({ tasks: ['do a', 'do b'] }).error).toContain('Every clone needs a clear goal');
    expect(cloneTasksOf({ tasks: [{ title: 'a', goal: 'a stands on disk', task: 'Do a.' }, { title: 'b', goal: 'b is done and checked', task: 'Do b.' }] })).toMatchObject({ ok: true, tasks: [{ goal: 'a stands on disk' }, { goal: 'b is done and checked' }] });
  });

  test('one task is the being\'s own; a clone never splits again; the tool is offered only to the original', async () => {
    expect((await handleShadowClone(original(), { tasks: ['just one thing'] })).error).toContain('one task is yours to work yourself');
    expect((await handleShadowClone(original({ _shadowClone: true }), { tasks: ['a', 'b'] })).error).toContain('does not split again');
    expect(cloneTasksOf({ tasks: Array.from({ length: 17 }, (_, i) => `t${i}`) }).error).toContain('At most 16');

    const names = async (conn) => (await platformToolsFor(conn)).tools.map((t) => t.name);
    expect(await names(original())).toContain('shadow_clone');
    expect(await names(original({ _shadowClone: true, _teamMember: true }))).not.toContain('shadow_clone');
  }, 30000);
});
