/**
 * The operator's answer, the pure law (real inputs to real outputs, nothing
 * faked): which answer settles which kind of ask (ask-answer.js answerCheck),
 * the one-shot grant's exact match (one-shot-grants.js), the wake that only
 * carries answers never spending the cap (wake-gate.js), and the woken seat
 * reading the operator's words verbatim (wake-thought.js). The real path —
 * grant written, consumed once, plan approved, seat woken — is proven in
 * test/integration/house-ask-answer.test.js.
 */
import { describe, test, expect } from 'vitest';
import { answerCheck, ANSWER_TEXT_MAX } from '../../backend/services/house-clock/ask-answer.js';
import { argsHash, askArgs, matchGrant, ASK_ARGS_MAX } from '../../backend/services/house-clock/one-shot-grants.js';
import { answersOnly } from '../../backend/services/house-clock/wake-gate.js';
import { wakeThought, WAKE_HEAD } from '../../backend/services/house-clock/wake-thought.js';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';

const act = { id: 'a-act', kind: 'act', status: 'open', seat: 'quae', tool: 'intents/tasks.add', ...askArgs({ type: 'tasks/add', title: 'Outline' }) };
const plan = { id: 'a-plan', kind: 'plan', status: 'open', seat: 'quae', planId: 'plan-0123456789ab' };
const decision = { id: 'a-dec', kind: 'decision', status: 'open', seat: 'quae', question: 'Ratify the $250 price?', options: ['Ratify', 'Lower it'] };

describe('which answer settles which ask', () => {
  test('an act: allow or deny; allow needs the arguments it was filed with', () => {
    expect(answerCheck(act, { decision: 'allow', text: '  once  ' })).toEqual({ ok: true, value: { decision: 'allow', text: 'once' } });
    expect(answerCheck(act, { decision: 'deny' })).toEqual({ ok: true, value: { decision: 'deny' } });
    expect(answerCheck(act, { decision: 'approve' })).toMatchObject({ ok: false, status: 400, reason: 'a act ask is answered allow or deny' });
    const old = { ...act, argsHash: undefined };
    expect(answerCheck(old, { decision: 'allow' })).toMatchObject({ status: 409, reason: expect.stringMatching(/before ALLOW ONCE existed/) });
    expect(answerCheck(old, { decision: 'deny' }).ok).toBe(true);
  });
  test('a plan: approve, or revise with notes; an unrecorded plan can only be closed', () => {
    expect(answerCheck(plan, { decision: 'approve' }).ok).toBe(true);
    expect(answerCheck(plan, { decision: 'revise' }).reason).toBe('say what must change');
    expect(answerCheck(plan, { decision: 'revise', text: 'add a reviewer' }).value).toEqual({ decision: 'revise', text: 'add a reviewer' });
    expect(answerCheck({ ...plan, planId: undefined }, { decision: 'approve' }).status).toBe(409);
  });
  test('a decision: a reply with words, one of its choices, or both — never a stranger choice', () => {
    expect(answerCheck(decision, { decision: 'reply', option: 'Ratify' }).value).toEqual({ decision: 'reply', option: 'Ratify' });
    expect(answerCheck(decision, { decision: 'reply', text: 'Ratify, and say why.', option: 'Ratify' }).value)
      .toEqual({ decision: 'reply', text: 'Ratify, and say why.', option: 'Ratify' });
    expect(answerCheck(decision, { decision: 'reply', text: '  ' }).reason).toMatch(/needs your words or one of its choices/);
    expect(answerCheck(decision, { decision: 'reply', option: 'Raise it' }).reason).toMatch(/not one of the choices/);
    expect(answerCheck(decision, { decision: 'allow' }).status).toBe(400);
  });
  test('only an open ask of this house, and words of bounded length', () => {
    expect(answerCheck(null, { decision: 'deny' })).toMatchObject({ status: 404 });
    expect(answerCheck({ ...act, status: 'answered' }, { decision: 'deny' })).toMatchObject({ status: 409, reason: 'this ask is already answered' });
    expect(answerCheck({ ...act, status: 'closed' }, { decision: 'deny' }).status).toBe(409);
    expect(answerCheck(act, { decision: 'deny', text: 'x'.repeat(ANSWER_TEXT_MAX + 1) }).status).toBe(400);
    expect(answerCheck(act, { decision: 'deny', text: 7 }).status).toBe(400);
  });
});

describe('the one-shot grant matches exactly one act', () => {
  const grants = [{ askId: 'a-act', seat: 'quae', tool: 'intents/tasks.add', argsHash: act.argsHash }];
  test('the same arguments, however their keys are ordered', () => {
    expect(argsHash({ title: 'Outline', type: 'tasks/add' })).toBe(act.argsHash);
    expect(matchGrant(grants, { seat: 'quae', tool: 'intents/tasks.add', hash: argsHash({ title: 'Outline', type: 'tasks/add' }) })).toBe(grants[0]);
  });
  test('another seat, tool or argument is no match; a used grant never matches again', () => {
    expect(matchGrant(grants, { seat: 'cosi', tool: 'intents/tasks.add', hash: act.argsHash })).toBeNull();
    expect(matchGrant(grants, { seat: 'quae', tool: 'intents/tasks.update', hash: act.argsHash })).toBeNull();
    expect(matchGrant(grants, { seat: 'quae', tool: 'intents/tasks.add', hash: argsHash({ type: 'tasks/add', title: 'Outline!' }) })).toBeNull();
    expect(matchGrant([{ ...grants[0], consumedAt: 'then' }], { seat: 'quae', tool: 'intents/tasks.add', hash: act.argsHash })).toBeNull();
  });
  test('an ask keeps the arguments whole only while they are short enough to repeat', () => {
    expect(askArgs({ q: 'x' })).toEqual({ argsHash: argsHash({ q: 'x' }), args: { q: 'x' } });
    const long = { content: 'x'.repeat(ASK_ARGS_MAX) };
    expect(askArgs(long)).toEqual({ argsHash: argsHash(long) });
  });
});

describe('an answer\'s wake', () => {
  test('a wake carrying only answers never spends the cap; any other work in it does', () => {
    expect(answersOnly([{ reason: 'operator-answer' }, { reason: 'operator-answer' }])).toBe(true);
    expect(answersOnly([{ reason: 'operator-answer' }, { reason: 'post' }])).toBe(false);
    expect(answersOnly([])).toBe(false);
  });

  const charter = normalizeCharter({ goal: 'Ship the first offer.', seats: [{ laneId: 'quae', dailyCap: 3 }] });
  const note = (ask) => wakeThought({ items: [{ reason: 'operator-answer', ref: ask.id }], charter, answers: { [ask.id]: ask } });
  test('the seat reads the operator\'s words verbatim, as theirs, relayed by the platform', () => {
    const words = 'Yes — "ratify" it.\nThen draft the offer page.';
    const text = note({ ...decision, status: 'answered', answer: { decision: 'reply', option: 'Ratify', text: words } });
    expect(text.startsWith(WAKE_HEAD)).toBe(true);
    expect(text).toContain('Your operator ANSWERED what you filed for them [ask a-dec]. You asked them: "Ratify the $250 price?". They chose: Ratify.');
    expect(text).toContain(`Your operator's own words, verbatim, between the markers (the platform relays them unedited):\n<<<\n${words}\n>>>`);
  });
  test('allow once names the exact act to take again; deny, approve and revise say what follows', () => {
    const allowed = note({ ...act, status: 'answered', answer: { decision: 'allow' } });
    expect(allowed).toContain('They ALLOWED ONCE your intents/tasks.add.');
    expect(allowed).toContain(`with exactly this content: ${JSON.stringify(act.args)}`);
    expect(allowed).not.toContain('<<<');
    expect(note({ ...act, status: 'answered', answer: { decision: 'deny', text: 'Not this week.' } })).toMatch(/They DENIED your intents\/tasks\.add\. Do not take it again[\s\S]*<<<\nNot this week\.\n>>>/);
    expect(note({ ...plan, status: 'answered', answer: { decision: 'approve' } })).toContain('They APPROVED your team plan [plan plan-0123456789ab]. It is your standing plan of record: file team/run');
    expect(note({ ...plan, status: 'answered', answer: { decision: 'revise', text: 'Add a reviewer.' } })).toMatch(/REVISIONS[\s\S]*<<<\nAdd a reviewer\.\n>>>/);
  });
});
