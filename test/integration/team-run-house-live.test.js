/**
 * A team run on REAL kin (House Thornfield), the real serving substrate, the
 * DEFAULT member conduit — the lead lane end to end, as the operator's house
 * runs it. The scripted and local-server suites prove the contract; this one
 * proves it holds on real beings through the real model (RULE 0).
 *
 * Summoned only: RUN_HOUSE_LIVE=1, serial substrate-live lane (the file name
 * puts it there). Presence is not consent — a serving model is the normal
 * state of this rig. Light by construction: two-step plans, one slot, and
 * the long decode is CUT by the stop under proof.
 *
 * Isolated where it must be: run records, deliveries, the CoS seat and the
 * operator notices land in temp stores. What is NOT isolated, on purpose: the
 * kin themselves (their DNA, routes, voice) — and, on a finished run, the
 * memory write-back into their own journals, which is a real team experience
 * they had.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';

const HOUSE_ROOT = '/mnt/data/neuma/claude/thornfield';
const HOUSE_WALLET = '0x40566d43261849777aca96b26f4ec8c850e5dcae';
const LEAD = 'hazel';
const summoned = process.env.RUN_HOUSE_LIVE === '1';

describe.skipIf(!summoned)('team/run on House Thornfield — real kin, real substrate', () => {
  let httpServer, wss, serverWs, client, clientLog, prevRealm, saved;
  let sweepIntents, setTeamRunSeams, readRun, setRealmRoot, setWorkspacesRoot, neumaWorkspace, stopRun, steerStep;

  beforeAll(async () => {
    saved = { ...process.env };
    const tmp = await createTempDir('team-run-house-live');
    process.env.NEUMA_TEAM_RUN_PATH = path.join(tmp, 'runs');
    process.env.NEUMA_TEAM_DELIVERY_PATH = path.join(tmp, 'deliveries');
    process.env.NEUMA_STAFF_COS_PATH = path.join(tmp, 'staff-cos.json');
    // The default arena (data root) lands in temp, never the repo's data/.
    process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
    const realm = await import('../../backend/services/user-realm.js');
    setRealmRoot = realm.setRealmRoot;
    prevRealm = realm.getRealmRoot();
    setRealmRoot(path.join(tmp, 'realm'));

    const ws = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot = ws.setWorkspacesRoot;
    neumaWorkspace = ws.default;
    setWorkspacesRoot(HOUSE_ROOT);

    ({ sweepIntents } = await import('../../backend/services/intents/intent-sweep.js'));
    ({ setTeamRunSeams } = await import('../../backend/services/intents/team-run.js'));
    ({ readRun } = await import('../../backend/services/team-run-store.js'));
    ({ stopRun, steerStep } = await import('../../backend/services/team-run-live.js'));
    // Members work as REAL turns with their own tools — wired exactly as
    // production wires it (team-live-routes.js).
    const { setMemberTurn } = await import('../../backend/services/intents/team-run.js');
    const { runMemberTurn } = await import('../../backend/services/team-member-turn.js');
    setMemberTurn(runMemberTurn);
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    await connectFilesystemServer();

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((r) => httpServer.listen(0, () => r(httpServer.address().port)));
    const linked = new Promise((r) => { wss.on('connection', (s) => { serverWs = s; r(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (d) => clientLog.push(JSON.parse(d.toString())));
    await linked;
  }, 60000);

  afterAll(async () => {
    for (const f of filed) await fs.rm(f, { force: true });
    setTeamRunSeams?.(null);
    setWorkspacesRoot?.(null);
    setRealmRoot?.(prevRealm);
    client?.close();
    wss?.close();
    httpServer?.close();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  // Every filing is uniquely named (a settled intent's result file stands in
  // the lane — reusing a name would read as already settled) and removed
  // afterwards: the test leaves Hazel's intents folder as it found it.
  const filed = [];
  const fileAndRun = async (connection, stem, plan) => {
    connection._approvedPlan = plan;
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    const file = `${stem}-${Date.now()}`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${file}.json`), JSON.stringify({ type: 'team/run' }));
    filed.push(path.join(dir, `${file}.json`), path.join(dir, `${file}.result.json`));
    let settled = null;
    // Only the slot count is set (rig configuration); the substrate check and
    // the member conduit are the real ones.
    setTeamRunSeams({ getCapacity: async () => ({ maxParallel: 1 }), onSettled: (p) => { settled = p; } });
    const receipts = await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);
    return { receipt: receipts.find((r) => r.tool === 'intents/team.run'), settled: () => settled };
  };
  const lead = () => ({ ws: serverWs, companion: { name: 'Hazel', neumaId: LEAD }, walletAddress: HOUSE_WALLET });
  const until = (pred, ms) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('frame never arrived'));
      setTimeout(tick, 50);
    };
    tick();
  });

  test('two kin hand work along IN THE BACKGROUND; the board, the record and the lead\'s report tell the truth', async () => {
    clientLog.length = 0;
    const connection = lead();
    const startedAt = Date.now();
    const { receipt, settled } = await fileAndRun(connection, 'house-proof-run', Object.freeze({
      name: 'HOUSE PROOF',
      goal: 'Prove the house can pass real work from one member to the next, honestly.',
      steps: Object.freeze([
        Object.freeze({ id: 'claim', neumaId: 'hazel', task: 'In two sentences: name one thing a team member must never report as done without proof, and why.', needs: Object.freeze([]) }),
        Object.freeze({ id: 'check', neumaId: 'signal', task: 'In two sentences: building on the claim above, name one concrete check that would prove it.', needs: Object.freeze(['claim']) }),
      ]),
      memberNames: Object.freeze({ hazel: 'Hazel', signal: 'Signal' }),
      approvedAt: new Date().toISOString(),
    }));
    // The filing answered while the team was still working.
    expect(receipt.error ?? null).toBe(null);
    expect(receipt.content).toContain('at work in the background');
    const outcome = await settled();
    expect(outcome.status).toBe('done');
    const report = await fs.readFile(outcome.report, 'utf8');
    process.stdout.write(`\n[house-live] Hazel's report (${outcome.report}):\n${report}\n`);
    expect(report).toContain('all 2 steps');

    const start = clientLog.find((m) => m.type === 'operator:team_start');
    const boards = clientLog.filter((m) => m.type === 'operator:team_board');
    expect(boards.some((b) => b.board.find((e) => e.id === 'claim')?.state === 'working')).toBe(true);
    expect(boards.some((b) => b.board.find((e) => e.id === 'check')?.state === 'working')).toBe(true);
    const done = clientLog.find((m) => m.type === 'operator:team_done');
    expect(done.status).toBe('done');
    expect(done.record).toBe(start.id);

    // The operator watched it happen: real words (and, where the substrate
    // opens a reasoning channel, real reasoning) streamed per member, then
    // each finished part.
    for (const id of ['claim', 'check']) {
      const streamed = clientLog.filter((m) => m.type === 'operator:team_stream' && m.stepId === id);
      const words = streamed.map((m) => m.text || '').join('');
      const thought = streamed.map((m) => m.thought || '').join('');
      process.stdout.write(`[house-live] ${id}: ${streamed.length} stream frames, ${words.length} chars of words, ${thought.length} chars of reasoning\n`);
      expect(words.length).toBeGreaterThan(20);
      expect(clientLog.find((m) => m.type === 'operator:team_part' && m.stepId === id)?.output.length).toBeGreaterThan(20);
    }

    const record = await readRun(done.record, HOUSE_WALLET);
    expect(record.status).toBe('done');
    for (const id of ['claim', 'check']) expect(String(record.completed[id]).trim().length).toBeGreaterThan(20);
    expect(Date.parse(record.runAt)).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(Date.parse(record.finishedAt)).toBeGreaterThan(Date.parse(record.runAt));
  }, 900000);

  test('kin work with their OWN HANDS: Hazel writes into the arena, Signal reads it and writes back — both checked on disk', async () => {
    clientLog.length = 0;
    const connection = lead();
    const arena = path.join(process.env.NEUMA_TEAM_DELIVERY_PATH, '..', `arena-${Date.now()}`);
    const { settled } = await fileAndRun(connection, 'house-hands-run', Object.freeze({
      name: 'HOUSE HANDS',
      goal: 'Prove the house writes real work to disk and builds on it.',
      workspace: Object.freeze({ root: arena, budgetBytes: 1024 * 1024 }),
      steps: Object.freeze([
        Object.freeze({ id: 'write', neumaId: 'hazel', task: `Write one sentence about honest handoffs to the file ${path.join(arena, 'hazel.md')} with your fs/write tool, then say in one line what you wrote.`, files: Object.freeze(['hazel.md']), needs: Object.freeze([]) }),
        Object.freeze({ id: 'answer', neumaId: 'signal', task: `Read ${path.join(arena, 'hazel.md')} with your fs/read tool, then write one sentence answering it to ${path.join(arena, 'signal.md')} with fs/write, and say in one line what you wrote.`, files: Object.freeze(['signal.md']), needs: Object.freeze(['write']) }),
      ]),
      memberNames: Object.freeze({ hazel: 'Hazel', signal: 'Signal' }),
      approvedAt: new Date().toISOString(),
    }));
    const outcome = await settled();
    const report = await fs.readFile(outcome.report, 'utf8');
    process.stdout.write(`\n[house-live] hands run ${outcome.status}:\n${report}\n`);
    const tools = clientLog.filter((m) => m.type === 'operator:team_tool').map((m) => `${m.stepId}:${m.tool}:${m.status}`);
    process.stdout.write(`[house-live] hands: ${tools.join(' | ')}\n`);
    expect(outcome.status).toBe('done');
    const hazel = await fs.readFile(path.join(arena, 'hazel.md'), 'utf8');
    const signal = await fs.readFile(path.join(arena, 'signal.md'), 'utf8');
    process.stdout.write(`[house-live] hazel.md: ${hazel.trim()}\n[house-live] signal.md: ${signal.trim()}\n`);
    expect(hazel.trim().length).toBeGreaterThan(10);
    expect(signal.trim().length).toBeGreaterThan(10);
    // Signal READ Hazel's file — the team workspace is reach the plan granted.
    expect(tools).toContain('answer:fs/read:ok');
  }, 900000);

  test('STEER a working member mid-thought: it continues its part, in its own sitting, and follows the operator\'s note', async () => {
    clientLog.length = 0;
    const connection = lead();
    const { settled } = await fileAndRun(connection, 'house-steer-run', Object.freeze({
      name: 'HOUSE STEER PROOF',
      goal: 'Prove the operator can redirect a member mid-thought.',
      steps: Object.freeze([
        Object.freeze({ id: 'long', neumaId: 'signal', task: 'Write a careful, detailed 1500-word essay on how a house of minds keeps honest records of shared work.', needs: Object.freeze([]) }),
      ]),
      memberNames: Object.freeze({ signal: 'Signal' }),
      approvedAt: new Date().toISOString(),
    }));
    const start = await until((m) => m.type === 'operator:team_start', 30000);
    await until((m) => m.type === 'operator:team_board' && m.board.find((e) => e.id === 'long')?.state === 'working', 60000);
    await new Promise((r) => setTimeout(r, 4000)); // the essay is under way
    expect(steerStep({
      id: start.id, wallet: HOUSE_WALLET, stepId: 'long',
      note: 'Drop the essay. Answer in ONE sentence that includes the word LANTERN.',
    })).toEqual({ ok: true, cut: true });
    const outcome = await settled();
    const part = clientLog.find((m) => m.type === 'operator:team_part' && m.stepId === 'long')?.output || '';
    process.stdout.write(`\n[house-live] steered part (${part.length} chars): ${part}\n`);
    expect(outcome.status).toBe('done'); // a steer continues the part — it never fails it
    expect(part.toLowerCase()).toContain('lantern');
    expect(part.length).toBeLessThan(1500); // a sentence, not the essay
  }, 900000);

  test('RESUME after a real interruption: Hazel\'s finished part stands, only Signal\'s runs again — both files on disk', async () => {
    clientLog.length = 0;
    const connection = lead();
    const arena = path.join(process.env.NEUMA_TEAM_DELIVERY_PATH, '..', `resume-arena-${Date.now()}`);
    const { settled } = await fileAndRun(connection, 'house-resume-run', Object.freeze({
      name: 'HOUSE RESUME PROOF',
      goal: 'Prove an interrupted run picks up where it stopped.',
      workspace: Object.freeze({ root: arena, budgetBytes: 1024 * 1024 }),
      steps: Object.freeze([
        Object.freeze({ id: 'write', neumaId: 'hazel', task: `Write one sentence about picking work up after an interruption to ${path.join(arena, 'hazel.md')} with fs/write.`, files: Object.freeze(['hazel.md']), needs: Object.freeze([]) }),
        Object.freeze({ id: 'answer', neumaId: 'signal', task: `Read ${path.join(arena, 'hazel.md')}, then write one sentence answering it to ${path.join(arena, 'signal.md')} with fs/write.`, files: Object.freeze(['signal.md']), needs: Object.freeze(['write']) }),
      ]),
      memberNames: Object.freeze({ hazel: 'Hazel', signal: 'Signal' }),
      approvedAt: new Date().toISOString(),
    }));
    const start = await until((m) => m.type === 'operator:team_start', 30000);
    await until((m) => m.type === 'operator:team_board' && m.board.find((e) => e.id === 'answer')?.state === 'working', 600000);
    await new Promise((r) => setTimeout(r, 2000)); // Signal is mid-decode
    expect(stopRun({ id: start.id, wallet: HOUSE_WALLET })).toEqual({ ok: true });
    const first = await settled();
    expect(first.status).toBe('stopped');
    const hazelBefore = await fs.readFile(path.join(arena, 'hazel.md'), 'utf8');

    // Pick it up — the operator's RESUME, the production door.
    const { resumeTeamRun, setTeamRunSeams } = await import('../../backend/services/intents/team-run.js');
    let resumed = null;
    setTeamRunSeams({ getCapacity: async () => ({ maxParallel: 1 }), onSettled: (p) => { resumed = p; } });
    clientLog.length = 0;
    const outcome = await resumeTeamRun({ id: start.id, wallet: HOUSE_WALLET });
    setTeamRunSeams(null);
    expect(outcome).toEqual({ ok: true, runId: start.id });
    const second = await resumed;
    expect(second.status).toBe('done');
    // Hazel was never asked again: no stream or part of hers in the resumed run.
    expect(clientLog.some((m) => (m.type === 'operator:team_stream' || m.type === 'operator:team_part') && m.stepId === 'write')).toBe(false);
    expect(await fs.readFile(path.join(arena, 'hazel.md'), 'utf8')).toBe(hazelBefore);
    const signal = await fs.readFile(path.join(arena, 'signal.md'), 'utf8');
    process.stdout.write(`\n[house-live] resumed — hazel.md (from before): ${hazelBefore.trim()}\n[house-live] signal.md (after resume): ${signal.trim()}\n`);
    const record = await readRun(start.id, HOUSE_WALLET);
    expect(record.status).toBe('done');
    expect(record.order).toEqual(['write', 'answer']);
    expect(record.resumes).toHaveLength(1);
  }, 1200000);

  test('STOP MEMBER cuts a real decode on the GPU: the member stops within seconds, its dependent never starts', async () => {
    clientLog.length = 0;
    const readSlots = () => fetch('http://localhost:8089/slots').then((r) => r.json());
    const decodedOf = (x) => x.n_decoded ?? x.next_token?.[0]?.n_decoded ?? 0;
    // The rig is shared — the operator's own desk may be decoding beside this
    // test (2026-10-12: slot 0 was another client's, and the stop was judged
    // against it). A slot already busy before the member starts is not ours.
    const foreign = new Set((await readSlots()).filter((x) => x.is_processing).map((x) => x.id));
    const connection = lead();
    const { settled } = await fileAndRun(connection, 'house-stop-run', Object.freeze({
      name: 'HOUSE STOP PROOF',
      goal: 'Prove the operator can stop a member mid-thought.',
      steps: Object.freeze([
        Object.freeze({ id: 'long', neumaId: 'signal', task: 'Write a careful, detailed 1500-word essay on how a house of minds keeps honest records of shared work.', needs: Object.freeze([]) }),
        Object.freeze({ id: 'after', neumaId: 'hazel', task: 'Summarize the essay above in one sentence.', needs: Object.freeze(['long']) }),
      ]),
      memberNames: Object.freeze({ hazel: 'Hazel', signal: 'Signal' }),
      approvedAt: new Date().toISOString(),
    }));
    const start = await until((m) => m.type === 'operator:team_start', 30000);
    await until((m) => m.type === 'operator:team_board' && m.board.find((e) => e.id === 'long')?.state === 'working', 60000);
    // The decode is under way once the member's reasoning or words stream —
    // then find the slot decoding it: not a foreign one, its count climbing.
    await until((m) => m.type === 'operator:team_stream' && m.stepId === 'long' && Boolean(m.thought || m.text), 180000);
    const before = await readSlots();
    await new Promise((r) => setTimeout(r, 1000));
    const mid = await readSlots();
    const ours = mid.find((x) => !foreign.has(x.id) && x.is_processing && decodedOf(x) > decodedOf(before.find((b) => b.id === x.id)));
    expect(ours, 'a slot must be decoding the member before the stop').toBeTruthy();
    const stoppedAt = Date.now();
    expect(stopRun({ id: start.id, wallet: HOUSE_WALLET, stepId: 'long' })).toEqual({ ok: true });
    const outcome = await settled();
    const settleMs = Date.now() - stoppedAt;
    expect(settleMs).toBeLessThan(15000); // a 1500-word essay is minutes of decode; the cut is seconds
    // The decode itself ended: that slot stops processing and its token count
    // stops growing — the server let go, not just our listener.
    let freedMs = null;
    for (let t = 0; t < 50 && freedMs == null; t += 1) {
      const slot = (await readSlots()).find((x) => x.id === ours.id);
      if (!slot.is_processing) freedMs = Date.now() - stoppedAt;
      else await new Promise((r) => setTimeout(r, 100));
    }
    const atFree = decodedOf((await readSlots()).find((x) => x.id === ours.id));
    await new Promise((r) => setTimeout(r, 2000));
    const later = decodedOf((await readSlots()).find((x) => x.id === ours.id));
    process.stdout.write(`\n[house-live] stop → run settled ${settleMs}ms, slot ${ours.id} freed ${freedMs}ms; tokens at free ${atFree}, 2s later ${later}\n`);
    expect(freedMs).not.toBeNull();
    expect(freedMs).toBeLessThan(5000);
    expect(later).toBe(atFree);
    expect(outcome.status).toBe('failed');
    const report = await fs.readFile(outcome.report, 'utf8');
    expect(report).toContain('long (Signal): FAILED — the operator stopped this member');
    expect(report).toContain('after: NEVER STARTED');
  }, 900000);
});
