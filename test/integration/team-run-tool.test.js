/**
 * team/run intent (Stage 3) — the LEAD dispatches the approved plan of record
 * by FILING it; the sweep settles it through the same coordination harness.
 *
 * Two suites, two honest scopes:
 *
 * 1. The scripted suite proves DISPATCH + COORDINATION on the real WS pair,
 *    the real sweep, the real harness (runCoordinatedTeam → runTeam →
 *    buildBrief → board) — with the member conduit (`ask`) SCRIPTED through
 *    the intent module's declared seams. That suite does NOT claim conduit
 *    gnosis.
 *
 * 2. The live suite (gated the same way team-route.test.js gates its live
 *    run) IS the conduit gnosis (AGENTS.md RULE 0): the intent's execute with
 *    the DEFAULT ask — real askNeuma, real kin, real loaded substrate — on a
 *    one-step plan, asserting a real model-produced part.
 *
 * The contract under proof: only an operator-APPROVED plan runs, and ONE
 * run per approval; the run works in the BACKGROUND — the filing answers at
 * once and the lead's turn is free; the operator watches real board frames;
 * the LEAD reads every part attributed in the report its plan of record
 * names; failure and a STOP are reported, never dressed as success; STOP
 * MEMBER cuts that member's decode (its signal aborts) and its dependents
 * never start. An intent filed onto a DEAD turn never starts at all.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { __test } from '../../backend/services/portal-test-surface.js';
import { neumaWorkspace } from '../../core/index.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { setTeamRunSeams, teamRunIntent } from '../../backend/services/intents/team-run.js';
import { registerRun, endRun, liveRunsFor } from '../../backend/services/team-run-live.js';
import { createTeamIntentKit, SEAMS } from '../helpers/team-intent-kit.js';

const { processToolCalls } = __test;

// Live-gnosis gate — mirrors team-route.test.js exactly: a loaded substrate
// and real kin of the operating wallet under the live workspace root.
const CLAUDE = '0x40566d43261849777aca96b26f4ec8c850e5dcae'; // owns the House Aldmere kin
const liveSubstrate = await fetch('http://localhost:1234/api/v0/models')
  .then(async (r) => (r.ok ? ((await r.json()).data || []).some((m) => m.state === 'loaded') : false))
  .catch(() => false);
const liveKin = (await neumaWorkspace.listNeumaByOwner(CLAUDE).catch(() => [])).map((o) => o.neumaId);
const canRunLive = liveSubstrate && liveKin.length >= 1;

describe('team/run intent — dispatch and coordination (real WS + real harness, gnosis)', () => {
  const kit = createTeamIntentKit('team-run-tool');
  const { freshConnection, fileRun, runIntent, report, untilClient, log: clientLog } = kit;
  beforeAll(() => kit.open(), 60000);
  afterAll(() => kit.close());

  test('the intent is registered with its old tier — allowed, the plan IS the consent', () => {
    expect(teamRunIntent.name).toBe('team/run');
    expect(teamRunIntent.policyTool).toBe('team.run');
  });

  test('no approved plan — the filing refuses at validate and points at plan_submit', async () => {
    const connection = { ...freshConnection(), _approvedPlan: undefined };
    await fileRun(connection, 'no-plan');
    const receipt = await runIntent(connection);
    expect(receipt.status).toBe('error');
    expect(receipt.error).toContain('plan_submit');
  }, 30000);

  test('a stale team_run tool call answers unavailable — the act is a filed intent', async () => {
    const connection = freshConnection();
    const results = await processToolCalls(kit.socket(), '[TOOL: team/team_run {}]', connection);
    expect(results[0].status).toBe('unavailable');
  }, 30000);

  test('the approved plan runs IN THE BACKGROUND: the filing answers at once, the operator watches real frames, the LEAD reads attributed parts', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    await fileRun(connection);

    // The members are held until the filing has answered — proof the lead's
    // turn is not waiting on the team.
    let release;
    const gate = new Promise((r) => { release = r; });
    const receipt = await runIntent(connection, {
      ...SEAMS,
      ask: async (neumaId, messages, step) => { await gate; return SEAMS.ask(neumaId, messages, step); },
    });
    expect(receipt.status).toBe('ok');
    expect(receipt.content).toContain('at work in the background');
    const start = await untilClient((m) => m.type === 'operator:team_start');
    expect(start.background).toBe(true);
    expect(liveRunsFor(connection.walletAddress).map((r) => r.id)).toEqual([start.id]);
    release();

    // The LEAD's read: both parts, attributed with display names and roles,
    // statuses carried, check-ins STRIPPED from the work products — in the
    // report file its plan of record will name.
    const { status, text } = await report();
    expect(status).toBe('done');
    expect(text).toContain('all 2 steps');
    expect(text).toContain('research — Aethon (HELM)');
    expect(text).toContain('part from boreas: draft');
    expect(text).toContain('Their status: draft complete');
    expect(text).not.toMatch(/STATUS:\n/);

    // The operator's window: start (all waiting, named), boards, done (order).
    expect(start.name).toBe('HERALD CREW');
    expect(start.goal).toBe('Ship a week of posts.');
    expect(start.board.map((b) => b.member)).toEqual(['Aethon', 'Boreas']);
    expect(start.board.every((b) => b.state === 'waiting')).toBe(true);
    const done = await untilClient((m) => m.type === 'operator:team_done' && m.id === start.id);
    expect(done.status).toBe('done');
    expect(done.order).toEqual(['research', 'draft']);

    // The WORK HISTORY: the frame names the persisted record, and the record
    // holds how the team got the job done — parts, statuses, names — owned by
    // the operator wallet (a foreign wallet reads absence).
    expect(done.record).toBe(start.id);
    const { readRun } = await import('../../backend/services/team-run-store.js');
    const record = await readRun(done.record, connection.walletAddress);
    expect(record.status).toBe('done');
    expect(record.completed.draft).toContain('part from boreas');
    expect(record.statuses.research).toContain('research complete');
    expect(record.names).toEqual({ aethon: 'Aethon', boreas: 'Boreas' });
    expect(await readRun(done.record, '0x2222222222222222222222222222222222222222')).toBe(null);
    const lastBoard = [...clientLog].reverse().find((m) => m.type === 'operator:team_board' && m.id === start.id);
    expect(lastBoard.board.every((b) => b.state === 'done')).toBe(true);
    expect(lastBoard.board.find((b) => b.id === 'draft').member).toBe('Boreas');

    expect(liveRunsFor(connection.walletAddress)).toEqual([]);
  }, 30000);

  test('one run at a time — a second filing while the lane leads a live run is refused', async () => {
    const connection = freshConnection();
    registerRun({ id: 'standing-run', wallet: connection.walletAddress, laneId: 'aethon', lead: 'Aethon', goal: 'g', board: [] });
    try {
      await fileRun(connection, 'second-run');
      const receipt = await runIntent(connection);
      expect(receipt.status).toBe('error');
      expect(receipt.error).toContain('already working');
    } finally {
      endRun('standing-run');
    }
  });

  test('substrate offline — the team is not promised a run it cannot think', async () => {
    const connection = freshConnection();
    await fileRun(connection, 'offline-run');
    const receipt = await runIntent(connection, { ...SEAMS, checkSubstrate: async () => false });
    expect(receipt.status).toBe('error');
    expect(receipt.error).toContain('offline');
  });

  test('a member failure is answered by the run — continued three times, told why — then reported as failure; operator AND lead both learn it', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    const drafts = [];
    await fileRun(connection, 'failing-run');
    const receipt = await runIntent(connection, {
      ...SEAMS,
      ask: async (_n, messages, step) => {
        if (step.id === 'draft') {
          drafts.push(messages.at(-1).content);
          throw new Error('conduit dropped mid-thought');
        }
        return 'fine\nSTATUS:\nok';
      },
    });
    expect(receipt.status).toBe('ok'); // the filing started a run — the run is what failed
    const { status, text } = await report();
    // The response: the part was continued on its own, three times, each
    // attempt told why it stopped — and only then given up on.
    expect(drafts).toHaveLength(4);
    expect(drafts[0]).not.toContain('YOUR PART CONTINUES');
    for (const brief of drafts.slice(1)) {
      expect(brief).toContain('YOUR PART CONTINUES. Your part stopped before you finished — conduit dropped mid-thought.');
      expect(brief).toContain('write posts'); // no sitting on this conduit: the brief rides again
    }
    const retries = clientLog.filter((m) => m.type === 'operator:team_retry');
    expect(retries.map((m) => [m.stepId, m.kind, m.why])).toEqual(Array(3).fill(['draft', 'failed', 'conduit dropped mid-thought']));
    expect(status).toBe('failed');
    expect(text).toContain('did not finish');
    expect(text).toContain('draft (Boreas): FAILED — conduit dropped mid-thought');
    const done = await untilClient((m) => m.type === 'operator:team_done');
    expect(done.status).toBe('error');
    expect(liveRunsFor(connection.walletAddress)).toEqual([]);
  }, 30000);
});

describe.skipIf(!canRunLive)('team/run — conduit gnosis (real kin, real substrate, DEFAULT ask)', () => {
  let httpServer, wss, serverWs, client, clientLog;

  beforeAll(async () => {
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (d) => clientLog.push(JSON.parse(d.toString())));
    await linked;
  }, 60000);

  afterAll(() => {
    setTeamRunSeams(null);
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
  });

  test('a one-step plan runs through the REAL neuma conduit end to end', async () => {
    const kinId = liveKin[0];
    const connection = {
      ws: serverWs,
      companion: { name: kinId, neumaId: kinId },
      walletAddress: CLAUDE,
      _approvedPlan: Object.freeze({
        name: 'GNOSIS RUN',
        goal: 'Prove one real part flows through the real conduit.',
        steps: Object.freeze([Object.freeze({
          id: 'speak', neumaId: kinId,
          task: 'Reply with one short sentence greeting your house.', needs: Object.freeze([]),
        })]),
        memberNames: Object.freeze({ [kinId]: kinId }),
        approvedAt: new Date().toISOString(),
      }),
    };

    // DEFAULT ask (real askNeuma), real substrate check; only the capacity
    // number is provided (it is rig configuration, not the conduit).
    const dir = path.join(neumaWorkspace.pathFor(kinId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'gnosis-run.json'), JSON.stringify({ type: 'team/run' }));
    setTeamRunSeams({ getCapacity: async () => ({ maxParallel: 1 }) });
    const receipts = await sweepIntents(connection, {
      mode: 'auto', lanePolicy: null,
      emit: (event) => clientLog.push({ type: 'tool:usage', ...event }),
    });
    setTeamRunSeams(null);
    const receipt = receipts.find((r) => r.tool === 'intents/team.run');

    expect(receipt.status).toBe('ok');
    expect(receipt.content).toContain('all 1 steps');
    expect(receipt.content).toContain(`speak — ${kinId}`);
    // A real model spoke: the part is non-trivial text beyond the template.
    const part = receipt.content.split('===').at(-1).trim();
    expect(part.length).toBeGreaterThan(10);
    // Frames cross a real socket — wait for the settle, never poll once.
    const done = await new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = clientLog.find((m) => m.type === 'operator:team_done');
        if (hit) return resolve(hit);
        if (Date.now() - started > 5000) return reject(new Error('team_done frame never arrived'));
        setTimeout(tick, 20);
      };
      tick();
    });
    expect(done.status).toBe('done');
  }, 300000);
});
