/**
 * THE OPERATOR ANSWERS, AND THE HOUSE MOVES, FOR REAL (RULE 0: real wake
 * turns over a loopback OpenAI-wire provider, the real intent sweep, approval
 * broker, asks store, grant store, plan of record and dispatch gate on real
 * disk; the answer goes through answerAsk, the function the operator's route
 * calls — its HTTP door is proven in house-clock-routes.test.js). Founder,
 * 2026-10-16: […].
 *
 * Under proof:
 *  - ALLOW ONCE on a refused act wakes the seat with the exact act; the grant
 *    lets exactly that act through ONCE — a different argument is refused
 *    first and leaves it standing, the same act again after is refused —
 *    recorded as the operator's yes on the act ledger and the wake row; a
 *    write it allows opens no folder: a different write there is filed again;
 *  - APPROVE on a plan that came to the operator makes it the lead's plan of
 *    record (approvedBy operator), wakes the lead, and the dispatch gate
 *    lets it run under a seated Optio;
 *  - a decision REPLY and an act DENY wake the seat with the operator's own
 *    words — and an answer's wake never spends the seat's daily cap.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, call, userText, until, WALLET, OPTIO, HOUSEMATE } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { readAsks, fileAsk, readWakeLedger } from '../../backend/services/house-clock/wake-ledger.js';
import { answerAsk } from '../../backend/services/house-clock/ask-answer.js';
import { askArgs } from '../../backend/services/house-clock/one-shot-grants.js';
import { readWakePlan } from '../../backend/services/house-clock/wake-plan.js';
import { clockDir } from '../../backend/services/house-clock/wake-ledger.js';
import { teamRunIntent } from '../../backend/services/intents/team-run.js';
import { readActs } from '../../backend/services/act-ledger.js';

const intent = (name) => path.join(neumaWorkspace.pathFor(HOUSEMATE), 'intents', `${name}.json`);
const resultOf = async (file) => JSON.parse(await fs.readFile(file.replace(/\.json$/, '.result.json'), 'utf8'));
const task = (title) => JSON.stringify({ type: 'tasks/add', title });

describe('the operator answers an ask', () => {
  let house;
  beforeEach(async () => { house = await createWakeHouse(); });
  afterEach(async () => { await house.teardown(); });

  test('ALLOW ONCE: the seat is woken with the act, and exactly that act runs once', async () => {
    await house.serve([
      // the first wake: the act the charter sends to the operator
      { reply: `I will record the outline task. ${call('fs/write', { path: intent('task-1'), content: task('Outline the digest') })}` },
      { reply: 'The task waits on my operator.' },
      // the answer's wake: a different argument first, then the exact act, then the exact act again
      { reply: `Recording a fuller task. ${call('fs/write', { path: intent('task-2'), content: task('Outline the whole digest') })}` },
      { reply: `Then exactly as filed. ${call('fs/write', { path: intent('task-3'), content: task('Outline the digest') })}` },
      { reply: `And again. ${call('fs/write', { path: intent('task-4'), content: task('Outline the digest') })}` },
      { reply: 'The outline task is recorded.' },
    ]);
    await house.charter({ escalate: ['intents/tasks.add'] });
    await house.post(HOUSEMATE, 'Record the outline task.');
    const [first] = await house.ledgerRows(1);
    expect(first.outcome).toBe('escalated');
    expect((await resultOf(intent('task-1'))).status).toBe('denied');
    const [ask] = await readAsks(WALLET);
    expect(ask).toMatchObject({ kind: 'act', tool: 'intents/tasks.add', args: JSON.parse(task('Outline the digest')), argsHash: expect.stringMatching(/^[0-9a-f]{64}$/) });

    const answered = await answerAsk(WALLET, ask.id, { decision: 'allow', text: 'Go ahead, once.' }, { by: WALLET });
    expect(answered).toMatchObject({ ask: { id: ask.id, status: 'answered', answer: { decision: 'allow', text: 'Go ahead, once.' } }, woken: { queued: true } });
    const [, second] = await house.ledgerRows(2);
    expect(second).toMatchObject({ seat: HOUSEMATE, reason: 'operator-answer', ref: ask.id });

    const opener = userText(house.provider.turns[2]);
    expect(opener).toContain(`Your operator ANSWERED what you filed for them [ask ${ask.id}]. They ALLOWED ONCE your intents/tasks.add`);
    expect(opener).toContain(`with exactly this content: ${task('Outline the digest')}`);
    expect(opener).toContain('<<<\nGo ahead, once.\n>>>');

    expect((await resultOf(intent('task-2'))).status).toBe('denied'); // not the act allowed
    expect((await resultOf(intent('task-3'))).status).toBe('done'); // the act allowed, once
    expect((await resultOf(intent('task-4'))).status).toBe('denied'); // the grant is used
    const yes = { decision: 'approved-operator', approvedBy: { kind: 'operator', askId: ask.id } };
    expect(second.acts.filter((a) => a.decision === 'approved-operator')).toEqual([expect.objectContaining({ tool: 'intents/tasks.add', ...yes })]);
    const acts = await readActs({ laneIds: [HOUSEMATE] });
    expect(acts.filter((a) => a.decision === 'approved-operator')).toHaveLength(1);
    expect(acts.filter((a) => a.decision === 'operator-allowed-once')).toEqual([expect.objectContaining({ status: 'granted', approvedBy: { kind: 'operator', askId: ask.id } })]);
    const grants = JSON.parse(await fs.readFile(path.join(clockDir(WALLET), 'grants.json'), 'utf8')).grants;
    expect(grants).toEqual([expect.objectContaining({ askId: ask.id, seat: HOUSEMATE, consumedAt: expect.any(String) })]);
    // the refused two are new asks; the first is answered and stays answered
    expect((await readAsks(WALLET)).map((a) => a.status)).toEqual(['open', 'open', 'answered']);
    await expect(answerAsk(WALLET, ask.id, { decision: 'allow' }, { by: WALLET })).rejects.toThrow(/already answered/);
  }, 60000);

  test('ALLOW ONCE on a write grants that write, never its folder: a different write there is refused and filed again', async () => {
    const outside = path.join(house.office.root, 'outside');
    await fs.mkdir(outside, { recursive: true });
    const allowed = { path: path.join(outside, 'allowed.md'), content: 'the allowed note' };
    const other = path.join(outside, 'other.md');
    await house.serve([
      { reply: `I will put the note outside the house folder. ${call('fs/write', allowed)}` },
      { reply: 'The note waits on my operator.' },
      { reply: `Writing it exactly as filed. ${call('fs/write', allowed)}` },
      { reply: `And another note beside it. ${call('fs/write', { path: other, content: 'not allowed' })}` },
      { reply: 'The note is written; the other waits.' },
    ]);
    await house.charter();
    await house.post(HOUSEMATE, 'Write the note.');
    await house.ledgerRows(1);
    const [ask] = await readAsks(WALLET);
    expect(ask).toMatchObject({ kind: 'act', tool: 'fs/write', why: expect.stringMatching(/outside the house's ground/) });
    await answerAsk(WALLET, ask.id, { decision: 'allow' }, { by: WALLET });
    const [, second] = await house.ledgerRows(2);
    expect(second.reason).toBe('operator-answer');
    expect(await fs.readFile(allowed.path, 'utf8')).toBe('the allowed note');
    await expect(fs.access(other)).rejects.toThrow();
    const open = (await readAsks(WALLET)).filter((a) => a.status === 'open');
    expect(open).toEqual([expect.objectContaining({ tool: 'fs/write', args: expect.objectContaining({ path: other }) })]);
  }, 60000);

  test('APPROVE: a plan that came to the operator becomes the lead\'s plan of record, and the lead runs it', async () => {
    await house.serve([
      { reply: call('team/plan_submit', {
        name: 'DIGEST CREW', goal: 'Draft the first research digest.',
        steps: [{ id: 'draft', member: 'Cosi', task: 'Write the digest draft into digest.md.' }],
      }) },
      { reply: 'The plan waits on my operator.' },
      { reply: 'Approved — I will put the crew to work.' },
    ]);
    await house.charter({ delegation: { teamPlans: false } });
    await house.post(HOUSEMATE, 'Plan the first digest with Cosi.');
    await house.ledgerRows(1);
    const [ask] = await readAsks(WALLET);
    expect(ask).toMatchObject({ kind: 'plan', planId: expect.stringMatching(/^plan-/), why: expect.stringMatching(/does not delegate/) });
    expect(await readWakePlan(WALLET, ask.planId)).toMatchObject({ status: 'with-operator', lead: HOUSEMATE });
    const gate = () => teamRunIntent.validate({}, { connection: { companion: { neumaId: HOUSEMATE, name: 'Quae' }, walletAddress: WALLET } });
    expect(await gate()).toMatchObject({ ok: false, reason: expect.stringMatching(/The Optio holds dispatch/) });

    await answerAsk(WALLET, ask.id, { decision: 'approve' }, { by: WALLET });
    const [, woke] = await house.ledgerRows(2);
    expect(woke).toMatchObject({ seat: HOUSEMATE, reason: 'operator-answer' });
    expect(userText(house.provider.turns[2])).toContain(`They APPROVED your team plan [plan ${ask.planId}]`);
    expect(await readWakePlan(WALLET, ask.planId)).toMatchObject({ status: 'approved', verdict: { verdict: 'approve', by: 'operator', askId: ask.id } });
    const record = await neumaWorkspace.readPlanRecord(HOUSEMATE);
    expect(record).toMatchObject({ goal: 'Draft the first research digest.', approvedBy: { kind: 'operator', askId: ask.id, planId: ask.planId } });
    // the operator's yes IS dispatch, under the seated Optio
    expect((await gate()).reason ?? '').not.toMatch(/The Optio holds dispatch/);
  }, 60000);

  test('a decision REPLY and an act DENY wake the seat with the operator\'s words — past a spent daily cap', async () => {
    await house.serve([
      { reply: 'The post is read.' },
      { reply: 'Ratified; I will not post the offer.' },
    ]);
    await house.charter({ seats: [{ laneId: OPTIO, dailyCap: 5 }, { laneId: HOUSEMATE, dailyCap: 1 }] });
    await house.post(HOUSEMATE, 'Spend the day\'s one wake.');
    await house.ledgerRows(1);
    const decision = await fileAsk(WALLET, { wakeId: 'w-1', seat: HOUSEMATE, kind: 'decision', question: 'Ratify the $250 first-job price?', options: ['Ratify', 'Lower it'], why: 'a decision only you can make' });
    const act = await fileAsk(WALLET, { wakeId: 'w-1', seat: HOUSEMATE, kind: 'act', tool: 'intents/social.post', why: 'posting', ...askArgs({ type: 'social/post', text: 'We launch.' }) });

    const words = 'Ratify it — $250 holds for the first three jobs.';
    await answerAsk(WALLET, decision.id, { decision: 'reply', option: 'Ratify', text: words }, { by: WALLET });
    await answerAsk(WALLET, act.id, { decision: 'deny', text: 'Not before the site is up.' }, { by: WALLET });
    // the two answers wake the seat in one wake or two, as the queue takes them — every one ran
    const answerRows = await until(async () => {
      const rows = (await readWakeLedger(WALLET)).rows.filter((r) => r.items.every((i) => i.reason === 'operator-answer'));
      return rows.flatMap((r) => r.items).length === 2 ? rows : null;
    });
    expect(answerRows.flatMap((r) => r.items.map((i) => i.ref)).sort()).toEqual([decision.id, act.id].sort());
    expect(answerRows.every((r) => r.seat === HOUSEMATE && r.outcome === 'done')).toBe(true);
    const opener = house.provider.turns.slice(1).map(userText).join('\n');
    expect(opener).toContain('You asked them: "Ratify the $250 first-job price?". They chose: Ratify.');
    expect(opener).toContain(`<<<\n${words}\n>>>`);
    expect(opener).toContain('They DENIED your intents/social.post');
    expect(opener).toContain('<<<\nNot before the site is up.\n>>>');
    // no grant is written by a deny or a reply
    await expect(fs.access(path.join(clockDir(WALLET), 'grants.json'))).rejects.toThrow();
  }, 60000);
});
