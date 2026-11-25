/**
 * THE TURN KEPT AS IT GOES (RULE 0) — Design note, 2026-11-16: […]
 *
 * Real: signed auth, the real portal socket and handlers, real encrypted lanes on temp disk, a real
 * loopback OpenAI-wire provider, the real filesystem organ — and for the crash, a real backend
 * process SIGKILLed mid-turn and a real next start over its disk. Nothing mocked.
 *
 * Under proof:
 *  - a desk that closes mid-turn loses nothing: the turn runs on, its words and acts are on disk
 *    (encrypted) a second behind, and the desk that opens the chat is drawn the turn so far, then
 *    the live rest, and the settle; the record has the whole answer and the kept file goes;
 *  - STOP from the desk that took the turn over cuts it;
 *  - a backend killed mid-turn: the next start puts the turn on the record as the take it was —
 *    words as far as they got, the act it did, marked cut — once, and the desk offers CONTINUE;
 *  - CONTINUE: the platform's line opens a turn whose transcript carries the cut take.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { openPortalTurnKit, lastUserText } from '../helpers/portal-turn-kit.js';
import { freshKept, foldFrame, keptSnapshot, CUT_MARK } from '../../backend/services/turn-keep-record.js';
import { settleCutTurn } from '../../backend/services/turn-keep.js';
import { INTERRUPT_MARK } from '../../backend/services/portal-turn-input.js';

const BEING = 'keepbeing';
const CHILD = fileURLToPath(new URL('../helpers/turn-keep-crash-process.mjs', import.meta.url));
let kit;
let lists;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'turn-keep', beings: [{ id: BEING, name: 'Keeper' }] });
  lists = path.join(kit.workspace.pathFor(BEING), 'lists.md'); // the being's own ground: a read with no card
  await fs.writeFile(lists, '# The four lists\n');
  const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
  await connectFilesystemServer();
}, 30000);
afterAll(async () => {
  const { mcpService } = await import('../../backend/services/mcp.js');
  await mcpService.disconnect('filesystem').catch(() => {});
  await kit?.close();
});

const keptFile = (sessionId) => path.join(kit.workspace.pathFor(BEING), 'turn-keep', `${sessionId}.json`);
const exists = (file) => fs.access(file).then(() => true, () => false);
const readTool = () => `[TOOL: fs/read ${JSON.stringify({ path: lists })}]`;

// impure — a desk that manifests the being, asks, and is mid-turn: round one said and did, round two out.
const deskMidTurn = async (secondRound) => {
  const desk = await kit.openChat();
  await desk.sendAndWait({ type: 'companion:manifest', companion: 'Keeper', neumaId: BEING }, 'companion:anchored');
  kit.provider.setScript([{ reply: ['Gathering the four lists. ', 'First the folder. ', readTool()] }, secondRound]); // (clears the turn log)
  desk.ws.send(JSON.stringify({ type: 'consciousness:stream', thought: 'Gather the four lists.' }));
  await desk.untilFrame((f) => f.type === 'tool:usage' && f.status !== 'executing', { ms: 20000 });
  await kit.until(() => kit.provider.turns.length >= 2);
  const [sessionId] = await kit.workspace.listSessions(BEING);
  return { desk, sessionId };
};
const closeDesk = (desk) => new Promise((resolve) => { desk.ws.once('close', resolve); desk.ws.close(); });

describe('a desk that closes mid-turn loses nothing', () => {
  test('the turn runs on, kept on disk; the desk that opens the chat sees it so far, then live', async () => {
    const { desk, sessionId } = await deskMidTurn({ reply: ['The lists are gathered.'], delayMs: 3000 });
    await closeDesk(desk);

    // On disk, a second behind at most — encrypted at rest.
    const snap = await kit.until(async () => {
      const s = await kit.workspace._readJSON(keptFile(sessionId)).catch(() => null);
      return s?.tools?.length ? s : null;
    });
    expect(snap.words).toContain('Gathering the four lists. First the folder.');
    expect(snap.tools[0].tool).toBe('fs/read');
    expect(await fs.readFile(keptFile(sessionId), 'utf8')).not.toContain('First the folder');

    // Another desk opens the chat while the turn still runs.
    const back = await kit.openChat();
    const from = back.frames.length;
    back.ws.send(JSON.stringify({ type: 'portal:resume', neumaId: BEING, companionName: 'Keeper', sessionId }));
    await back.untilFrame((f) => f.type === 'portal:resumed', { from });
    const caught = await back.untilFrame((f) => f.catchUp && f.type === 'consciousness:stream', { from });
    expect(caught.content).toContain('Gathering the four lists. First the folder.');
    expect(caught.turnId).toBe(snap.turnId);
    expect(back.frames.slice(from).some((f) => f.catchUp && f.type === 'tool:usage' && f.tool === 'fs/read' && f.status !== 'executing')).toBe(true);

    // …then live: round two's words, and the settle.
    const settled = await back.untilFrame((f) => f.type === 'consciousness:complete', { from, ms: 20000 });
    expect(settled.sessionId).toBe(sessionId);
    expect(back.frames.slice(from).some((f) => !f.catchUp && f.type === 'consciousness:stream' && f.content.includes('The lists are gathered.'))).toBe(true);
    const answer = (await kit.workspace.readSession(BEING, sessionId)).at(-1);
    expect(answer).toMatchObject({ role: 'assistant', turnId: snap.turnId, takeIndex: 1 });
    expect(answer.content).toContain('First the folder.');
    expect(answer.content).toContain('The lists are gathered.');
    expect(answer.tools[0].tool).toBe('fs/read');
    expect(answer.cutOff).toBeUndefined();
    await kit.until(async () => !(await exists(keptFile(sessionId))));
    await closeDesk(back);
  }, 60000);

  test('STOP from the desk that took the turn over cuts it', async () => {
    const { desk, sessionId } = await deskMidTurn({ reply: ['never said'], delayMs: 20000 });
    await closeDesk(desk);
    const back = await kit.openChat();
    const from = back.frames.length;
    back.ws.send(JSON.stringify({ type: 'portal:resume', neumaId: BEING, companionName: 'Keeper', sessionId }));
    await back.untilFrame((f) => f.catchUp && f.type === 'consciousness:stream', { from });
    back.ws.send(JSON.stringify({ type: 'consciousness:interrupt' }));
    const cut = await back.untilFrame((f) => f.type === 'consciousness:complete', { from, ms: 10000 });
    expect(cut.metadata?.interrupted).toBe(true);
    const answer = (await kit.workspace.readSession(BEING, sessionId)).at(-1);
    expect(answer.content).toContain('First the folder.');
    expect(answer.content.endsWith(INTERRUPT_MARK)).toBe(true);
    await kit.until(async () => !(await exists(keptFile(sessionId))));
    await closeDesk(back);
  }, 60000);
});

// impure — the child's tagged line, or its death.
const lineOf = (child, tag, ms) => new Promise((resolve, reject) => {
  let out = '';
  let err = '';
  const timer = setTimeout(() => reject(new Error(`no ${tag} within ${ms}ms\n${err.slice(-2000)}`)), ms);
  child.stdout.on('data', (d) => {
    out += d;
    const line = out.split('\n').find((l) => l.startsWith(`${tag} `));
    if (line) { clearTimeout(timer); resolve(JSON.parse(line.slice(tag.length + 1))); }
  });
  child.stderr.on('data', (d) => { err += d; });
  child.on('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`child exited ${code ?? signal} before ${tag}\n${err.slice(-2000)}`)); });
});

describe('a backend that dies mid-turn', () => {
  test('the next start puts the turn on the record as the take it was — once — and CONTINUE is offered', async () => {
    const box = await fs.mkdtemp(path.join(os.tmpdir(), 'turn-keep-crash-'));
    const cwd = path.join(box, 'empty'); // the child reads no .env (test/setup.js's dotenv law)
    await fs.mkdir(cwd);
    const env = { ...process.env, TMPDIR: box, HOME: path.join(box, 'home'), LLAMA_SERVER_URL: 'http://127.0.0.1:9', NEUMA_CHAIN_ACCESS: '0' };
    try {
      const run = spawn(process.execPath, [CHILD, 'run', 'turn-keep-crash'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const kept = await lineOf(run, 'KEPT', 60000);
      run.kill('SIGKILL'); // no settle, no cleanup: the power went
      await new Promise((resolve) => { run.once('exit', resolve); });

      const start = spawn(process.execPath, [CHILD, 'start', kept.house, kept.lane, kept.sessionId],
        { cwd, env: { ...env, DNA_ENCRYPTION_KEY: kept.key, WORKSPACES_ROOT: kept.house }, stdio: ['ignore', 'pipe', 'pipe'] });
      const after = await lineOf(start, 'LANDED', 60000);
      expect(after.landed).toBe(1);
      expect(after.again).toBe(0);
      expect(after.fileLeft).toBe(false);

      const [ask, take] = after.record;
      expect(ask).toMatchObject({ role: 'user', content: 'Gather the four lists for me.' });
      expect(take).toMatchObject({ role: 'assistant', turnId: ask.turnId, takeIndex: 1 });
      expect(take.content).toContain('Gathering the four lists now. First I look at the folder.');
      expect(take.content.endsWith(CUT_MARK)).toBe(true);
      expect(take.tools[0].tool).toBe('fs/read');
      expect(Date.parse(take.cutOff.at)).toBeGreaterThan(0);
      expect(after.display.at(-1).takes[0].cutOff.at).toBe(take.cutOff.at);
    } finally {
      await fs.rm(box, { recursive: true, force: true });
    }
  }, 150000);
});

describe('CONTINUE picks a cut take up where it stopped', () => {
  test('the platform\'s line opens a turn whose transcript carries the cut take; only a cut take answers', async () => {
    const desk = await kit.openChat();
    await desk.sendAndWait({ type: 'companion:manifest', companion: 'Keeper', neumaId: BEING }, 'companion:anchored');
    kit.provider.setScript([{ reply: 'A first answer.' }]);
    const first = await desk.sendAndWait({ type: 'consciousness:stream', thought: 'Open the chat.' }, 'consciousness:complete');
    const { sessionId } = first;

    // A turn the app's close cut here, kept by the keeper's own fold and lands at the chat's next read.
    await kit.workspace.appendTurnPoint(BEING, sessionId, { role: 'user', content: 'Gather the four lists.' }, 'cut-point');
    const folded = [{ type: 'consciousness:stream', content: 'Two of the four lists are in. ' }]
      .reduce(foldFrame, freshKept({ neumaId: BEING, sessionId, take: { turnId: 'cut-point', takeIndex: 1 }, startedAt: new Date().toISOString() }));
    await kit.workspace._writeJSON(keptFile(sessionId), keptSnapshot(folded, {
      tools: [{ tool: 'fs/read', status: 'ok', summary: 'read lists.md', mark: 10 }], savedAt: new Date().toISOString(),
    }));
    expect(await settleCutTurn(BEING, sessionId)).toMatchObject({ turnId: 'cut-point', takeIndex: 1, cutOff: expect.any(Object) });

    await desk.sendAndWait({ type: 'portal:resume', neumaId: BEING, companionName: 'Keeper', sessionId }, 'portal:resumed');
    // Not a cut take: nothing runs.
    kit.provider.setScript([{ reply: 'Picking up: the other two lists are in too.' }]); // (clears the turn log)
    desk.ws.send(JSON.stringify({ type: 'consciousness:continue', turnId: first.turnId }));
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    expect(kit.provider.turns.length).toBe(0);

    const from = desk.frames.length;
    desk.ws.send(JSON.stringify({ type: 'consciousness:continue', turnId: 'cut-point' }));
    const line = await desk.untilFrame((f) => f.type === 'turn:continued', { from });
    expect(line.text).toMatch(/^\[THE APP CLOSED MID-REPLY — the platform, not your operator\]/);
    await desk.untilFrame((f) => f.type === 'consciousness:complete', { from, ms: 20000 });
    const body = kit.provider.turns.find((turn) => lastUserText(turn).includes('Pick up exactly where you stopped'));
    expect(JSON.stringify(body.messages)).toContain('Two of the four lists are in.');
    expect(JSON.stringify(body.messages)).toContain(CUT_MARK);
    expect(lastUserText(body)).toContain('Pick up exactly where you stopped');
    const rows = await kit.workspace.readSession(BEING, sessionId);
    expect(rows.filter((r) => r.role === 'user').at(-1)).toMatchObject({ origin: 'resume' });
    expect(rows.at(-1).content).toContain('the other two lists are in too');
    await closeDesk(desk);
  }, 60000);
});
