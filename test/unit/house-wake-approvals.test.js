/**
 * Approval routing inside a house wake — the pure decisions, real inputs to
 * real outputs (the act table is house-optio-review.test.js): where a wake's team plan
 * goes, how the Optio's verdict is read, what the escalate list holds back
 * even past a grant, and what the woken seat reads first.
 */
import { describe, test, expect } from 'vitest';
import { planRouting } from '../../backend/services/house-clock/wake-plan.js';
import { parseVerdicts, wakeThought, WAKE_HEAD } from '../../backend/services/house-clock/wake-thought.js';
import { holdForWake } from '../../backend/services/protocol-guard.js';
import { houseHolds } from '../../backend/services/house-clock/wake-approvals.js';
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
  test('the escalate list turns a granted act back into an ask — only on a wake\'s connection', () => {
    const wake = { _wakeHolds: new Set(charter().escalate) };
    expect(holdForWake(wake, 'allowed', 'intents', 'wallet.send')).toBe('approval_required');
    expect(holdForWake(wake, 'allowed', 'intents', 'social.post')).toBe('approval_required');
    expect(holdForWake(wake, 'allowed', 'intents', 'house.post')).toBe('allowed');
    expect(holdForWake(wake, 'denied', 'intents', 'wallet.send')).toBe('denied');
    expect(holdForWake({}, 'allowed', 'intents', 'wallet.send')).toBe('allowed');
  });
  test('house work holds money out and a benchmark launch always, charter or none, and every act its charter escalates', () => {
    for (const holds of [houseHolds(null), houseHolds(charter())]) {
      expect(holdForWake({ _wakeHolds: holds }, 'allowed', 'intents', 'wallet.send')).toBe('approval_required');
      expect(holdForWake({ _wakeHolds: holds }, 'allowed', 'bench', 'bench_run')).toBe('approval_required');
    }
    expect(houseHolds(charter()).has('intents/social.post')).toBe(true);
    expect(houseHolds(null).has('intents/social.post')).toBe(false);
  });
});

describe('where a wake\'s team plan goes', () => {
  const steps = (n, members = 1) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, neumaId: `m${i % members}` }));
  test('inside the delegation: to the Optio', () => {
    expect(planRouting({ charter: charter(), lead: 'lead', officer: 'optio', steps: steps(3, 2) })).toEqual({ to: 'optio' });
  });
  test('the Optio\'s own plan inside the delegation: the charter approves it, unless it gives her a step', () => {
    expect(planRouting({ charter: charter(), lead: 'optio', officer: 'optio', steps: steps(3, 2) })).toEqual({ to: 'charter' });
    const own = planRouting({ charter: charter(), lead: 'optio', officer: 'optio', steps: [{ id: 's0', neumaId: 'optio' }, { id: 's1', neumaId: 'm0' }] });
    expect(own).toMatchObject({ to: 'operator', why: expect.stringMatching(/steps of her own/) });
    expect(planRouting({ charter: charter(), lead: 'optio', officer: 'optio', steps: steps(4, 1) }).why).toMatch(/4 steps/);
  });
  test('outside it: to the operator, with the reason', () => {
    const go = (patch) => planRouting({ charter: charter(), lead: 'lead', officer: 'optio', steps: steps(2), ...patch });
    expect(go({ charter: charter({ delegation: { teamPlans: false } }) }).why).toMatch(/does not delegate/);
    expect(go({ officer: null }).why).toMatch(/no Optio/);
    expect(go({ officer: 'stranger' }).why).toMatch(/not a seat/);
    expect(go({ steps: steps(3, 3) }).why).toMatch(/3 members/);
    expect(go({ steps: steps(4, 1) }).why).toMatch(/4 steps/);
  });
  test('a workspace outside the house\'s ground: to the operator, on the Optio\'s road and the charter\'s', () => {
    for (const lead of ['lead', 'optio']) {
      expect(planRouting({ charter: charter(), lead, officer: 'optio', steps: steps(2), strayWorkspace: '/home/op' }))
        .toEqual({ to: 'operator', why: 'the plan names a workspace outside the house\'s ground (/home/op)' });
    }
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
  test('every wake carries the charter whole: the goal at full length and its lines of work (2026-10-16 live test)', () => {
    const long = `${'Find one real gap. '.repeat(20)}THE TASKS ARE IN THE LINES BELOW.`;
    const text = wakeThought({
      charter: normalizeCharter({ goal: long, linesOfWork: ['Keir: count the words of findings.md by shell', 'Keep the offer ready'], seats: [{ laneId: 'optio', dailyCap: 2 }] }),
      items: [{ reason: 'cadence', ref: 'every-1h-1', detail: { everyHours: 1 } }],
    });
    expect(text).toContain('THE TASKS ARE IN THE LINES BELOW.');
    expect(text).toContain('"Keir: count the words of findings.md by shell"; "Keep the offer ready"');
    // the review names its reads and the charge by their exact ids (2026-10-17 flight: six family searches first)
    expect(text).toContain('staff/house_state, staff/board_list');
    expect(text).toContain('file the staff/dispatch intent');
  });
  test('every wake names the seat\'s own folder and the house\'s shared ground, and says the others are sealed (2026-10-18)', () => {
    const items = [{ reason: 'cadence', ref: 'every-2h-1', detail: { everyHours: 2 } }];
    const text = wakeThought({ charter: charter(), items, ground: { own: '/lanes/optio', house: '/house' } });
    expect(text).toContain('Your own folder is /lanes/optio; the house\'s shared ground is /house. Work and look there;');
    expect(text).toContain('every other member\'s folder is theirs, sealed.');
    expect(wakeThought({ charter: charter(), items, ground: { own: '/lanes/optio', house: null } }))
      .toContain('this house has no shared ground yet, so work in your own folder');
  });
  test('a run\'s end carries the platform\'s own record of its web reads, beside whatever the report claims (2026-10-18)', () => {
    const items = [{ reason: 'run-ended', ref: 'run-1', detail: { status: 'done' } }];
    const none = wakeThought({ charter: charter(), items, webReads: { 'run-1': [] } });
    expect(none).toContain('The platform recorded NO web reads by its members during the run');
    expect(none).toContain('treat such a claim as unverified, and say so to your operator');
    const some = wakeThought({ charter: charter(), items, webReads: { 'run-1': [
      { tool: 'web/web_search', scope: 'AI Act enforcement date', status: 'success' },
      { tool: 'web/web_fetch', scope: 'https://example.org/report', status: 'error' },
    ] } });
    expect(some).toContain('The platform recorded 2 web read(s) by its members during the run: web_search "AI Act enforcement date"; web_fetch "https://example.org/report" (failed).');
    // no record read (an unreadable run): the note says nothing it cannot stand behind
    expect(wakeThought({ charter: charter(), items })).not.toContain('web read');
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
    expect(text).toContain('Workspace, where every member writes once you approve: none named');
    const named = wakeThought({
      charter: charter(),
      items: [{ reason: 'plan-review', ref: 'plan-2' }],
      plans: { 'plan-2': { id: 'plan-2', lead: 'lead', plan: { goal: 'Draft it.', workspace: { root: '/house/repos/digest' }, steps: [{ id: 'draft', neumaId: 'm0', task: 't', needs: [] }] } } },
    });
    expect(named).toContain('Workspace, where every member writes once you approve: /house/repos/digest.');
  });
});
