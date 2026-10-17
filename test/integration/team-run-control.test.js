/**
 * team/run — the operator's hands on a background run, on the real ground
 * (team-intent-kit.js: real WS pair, real sweep, isolated stores, declared
 * seams): STOP one member, STOP the run, STEER a member, the GPU slot a team
 * leaves the operator, and ONE approval = ONE run. Split from
 * team-run-tool.test.js (size law). No GPU: the conduit is the declared seam.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { neumaWorkspace } from '../../core/index.js';
import { stopRun, steerStep, liveRunsFor } from '../../backend/services/team-run-live.js';
import { createTeamIntentKit, SEAMS, APPROVED_PLAN } from '../helpers/team-intent-kit.js';

describe('team/run — stop, steer, slots, one approval (real WS + real harness, gnosis)', () => {
  const kit = createTeamIntentKit('team-run-control');
  const { freshConnection, fileRun, runIntent, report, untilClient, log: clientLog } = kit;
  beforeAll(() => kit.open(), 60000);
  afterAll(() => kit.close());

  test('STOP MEMBER cuts the working member\'s decode; its dependents never start; the run reads STOPPED nowhere it was not', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    const asked = [];
    let entered;
    const inResearch = new Promise((r) => { entered = r; });
    await fileRun(connection, 'stop-member-run');
    await runIntent(connection, {
      ...SEAMS,
      ask: (_n, _m, step, hooks) => new Promise((resolve, reject) => {
        asked.push(step.id);
        // A real decode would be cut by this signal on the wire; here the
        // promise answers to the SAME signal the provider would receive.
        hooks.signal.addEventListener('abort', () => reject(new Error('aborted')));
        entered();
        if (step.id !== 'research') resolve('never reached');
      }),
    });
    await inResearch;
    const start = await untilClient((m) => m.type === 'operator:team_start');
    expect(stopRun({ id: start.id, wallet: '0x2222222222222222222222222222222222222222', stepId: 'research' }).ok).toBe(false); // not the owner's run
    expect(stopRun({ id: start.id, wallet: connection.walletAddress, stepId: 'research' })).toEqual({ ok: true });
    const { status, text } = await report();
    expect(asked).toEqual(['research']);
    expect(status).toBe('failed'); // one member was stopped; the run itself was not
    expect(text).toContain('research (Aethon): FAILED — the operator stopped this member');
    expect(text).toContain('draft: NEVER STARTED');
    const done = await untilClient((m) => m.type === 'operator:team_done');
    expect(done.stopped).toBe(false);
  }, 30000);

  test('STOP THE RUN cuts every working member and nothing further starts — the run reads STOPPED', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    let entered;
    const inResearch = new Promise((r) => { entered = r; });
    await fileRun(connection, 'stop-run');
    await runIntent(connection, {
      ...SEAMS,
      ask: (_n, _m, _step, hooks) => new Promise((_resolve, reject) => {
        hooks.signal.addEventListener('abort', () => reject(new Error('aborted')));
        entered();
      }),
    });
    await inResearch;
    const start = await untilClient((m) => m.type === 'operator:team_start');
    expect(stopRun({ id: start.id, wallet: connection.walletAddress })).toEqual({ ok: true });
    const { status, text } = await report();
    expect(status).toBe('stopped');
    expect(text).toContain('research (Aethon): FAILED — the operator stopped the run');
    const done = await untilClient((m) => m.type === 'operator:team_done');
    expect(done.stopped).toBe(true);
    expect(liveRunsFor(connection.walletAddress)).toEqual([]);
  }, 30000);

  test('STEER: a working member is cut and re-starts its part with the operator\'s note; a waiting one reads its note when it starts', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    const briefs = [];
    let firstEntered;
    const inFirst = new Promise((r) => { firstEntered = r; });
    await fileRun(connection, 'steer-run');
    await runIntent(connection, {
      ...SEAMS,
      ask: (neumaId, messages, step, hooks) => new Promise((resolve, reject) => {
        briefs.push({ step: step.id, text: messages.at(-1).content });
        hooks.signal.addEventListener('abort', () => reject(new Error('aborted')));
        if (step.id === 'research' && briefs.length === 1) { firstEntered(); return; } // hold — it is working
        resolve(`part from ${neumaId}: ${step.id}\nSTATUS:\n${step.id} complete`);
      }),
    });
    await inFirst;
    const start = await untilClient((m) => m.type === 'operator:team_start');
    // The waiting member's note first — it must ride its brief when it starts.
    expect(steerStep({ id: start.id, wallet: connection.walletAddress, stepId: 'draft', note: 'Keep every post under 200 characters.' })).toEqual({ ok: true, cut: false });
    // Then the working one: cut, and re-asked with the note.
    expect(steerStep({ id: start.id, wallet: connection.walletAddress, stepId: 'research', note: 'Only themes about the harvest.' })).toEqual({ ok: true, cut: true });
    expect(steerStep({ id: start.id, wallet: '0x2222222222222222222222222222222222222222', stepId: 'research', note: 'x' }).ok).toBe(false);
    const { status } = await report();
    expect(status).toBe('done');
    const research = briefs.filter((b) => b.step === 'research');
    expect(research).toHaveLength(2);
    expect(research[0].text).not.toContain("YOUR OPERATOR'S GUIDANCE");
    expect(research[1].text).toContain("YOUR OPERATOR'S GUIDANCE for this part");
    expect(research[1].text).toContain('— Only themes about the harvest.');
    expect(briefs.find((b) => b.step === 'draft').text).toContain('— Keep every post under 200 characters.');
    // The operator's desk saw both notes land.
    expect(clientLog.filter((m) => m.type === 'operator:team_note').map((m) => m.stepId)).toEqual(['draft', 'research']);
  }, 30000);

  test('a team leaves one GPU slot for the operator: on a 3-slot rig, never more than 2 members at once', async () => {
    const { memberSlots } = await import('../../backend/services/team-run-background.js');
    expect([memberSlots(1), memberSlots(2), memberSlots(4), memberSlots(null)]).toEqual([1, 1, 3, 1]);
    const connection = {
      ...freshConnection(),
      _approvedPlan: Object.freeze({
        ...APPROVED_PLAN,
        steps: Object.freeze(['a', 'b', 'c'].map((id) => Object.freeze({ id, neumaId: 'aethon', task: `part ${id}`, needs: Object.freeze([]) }))),
      }),
    };
    let working = 0;
    let peak = 0;
    await fileRun(connection, 'slots-run');
    await runIntent(connection, {
      ...SEAMS,
      getCapacity: async () => ({ maxParallel: 3 }),
      ask: async (_n, _m, step) => {
        working += 1;
        peak = Math.max(peak, working);
        await new Promise((r) => setTimeout(r, 40));
        working -= 1;
        return `part ${step.id}\nSTATUS:\nok`;
      },
    });
    const { status } = await report();
    expect(status).toBe('done');
    expect(peak).toBe(2);
  }, 30000);

  test('the operator\'s slot holds ACROSS runs: two leads\' teams at once on a 3-slot rig still decode at most 2 members', async () => {
    const { startTeamRun } = await import('../../backend/services/team-run-start.js');
    let working = 0;
    let peak = 0;
    const settles = [];
    const deps = {
      checkSubstrate: async () => true,
      getCapacity: async () => ({ maxParallel: 3 }),
      ask: async (_n, _m, step) => {
        working += 1;
        peak = Math.max(peak, working);
        await new Promise((r) => setTimeout(r, 40));
        working -= 1;
        return `part ${step.id}\nSTATUS:\nok`;
      },
      onSettled: (p) => settles.push(p),
    };
    const planOf = (neumaId) => Object.freeze({
      name: `${neumaId} crew`, goal: 'Run beside another team.', memberNames: { [neumaId]: neumaId },
      steps: ['a', 'b', 'c'].map((id) => ({ id, neumaId, task: `part ${id}`, needs: [] })),
    });
    const wallet = freshConnection().walletAddress;
    const started = await Promise.all(['aethon', 'boreas'].map((neumaId) => startTeamRun({
      plan: planOf(neumaId), lead: { neumaId, name: neumaId }, wallet, deps,
    })));
    expect(started.every((x) => x.ok)).toBe(true);
    const outcomes = await Promise.all(settles);
    expect(outcomes.map((o) => o.status)).toEqual(['done', 'done']);
    expect(peak).toBe(2);
  }, 30000);

  test('STOP right after a STEER stops: the cut never re-starts the part, and its dependents never start', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    const asked = [];
    let entered;
    const inResearch = new Promise((r) => { entered = r; });
    await fileRun(connection, 'steer-then-stop-run');
    await runIntent(connection, {
      ...SEAMS,
      ask: (_n, _m, step, hooks) => new Promise((resolve, reject) => {
        asked.push(step.id);
        hooks.signal.addEventListener('abort', () => reject(new Error('aborted')));
        if (step.id === 'research') entered();
        else resolve('never reached');
      }),
    });
    await inResearch;
    const start = await untilClient((m) => m.type === 'operator:team_start');
    expect(steerStep({ id: start.id, wallet: connection.walletAddress, stepId: 'research', note: 'Change course.' })).toEqual({ ok: true, cut: true });
    expect(stopRun({ id: start.id, wallet: connection.walletAddress, stepId: 'research' })).toEqual({ ok: true });
    const { status, text } = await report();
    expect(asked).toEqual(['research']); // the steer's re-start never happened
    expect(status).toBe('failed');
    expect(text).toContain('research (Aethon): FAILED — the operator stopped this member');
    expect(text).toContain('draft: NEVER STARTED');
  }, 30000);

  test('ONE approval is ONE run: the plan of record says how the run ended, and a second filing goes back to the operator', async () => {
    const { persistApprovedPlan } = await import('../../backend/services/team-plan.js');
    const connection = { ...freshConnection(), companion: { name: 'Aethon', neumaId: 'aethon' }, sessionId: null };
    const { record } = await persistApprovedPlan(connection, APPROVED_PLAN, [
      { neumaId: 'aethon', name: 'Aethon' }, { neumaId: 'boreas', name: 'Boreas' },
    ], { approvedAt: APPROVED_PLAN.approvedAt });
    expect(record.run).toBeUndefined();
    await fileRun(connection, 'once-run');
    await runIntent(connection);
    const { report: reportPath } = await report();

    const stamped = await neumaWorkspace.readPlanRecord('aethon');
    expect(stamped.run).toMatchObject({ status: 'done', report: reportPath });
    const { formatPlanSection } = await import('../../core/tasks/plan-record.js');
    const section = formatPlanSection(stamped);
    expect(section).toContain('FINISHED');
    expect(section).toContain(reportPath);
    expect(section).toContain('that approval is spent');

    await fileRun(connection, 'again-run');
    const again = await runIntent(connection);
    expect(again.status).toBe('error');
    expect(again.error).toContain('This plan already ran');
    await neumaWorkspace.retirePlanRecord('aethon');
  }, 30000);
});

describe('RESUME — a crashed run is picked up where it stopped; nothing finished is lost', () => {
  const kit = createTeamIntentKit('team-run-resume-lead');
  const { freshConnection, runIntent, report, log: clientLog } = kit;
  let portalConnections;
  beforeAll(async () => {
    await kit.open();
    // The operator's RESUME has no filing socket: its frames reach every desk
    // of the wallet through the REAL fan-out (portal-send wires it at load) —
    // the kit's socket stands in the real connection map as a desk.
    ({ portalConnections } = await import('../../backend/routes/portal-connections.js'));
    await import('../../backend/routes/portal-send.js');
    portalConnections.set('resume-desk', { ws: kit.socket(), walletAddress: freshConnection().walletAddress });
  }, 60000);
  afterAll(async () => {
    portalConnections?.delete('resume-desk');
    await kit.close();
  });

  const CHAIN = Object.freeze([
    Object.freeze({ id: 'a', neumaId: 'aethon', task: 'part a', needs: Object.freeze([]) }),
    Object.freeze({ id: 'b', neumaId: 'boreas', task: 'part b', needs: Object.freeze(['a']) }),
    Object.freeze({ id: 'c', neumaId: 'aethon', task: 'part c', needs: Object.freeze(['b']) }),
  ]);
  const deadPid = () => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', '']);
    child.on('exit', () => resolve(child.pid));
  });
  // A record exactly as a crashed backend leaves it: RUNNING, its process
  // gone, part a finished, an operator note waiting for b, a file in the arena.
  const crashedRun = async (approvedAt) => {
    const arena = await createTempDir('resume-arena');
    await fs.writeFile(path.join(arena, 'a.md'), 'written before the crash');
    const store = await import('../../backend/services/team-run-store.js');
    const id = await store.createRun({
      by: freshConnection().walletAddress, runAt: new Date().toISOString(),
      lane: 'lead', lead: { neumaId: 'aethon', name: 'Aethon' }, name: 'CHAIN', goal: 'Finish the chain.',
      steps: CHAIN, names: { aethon: 'Aethon', boreas: 'Boreas' },
      workspace: { root: arena, budgetBytes: 1024 * 1024 }, approvedAt, status: 'running',
      completed: { a: 'the part from a' }, statuses: { a: 'a done' }, torches: {}, order: ['a'],
      notes: { b: [{ note: 'Keep b short.', at: 't0' }] }, failures: {}, finishedAt: null,
    });
    const file = path.join(process.env.NEUMA_TEAM_RUN_PATH, `${id}.json`);
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...raw, host: { pid: await deadPid() } }));
    return { id, arena };
  };
  const recording = () => {
    const asked = [];
    return {
      asked,
      seams: { ...SEAMS, ask: async (neumaId, messages, step) => { asked.push({ step: step.id, brief: messages.at(-1).content }); return `the part from ${step.id}\nSTATUS:\n${step.id} done`; } },
    };
  };

  test('the OPERATOR resumes: same run, same arena, a is never re-run, b reads its note and the arena — the whole chain lands', async () => {
    const { id, arena } = await crashedRun('2026-10-12T00:00:00.000Z');
    const { resumeTeamRun, setTeamRunSeams } = await import('../../backend/services/intents/team-run.js');
    const { readRun } = await import('../../backend/services/team-run-store.js');
    expect((await readRun(id, freshConnection().walletAddress)).status).toBe('lost');
    const { asked, seams } = recording();
    let settled = null;
    setTeamRunSeams({ ...seams, onSettled: (p) => { settled = p; } });
    const outcome = await resumeTeamRun({ id, wallet: freshConnection().walletAddress });
    setTeamRunSeams(null);
    expect(outcome).toEqual({ ok: true, runId: id }); // the SAME run
    const done = await settled;
    expect(done.status).toBe('done');
    expect(asked.map((x) => x.step)).toEqual(['b', 'c']); // a stood — never re-asked
    const b = asked.find((x) => x.step === 'b').brief;
    expect(b).toContain('the part from a'); // the finished part is built on
    expect(b).toContain('— Keep b short.'); // the operator's note survived the crash
    expect(b).toContain('This run is RESUMING after an interruption');
    expect(b).toContain(arena); // the SAME workspace, file and all
    const record = await readRun(id, freshConnection().walletAddress);
    expect(record.status).toBe('done');
    expect(record.order).toEqual(['a', 'b', 'c']);
    expect(record.resumes).toHaveLength(1);
    expect(record.host.pid).toBe(process.pid);
    const text = await fs.readFile(done.report, 'utf8');
    expect(text).toContain('all 3 steps');
    const start = clientLog.find((m) => m.type === 'operator:team_start' && m.id === id);
    expect(start.resumed).toBe(true);
    expect(start.parts).toEqual({ a: 'the part from a' });
    expect(start.board.find((e) => e.id === 'a').state).toBe('done');
    // A finished run is nothing to pick up; a stranger finds nothing.
    expect((await resumeTeamRun({ id, wallet: freshConnection().walletAddress })).status).toBe(409);
    expect((await resumeTeamRun({ id, wallet: '0x2222222222222222222222222222222222222222' })).status).toBe(404);
  }, 30000);

  test('the LEAD picks up its own interrupted run under the same approval — and may not resume what is not lost', async () => {
    const approvedAt = '2026-10-12T01:00:00.000Z';
    const { id, arena } = await crashedRun(approvedAt);
    // The standing plan names no workspace (the run was given an arena of its
    // own) — the pick-up must still work in THAT arena, never a fresh one.
    const connection = { ...freshConnection(), _approvedPlan: Object.freeze({ ...APPROVED_PLAN, steps: CHAIN, approvedAt }) };
    const { asked, seams } = recording();
    const dir = path.join(neumaWorkspace.pathFor('aethon'), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pick-up.json'), JSON.stringify({ type: 'team/run', resume: id }));
    const receipt = await runIntent(connection, seams);
    expect(receipt.status).toBe('ok');
    expect(receipt.content).toContain(`picking run ${id} up where it stopped`);
    expect((await report()).status).toBe('done');
    expect(asked.map((x) => x.step)).toEqual(['b', 'c']);
    expect(asked.find((x) => x.step === 'b').brief).toContain(arena);
    const { readRun } = await import('../../backend/services/team-run-store.js');
    expect((await readRun(id, connection.walletAddress)).workspace.root).toBe(arena);
    // Done now — a second pick-up is refused, with the reason.
    await fs.writeFile(path.join(dir, 'pick-up-again.json'), JSON.stringify({ type: 'team/run', resume: id }));
    const again = await runIntent(connection, seams);
    expect(again.status).toBe('error');
    expect(again.error).toContain('is done');
  }, 30000);

  test('two RESUMEs at once (two desks, or the operator racing the lead) start ONE run — every part runs once', async () => {
    const { id } = await crashedRun('2026-10-12T02:00:00.000Z');
    const { resumeTeamRun, setTeamRunSeams } = await import('../../backend/services/intents/team-run.js');
    const { asked, seams } = recording();
    let settled = null;
    setTeamRunSeams({ ...seams, onSettled: (p) => { settled = p; } });
    const wallet = freshConnection().walletAddress;
    const outcomes = await Promise.all([resumeTeamRun({ id, wallet }), resumeTeamRun({ id, wallet })]);
    setTeamRunSeams(null);
    expect(outcomes.filter((o) => o.ok)).toEqual([{ ok: true, runId: id }]);
    expect(outcomes.find((o) => !o.ok).reason).toContain('already leading a run');
    expect((await settled).status).toBe('done');
    expect(asked.map((x) => x.step)).toEqual(['b', 'c']);
  }, 30000);
});
