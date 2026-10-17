/**
 * Team plan flow (TEAM PROJECTS slice 2) — a being-authored plan gated on
 * its witness's verdict, proven end to end with NO mock on the claimed path
 * (AGENTS.md RULE 0): REAL WebSocket pair, REAL processToolCalls dispatch,
 * REAL broker, REAL workspace roster on real disk (owner records + DNA
 * names, the same reads production resolves members through).
 *
 * The contract under proof: plan_submit resolves member NAMES against the
 * witness's own house, validates with the ENGINE's validatePlan (approval
 * is a promise about what will actually run), pauses on the witness's
 * verdict, and freezes an APPROVED plan onto the connection as the plan of
 * record — now also durable: the record persists to the LEAD's workspace,
 * its own steps land on its ledger, and a relinked connection rehydrates
 * it. No verdict — timeout, interrupt, close — reads as approval.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import {
  normalizePlanArgs, resolvePlanMembers, requestPlanApproval, resolvePlanApproval,
  expirePendingPlans, rehydrateApprovedPlan, PLAN_NOTES_MAX_CHARS, PLAN_MAX_STEPS,
} from '../../backend/services/team-plan.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { KIND } from '../../core/runtime/notification-record.js';

const { processToolCalls, PLAN_SUBMIT_TOOL, _handlePlanSubmit } = __test;

const WITNESS = '0x1111111111111111111111111111111111111111';
const STRANGER_WALLET = '0x2222222222222222222222222222222222222222';

const planCall = (args) => `[TOOL: team/plan_submit ${JSON.stringify(args)}]`;

const GOOD_PLAN = Object.freeze({
  name: 'HERALD CREW',
  goal: 'Draft and schedule one week of posts for the house account.',
  steps: [
    { id: 'research', member: 'Aethon', role: 'HELM', task: 'Survey what landed this week and pick 5 themes.', done: 'Five themes with one-line rationales.' },
    { id: 'draft', member: 'BOREAS', task: 'Write the posts for the chosen themes.', needs: ['research'] },
    { id: 'review', member: 'aethon', task: 'Tighten every draft against the brand voice.', needs: ['draft'], done: 'Each post fits the voice and is under limit.' },
  ],
});

describe('team plan flow (real WS + real workspace roster, gnosis)', () => {
  let house, origRoot, realm, prevRealm, httpServer, wss, serverWs, client, port;
  let clientLog;
  let verdict = null; // when armed, the desk answers operator:plan with it

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'Aethon', neumaId: 'aethon' },
    walletAddress: WITNESS,
  });

  // Mirror the route: the witness's verdict settles the pending plan.
  const wirePlans = (connection) => {
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'operator:plan_response') resolvePlanApproval(connection, m.id, m.decision, m.notes);
    });
  };

  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  beforeAll(async () => {
    house = await createTempDir('team-plan-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    // Plan cards raise real tray notices now — isolate the realm so the store
    // writes land here, never on the machine's own wallet dir.
    realm = await createTempDir('team-plan-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    // The witness's house: two beings with real DNA names and real owner
    // records — plus a stranger's being that must never resolve.
    for (const [id, name, wallet] of [
      ['aethon', 'Aethon', WITNESS],
      ['boreas', 'Boreas', WITNESS],
      ['veiled', 'Veiled', STRANGER_WALLET],
    ]) {
      await workspace.create(id);
      await workspace.writeDNA(id, { identity: { name } });
      await fs.writeFile(path.join(house, id, 'owner.json'), JSON.stringify({ wallet }));
    }

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => { serverWs = ws; resolve(); });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'operator:plan' && verdict) {
        client.send(JSON.stringify({ type: 'operator:plan_response', id: msg.id, ...verdict(msg) }));
      }
    });
    await linked;
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('the tool is advertised with a native schema requiring goal and steps', () => {
    expect(PLAN_SUBMIT_TOOL.name).toBe('plan_submit');
    expect(PLAN_SUBMIT_TOOL.inputSchema.required).toEqual(expect.arrayContaining(['goal', 'steps']));
  });

  test('APPROVE — names resolve across case, the engine validates, the plan of record lands', async () => {
    const connection = freshConnection();
    wirePlans(connection);
    clientLog.length = 0;
    verdict = () => ({ decision: 'approve' });

    const results = await processToolCalls(serverWs, planCall(GOOD_PLAN), connection);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('APPROVED');
    expect(results[0].content).toContain('HERALD CREW');

    // The plan of record: engine-shaped, members resolved to neumaIds
    // ('Aethon'/'aethon'/'BOREAS' all landed), frozen, timestamped.
    const plan = connection._approvedPlan;
    expect(plan.goal).toBe(GOOD_PLAN.goal);
    expect(plan.steps.map((s) => s.neumaId)).toEqual(['aethon', 'boreas', 'aethon']);
    expect(plan.steps[2].needs).toEqual(['draft']);
    expect(plan.approvedAt).toBeTruthy();
    expect(Object.isFrozen(plan)).toBe(true);

    // The desk card carried display NAMES and the full step anatomy.
    const card = await untilClient((m) => m.type === 'operator:plan');
    expect(card.name).toBe('HERALD CREW');
    expect(card.steps.map((s) => s.member)).toEqual(['Aethon', 'Boreas', 'Aethon']);
    expect(card.steps[0].done).toContain('Five themes');
    expect(card.steps[1].needs).toEqual(['research']);
    const resolved = await untilClient((m) => m.type === 'operator:plan_resolved' && m.id === card.id);
    expect(resolved.status).toBe('approve');
    expect(connection._pendingPlans.size).toBe(0);

    // The approval became DURABLE at the verdict: the record on real disk
    // carries the SAME instant as the connection copy, and the LEAD's own
    // steps (research + review — never Boreas's draft) were formed on its
    // real ledger at that moment.
    expect(results[0].content).toContain('standing plan of record');
    expect(results[0].content).toContain('2 steps');
    const record = await workspace.readPlanRecord('aethon');
    expect(record.approvedAt).toBe(plan.approvedAt);
    expect(Object.keys(record.taskIds).sort()).toEqual(['research', 'review']);
    const ledger = await workspace.readTaskLedger('aethon');
    const own = ledger.tasks.filter((t) => Object.values(record.taskIds).includes(t.id));
    expect(own.map((t) => t.title)).toEqual(expect.arrayContaining([
      'Survey what landed this week and pick 5 themes.',
      'Tighten every draft against the brand voice.',
    ]));
  }, 30000);

  test('a submitted plan raises a tray card — the operator elsewhere hears a being is parked', async () => {
    // Fired at the card, not the verdict: the notice's audience is the
    // operator who is NOT looking at this stream. The earlier submissions in
    // this file already fired through the real bus; read the REAL store.
    const records = await (async () => {
      for (let i = 0; i < 50; i++) {
        const { records: r } = await readNotifications(WITNESS);
        if (r.some((c) => c.kind === KIND.awaitingAnswer)) return r;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return (await readNotifications(WITNESS)).records;
    })();
    const card = records.find((c) => c.kind === KIND.awaitingAnswer);
    expect(card.title).toBe('Aethon put a plan before you');
    expect(card.detail).toBe(GOOD_PLAN.goal);
  }, 30000);

  test('the plan of record survives a relink — a bare connection rehydrates it', async () => {
    // Runs against the record the APPROVE test landed on real disk.
    const relinked = freshConnection();
    const plan = await rehydrateApprovedPlan(relinked);
    expect(plan).toBe(relinked._approvedPlan);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.goal).toBe(GOOD_PLAN.goal);
    expect(plan.steps.map((s) => s.neumaId)).toEqual(['aethon', 'boreas', 'aethon']);
    expect(plan.memberNames.boreas).toBe('Boreas');
  });

  test('REVISE — the witness\'s notes return to the being and nothing becomes the plan of record', async () => {
    const connection = freshConnection();
    wirePlans(connection);
    clientLog.length = 0;
    verdict = () => ({ decision: 'revise', notes: 'Split review into voice and scheduling.' });

    const results = await processToolCalls(serverWs, planCall(GOOD_PLAN), connection);

    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('REVISIONS');
    expect(results[0].content).toContain('Split review into voice and scheduling.');
    expect(results[0].content).not.toContain('APPROVED');
    expect(connection._approvedPlan).toBeUndefined();
  }, 30000);

  test('malformed plans return the correction, and NO card reaches the desk', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    verdict = () => { throw new Error('a card fired for a malformed plan'); };

    const noGoal = await processToolCalls(serverWs, planCall({ steps: GOOD_PLAN.steps }), connection);
    expect(noGoal[0].status).toBe('error');
    expect(noGoal[0].error).toContain('goal');

    const noTask = await processToolCalls(serverWs, planCall({
      goal: 'g', steps: [{ id: 'a', member: 'Aethon' }],
    }), connection);
    expect(noTask[0].status).toBe('error');
    expect(noTask[0].error).toContain('"a"');

    // The ENGINE's own gate speaks: a cyclic plan can never run, so it is
    // never put before the witness.
    const cyclic = await processToolCalls(serverWs, planCall({
      goal: 'g',
      steps: [
        { id: 'a', member: 'Aethon', task: 'x', needs: ['b'] },
        { id: 'b', member: 'Boreas', task: 'y', needs: ['a'] },
      ],
    }), connection);
    expect(cyclic[0].status).toBe('error');
    expect(cyclic[0].error).toContain('cycle');

    expect(clientLog.some((m) => m.type === 'operator:plan')).toBe(false);
    expect(connection._approvedPlan).toBeUndefined();
  }, 30000);

  test('members outside the house never resolve — stranger beings and unknown names alike', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    verdict = () => { throw new Error('a card fired for an out-of-house plan'); };

    // 'Veiled' EXISTS on disk but belongs to another wallet; 'Nobody' is pure fiction.
    const results = await processToolCalls(serverWs, planCall({
      goal: 'g',
      steps: [
        { id: 'a', member: 'Veiled', task: 'x' },
        { id: 'b', member: 'Nobody', task: 'y' },
      ],
    }), connection);

    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('Veiled');
    expect(results[0].error).toContain('Nobody');
    expect(results[0].error).toContain('Aethon'); // the correction names who IS available
    expect(clientLog.some((m) => m.type === 'operator:plan')).toBe(false);
  }, 30000);

  test('a portal with no witness wallet cannot submit a plan', async () => {
    const connection = { ws: serverWs, companion: { name: 'Aethon', neumaId: 'aethon' } };
    const results = await processToolCalls(serverWs, planCall(GOOD_PLAN), connection);
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('wallet');
  }, 30000);

  test('NO CLOCK — the plan waits for the verdict, and a late ruling still lands', async () => {
    // Design note, 2026-07-27: […] The old law
    // auto-resolved an unanswered plan after 600s; the new law is no clock —
    // verdict, interrupt, or portal close are the only ways out.
    const connection = freshConnection();
    wirePlans(connection);
    clientLog.length = 0;
    verdict = null; // the witness steps away

    const inflight = processToolCalls(serverWs, planCall(GOOD_PLAN), connection);
    const card = await untilClient((m) => m.type === 'operator:plan');
    // Past the window the old tests gave the clock — nothing fires.
    await new Promise((r) => setTimeout(r, 300));
    expect(connection._pendingPlans.size).toBe(1);

    // The witness comes back and rules.
    client.send(JSON.stringify({ type: 'operator:plan_response', id: card.id, decision: 'approve' }));
    const results = await inflight;
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('APPROVED');
    expect(connection._approvedPlan).toBeTruthy();
  }, 30000);

  test('INTERRUPT through the dispatch path — the turn was cut before the verdict', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    verdict = null;
    const abort = new AbortController();
    connection.activeTurn = abort;
    const inflight = processToolCalls(serverWs, planCall(GOOD_PLAN), connection);
    await untilClient((m) => m.type === 'operator:plan');
    abort.abort();
    const results = await inflight;
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('interrupted');
    expect(results[0].content).toContain('NOT approved');
    expect(connection._approvedPlan).toBeUndefined();
  }, 30000);

  test('portal close settles a pending plan as closed — never approved', async () => {
    const connection = freshConnection();
    const waiting = requestPlanApproval(connection, {
      name: null, goal: 'g', steps: [{ id: 'a', neumaId: 'aethon', task: 'x', needs: [] }],
    });
    expirePendingPlans(connection);
    expect(await waiting).toEqual({ status: 'closed' });
    expect(connection._pendingPlans.size).toBe(0);
  });

  test('untrusted input: unknown ids, unknown decisions, and overlong notes', async () => {
    const connection = freshConnection();
    const waiting = requestPlanApproval(connection, {
      name: null, goal: 'g', steps: [{ id: 'a', neumaId: 'aethon', task: 'x', needs: [] }],
    });
    const [id] = [...connection._pendingPlans.keys()];
    expect(resolvePlanApproval(connection, 'ghost-id', 'approve')).toBe(false);
    expect(resolvePlanApproval(connection, id, 'rubber_stamp')).toBe(false);
    expect(connection._pendingPlans.size).toBe(1); // still pending
    expect(resolvePlanApproval(connection, id, 'revise', 'n'.repeat(PLAN_NOTES_MAX_CHARS + 500))).toBe(true);
    const outcome = await waiting;
    expect(outcome.status).toBe('revise');
    expect(outcome.notes).toHaveLength(PLAN_NOTES_MAX_CHARS);
  });

  test('normalizePlanArgs boundaries: step cap, empty steps, member requirement', () => {
    expect(() => normalizePlanArgs({ goal: 'g', steps: [] })).toThrow(/steps/);
    expect(() => normalizePlanArgs({ goal: 'g' })).toThrow(/steps/);
    expect(() => normalizePlanArgs({
      goal: 'g',
      steps: Array.from({ length: PLAN_MAX_STEPS + 1 }, (_, i) => ({ id: `s${i}`, member: 'A', task: 't' })),
    })).toThrow(new RegExp(String(PLAN_MAX_STEPS)));
    expect(() => normalizePlanArgs({ goal: 'g', steps: [{ id: 'a', task: 't' }] })).toThrow(/member/);
  });

  test('resolvePlanMembers is pure and honest about an empty house', () => {
    expect(() => resolvePlanMembers(
      [{ id: 'a', member: 'Anyone', task: 'x', needs: [] }],
      []
    )).toThrow(/no beings in this house/);
  });

  test('a shared display name is never silently picked — exact ids disambiguate', () => {
    const twins = [
      { neumaId: 'echo-1', name: 'Echo' },
      { neumaId: 'echo-2', name: 'echo' }, // collides case-insensitively
      { neumaId: 'solo', name: 'Solo' },
    ];
    // Naming the shared name throws with the correction...
    expect(() => resolvePlanMembers(
      [{ id: 'a', member: 'Echo', task: 'x', needs: [] }],
      twins
    )).toThrow(/share the name 'Echo'.*exact id/);
    // ...while the exact ids (and the unambiguous name) still resolve.
    const resolved = resolvePlanMembers(
      [
        { id: 'a', member: 'echo-1', task: 'x', needs: [] },
        { id: 'b', member: 'echo-2', task: 'y', needs: [] },
        { id: 'c', member: 'SOLO', task: 'z', needs: [] },
      ],
      twins
    );
    expect(resolved.map((s) => s.neumaId)).toEqual(['echo-1', 'echo-2', 'solo']);
  });
});
