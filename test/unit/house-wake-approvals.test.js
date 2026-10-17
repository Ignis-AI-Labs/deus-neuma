/**
 * Approval routing inside a house wake — the pure decisions, real inputs to
 * real outputs: what the charter lets a wake take, where a wake's team plan
 * goes, how the Optio's verdict is read, what the escalate list holds back
 * even past a grant, and what the woken seat reads first.
 */
import { describe, test, expect } from 'vitest';
import { wakeActVerdict } from '../../backend/services/house-clock/wake-approvals.js';
import { planRouting } from '../../backend/services/house-clock/wake-plan.js';
import { parseVerdicts, wakeThought, WAKE_HEAD } from '../../backend/services/house-clock/wake-thought.js';
import { holdForWake } from '../../backend/services/protocol-guard.js';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';

const charter = (patch = {}) => normalizeCharter({
  goal: 'Ship one digest a week.',
  linesOfWork: ['research digests'],
  seats: [{ laneId: 'optio', dailyCap: 4 }, { laneId: 'lead', dailyCap: 4 }],
  delegation: { teamPlans: true, maxMembers: 2, maxSteps: 3 },
  allow: ['web/web_search'],
  escalate: ['intents/social.post'],
  ...patch,
});

describe('what a wake may take without the operator', () => {
  test('the charter\'s allow proceeds; everything else comes back; money out always', () => {
    const c = charter();
    expect(wakeActVerdict(c, 'web/web_search')).toMatchObject({ allow: true });
    expect(wakeActVerdict(c, 'web/web_fetch')).toMatchObject({ allow: false, why: expect.stringMatching(/operator's approval/) });
    expect(wakeActVerdict(c, 'intents/social.post')).toMatchObject({ allow: false, why: expect.stringMatching(/charter sends/) });
    expect(wakeActVerdict(c, 'intents/wallet.send')).toMatchObject({ allow: false, why: expect.stringMatching(/money out/) });
  });

  test('the escalate list turns a granted act back into an ask — only on a wake\'s connection', () => {
    const wake = { _wakeHolds: new Set(charter().escalate) };
    expect(holdForWake(wake, 'allowed', 'intents', 'wallet.send')).toBe('approval_required');
    expect(holdForWake(wake, 'allowed', 'intents', 'social.post')).toBe('approval_required');
    expect(holdForWake(wake, 'allowed', 'intents', 'house.post')).toBe('allowed');
    expect(holdForWake(wake, 'denied', 'intents', 'wallet.send')).toBe('denied');
    expect(holdForWake({}, 'allowed', 'intents', 'wallet.send')).toBe('allowed');
  });
});

describe('where a wake\'s team plan goes', () => {
  const steps = (n, members = 1) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, neumaId: `m${i % members}` }));
  test('inside the delegation: to the Optio', () => {
    expect(planRouting({ charter: charter(), lead: 'lead', officer: 'optio', steps: steps(3, 2) })).toEqual({ to: 'optio' });
  });
  test('outside it: to the operator, with the reason', () => {
    const go = (patch) => planRouting({ charter: charter(), lead: 'lead', officer: 'optio', steps: steps(2), ...patch });
    expect(go({ charter: charter({ delegation: { teamPlans: false } }) }).why).toMatch(/does not delegate/);
    expect(go({ officer: null }).why).toMatch(/no Optio/);
    expect(go({ lead: 'optio' }).why).toMatch(/never approves its own plan/);
    expect(go({ officer: 'stranger' }).why).toMatch(/not a seat/);
    expect(go({ steps: steps(3, 3) }).why).toMatch(/3 members/);
    expect(go({ steps: steps(4, 1) }).why).toMatch(/4 steps/);
  });
});

describe('the Optio\'s verdict, read from its words', () => {
  test('one plan: a bare verdict line rules it; notes ride a revise', () => {
    expect(parseVerdicts('Looks right.\nVERDICT: APPROVE', ['plan-1'])).toEqual({ 'plan-1': { verdict: 'approve', notes: '' } });
    expect(parseVerdicts('VERDICT: REVISE — add a reviewer step', ['plan-1'])).toEqual({ 'plan-1': { verdict: 'revise', notes: 'add a reviewer step' } });
  });
  test('several plans: each by its id; the last word stands; a stranger id is ignored', () => {
    const text = 'VERDICT plan-a: REVISE: tighten\nVERDICT plan-b: APPROVE\nVERDICT plan-a: APPROVE\nVERDICT plan-z: APPROVE\nVERDICT: APPROVE';
    expect(parseVerdicts(text, ['plan-a', 'plan-b'])).toEqual({
      'plan-a': { verdict: 'approve', notes: '' }, 'plan-b': { verdict: 'approve', notes: '' },
    });
  });
  test('no verdict line, no verdict', () => {
    expect(parseVerdicts('I think it is fine, approve it.', ['plan-1'])).toEqual({});
  });
});

describe('the note a woken seat reads first', () => {
  test('it names itself the platform\'s, names every piece of work, and closes with the wake\'s law', () => {
    const text = wakeThought({
      charter: charter(),
      items: [
        { reason: 'post', ref: 'p1', detail: { from: 'optio', re: 'Draft' } },
        { reason: 'dispatch', ref: 'c1', detail: { title: 'Draft the digest' } },
        { reason: 'run-lost', ref: 'r1', detail: { name: 'CREW', completed: 1, steps: 3 } },
      ],
    });
    expect(text.startsWith(WAKE_HEAD)).toBe(true);
    expect(text).toContain('3 things wait');
    expect(text).toContain('[post p1]');
    expect(text).toContain('charge [c1] "Draft the digest"');
    expect(text).toContain('team/run {"resume": "r1"}');
    expect(text).toContain('"Ship one digest a week."');
    expect(text).toMatch(/Money out is always theirs/);
    expect(text).not.toMatch(/^your operator (says|asks)/im);
  });
  test('a plan review shows the plan whole and asks for one verdict line', () => {
    const text = wakeThought({
      charter: charter(),
      items: [{ reason: 'plan-review', ref: 'plan-1' }],
      plans: { 'plan-1': { id: 'plan-1', lead: 'lead', leadName: 'Quae', plan: { name: 'CREW', goal: 'Draft it.', memberNames: { m0: 'Cosi' }, steps: [{ id: 'draft', neumaId: 'm0', task: 'Write digest.md', needs: [] }] } } },
    });
    expect(text).toContain('Quae put a team plan before you');
    expect(text).toContain('- draft · Cosi: Write digest.md');
    expect(text).toContain('at most 2 members and 3 steps (this plan: 1 and 1)');
    expect(text).toContain('"VERDICT plan-1: APPROVE"');
  });
});
