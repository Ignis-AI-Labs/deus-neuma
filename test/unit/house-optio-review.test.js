/**
 * THE OPTIO'S REVIEW — the pure parts, real inputs to real outputs: which
 * gated act in house work goes where (the routing table), how a review's
 * words are read (CLEAR, HOLD with a reason, anything else a HOLD), and what
 * the review is shown (the act, what the member said it is doing, its
 * assignment, the house's goal).
 */
import { describe, test, expect } from 'vitest';
import { actRoute, actPaths, parseReview, reviewMessages, REVIEW_PROMPT } from '../../backend/services/house-clock/optio-review.js';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';

const charter = (patch = {}) => normalizeCharter({
  goal: 'Ship one digest a week.',
  seats: [{ laneId: 'optio', dailyCap: 4 }, { laneId: 'mate', dailyCap: 4 }],
  allow: ['web/web_search'],
  escalate: ['intents/tasks.focus'],
  ...patch,
});
const route = (tool, extra = {}) => actRoute({ charter: charter(), tool, args: {}, seat: 'mate', officer: 'optio', inGround: true, ...extra });

describe('where a gated act in house work goes', () => {
  test('the charter\'s allow and reads inside the ground proceed with no review', () => {
    expect(route('web/web_search')).toEqual({ to: 'allow', by: 'charter' });
    for (const read of ['fs/list', 'fs/read', 'fs/search', 'record/retrieve_result', 'memory/memory_search', 'vault/vault_read']) {
      expect(route(read)).toEqual({ to: 'allow', by: 'ground' });
    }
    // the Optio's own reads in the ground are reads too
    expect(route('fs/list', { seat: 'optio' })).toEqual({ to: 'allow', by: 'ground' });
  });

  test('always the operator\'s: money out, escalated, outward, deletes, out of the ground, the Optio\'s own acts', () => {
    expect(route('intents/wallet.send').why).toMatch(/money out/);
    expect(route('bench/bench_run').why).toMatch(/benchmark window is the operator's explicit yes/);
    expect(route('bench/bench_run', { charter: charter({ allow: ['bench/bench_run'] }) }).to).toBe('operator');
    expect(route('intents/tasks.focus').why).toMatch(/charter sends/);
    expect(route('intents/social.post').why).toMatch(/posting and email/);
    expect(route('intents/email.send').why).toMatch(/posting and email/);
    expect(route('filesystem/delete_file').why).toMatch(/delete/);
    expect(route('fs/edit', { args: { path: '/h/a.md', delete: true } }).why).toMatch(/delete/);
    expect(route('fs/write', { inGround: false }).why).toMatch(/outside the house's ground/);
    expect(route('fs/read', { inGround: false }).why).toMatch(/outside the house's ground/);
    expect(route('fs/write', { seat: 'optio' }).why).toMatch(/Optio's own acts/);
    for (const r of [route('intents/wallet.send'), route('fs/write', { seat: 'optio' })]) expect(r.to).toBe('operator');
  });

  test('a charter that allows posting lets it proceed; money out can never be allowed', () => {
    expect(route('intents/social.post', { charter: charter({ allow: ['intents/social.post'] }) })).toEqual({ to: 'allow', by: 'charter' });
    expect(() => charter({ allow: ['intents/wallet.send'] })).toThrow(/money out/);
  });

  test('taking something off the operator\'s own list is their yes every time, unless their charter allows it', () => {
    expect(route('intents/tasks.operator-drop')).toEqual({ to: 'operator', why: expect.stringMatching(/their yes, every time/) });
    expect(route('intents/tasks.operator-drop', { charter: charter({ allow: ['intents/tasks.operator-drop'] }) })).toEqual({ to: 'allow', by: 'charter' });
  });

  test('no Optio seated, or one the charter does not seat: the operator\'s', () => {
    expect(route('fs/write', { officer: null }).why).toMatch(/no chartered Optio/);
    expect(route('fs/write', { officer: 'stranger' }).why).toMatch(/no chartered Optio/);
  });

  test('everything else gated is reviewed by the Optio', () => {
    for (const tool of ['fs/write', 'fs/edit', 'intents/tasks.add', 'web/web_fetch', 'intents/board.add']) {
      expect(route(tool)).toEqual({ to: 'review' });
    }
  });

  test('the act\'s paths are read as it will run: an fs primitive routed onto its organ call', () => {
    expect(actPaths('fs/edit', { path: '/h/a.md', destination: '/x/b.md' })).toEqual(['/h/a.md', '/x/b.md']);
    expect(actPaths('fs/read', { paths: ['/h/a.md', '/h/b.md'] })).toEqual(['/h/a.md', '/h/b.md']);
    expect(actPaths('intents/tasks.add', { title: 'x' })).toEqual([]);
  });
});

describe('the review\'s verdict, read from its words', () => {
  test('CLEAR, alone on its first line, clears', () => {
    expect(parseReview('CLEAR')).toEqual({ verdict: 'clear' });
    expect(parseReview('  **CLEAR.**\n')).toEqual({ verdict: 'clear' });
  });
  test('HOLD carries its reason; a HOLD anywhere wins', () => {
    expect(parseReview('HOLD: the path is the operator\'s drafts, not the digest folder')).toEqual({ verdict: 'hold', reason: 'the path is the operator\'s drafts, not the digest folder' });
    expect(parseReview('CLEAR\nHOLD — on reflection the command deletes the build')).toEqual({ verdict: 'hold', reason: 'on reflection the command deletes the build' });
    expect(parseReview('HOLD')).toEqual({ verdict: 'hold', reason: 'the Optio gave no reason' });
  });
  test('anything else is a HOLD — fail closed', () => {
    for (const garbage of ['', 'Looks fine to me.', 'CLEAR to proceed', 'I approve', null]) {
      expect(parseReview(garbage)).toMatchObject({ verdict: 'hold', reason: expect.stringMatching(/did not answer CLEAR or HOLD/) });
    }
  });
});

describe('what the review is shown', () => {
  test('the fixed instruction, then the act, the stated intent, the assignment and the goal', () => {
    const [system, user] = reviewMessages({
      act: { tool: 'fs/write', args: { path: '/house/digest.md', content: 'draft' } },
      member: 'Quae',
      statedIntent: 'I will write the outline into the digest file.',
      assignment: 'Outline the first digest.',
      goal: 'Ship one digest a week.',
    });
    expect(system).toEqual({ role: 'system', content: REVIEW_PROMPT });
    expect(REVIEW_PROMPT).toMatch(/ONE line/);
    expect(user.role).toBe('user');
    for (const part of ['THE ACT: fs/write', '"path": "/house/digest.md"', 'I will write the outline into the digest file.', 'Outline the first digest.', 'Ship one digest a week.', 'THE MEMBER: Quae']) {
      expect(user.content).toContain(part);
    }
  });
  test('a long stated intent keeps its tail (the words just before the act); long args say they were cut', () => {
    const [, user] = reviewMessages({
      act: { tool: 'fs/write', args: { content: 'x'.repeat(9000) } },
      member: 'Quae',
      statedIntent: `${'filler '.repeat(400)}NOW I WRITE THE FILE`,
    });
    expect(user.content).toContain('NOW I WRITE THE FILE');
    expect(user.content).toMatch(/more characters not shown/);
  });
});
