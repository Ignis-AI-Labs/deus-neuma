/**
 * The MANDATE's pure law — real inputs, real outputs, nothing faked (pure
 * functions need no stand-in). The integration suites prove the doors.
 */
import { describe, test, expect } from 'vitest';
import {
  settleGrant, mandateStanding, coverPost, coverRender, legalTrips, isSpamRefusal, paceDay, plainWords,
} from '../../backend/services/marketing/mandate/mandate-shape.js';
import { mandateGuidance, mandateBriefingLine, mandateWaitingItem } from '../../backend/services/marketing/mandate/mandate-words.js';
import { feedRows } from '../../backend/services/marketing/mandate/mandate-feed.js';
import { chipLine, canWithdraw } from '../../frontend/app/RelinkShell/mandate/mandate-view.js';
import { statusMark, feedKeyOf } from '../../frontend/app/RelinkShell/post-status-marks.js';
import { initialGrant, grantBody } from '../../frontend/app/RelinkShell/mandate/mandate-grant-view.js';

const HOUSE = `0x${'5e'.repeat(20)}`;
const NOW = new Date('2026-10-24T10:00:00Z');
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', companyId: 'neuma' },
  { id: 'x-2', channelId: 'x', companyId: 'ignis' },
  { id: 'tiktok-1', channelId: 'tiktok', companyId: 'neuma' },
];
const ctx = { accounts: ACCOUNTS, house: HOUSE, laneId: 'kestrel', by: HOUSE, now: NOW, id: 'md_1' };
const grant = (input = {}) => settleGrant({ accounts: [{ id: 'x-1' }], timeZone: 'UTC', ...input }, ctx).mandate;
const post = (over = {}) => ({ id: 'q1', channelId: 'x', accountId: 'x-1', text: 'hello', scheduledFor: null, ...over });
const approvedUnder = (n, at = '2026-10-24T09:00:00Z') => Array.from({ length: n }, (_, i) => (
  { id: `p${i}`, channelId: 'x', accountId: 'x-1', status: 'sent', decidedUnder: 'md_1', sentAt: at }));

describe('the grant', () => {
  test('defaults small: 2 posts a day, 7 days, posts and renders on, replies OFF, legal pauses at high', () => {
    const m = grant();
    expect(m).toMatchObject({ status: 'active', laneId: 'kestrel', days: 7, replyPace: 5, legalPauseAt: 'high' });
    expect(m.accounts).toEqual([{ id: 'x-1', channelId: 'x', companyId: 'neuma', pace: 2 }]);
    expect(m.acts).toEqual({ posts: true, renders: true, replies: false });
    expect(m.expiresAt).toBe('2026-10-31T10:00:00.000Z');
    expect(m.companies).toEqual(['neuma']);
  });

  test('a new grant always turns itself off: "until withdrawn" is refused; pace and days are clamped', () => {
    expect(settleGrant({ accounts: [{ id: 'x-1' }], untilWithdrawn: true }, ctx).error).toContain('always turns itself off');
    const m = grant({ accounts: [{ id: 'x-1', pace: 99 }] });
    expect(m.accounts[0].pace).toBe(12);
    expect(grant({ days: 400 }).days).toBe(90);
    expect(grant({ days: 400 }).expiresAt).toBe('2027-01-22T10:00:00.000Z');
    expect(grant({ days: 0 }).days).toBe(1);
  });

  test('a stored open-ended mandate (from before the ruling) still reads as it is', () => {
    const old = { ...grant(), days: null, expiresAt: null };
    expect(mandateStanding(old, new Date('2027-06-01T00:00:00Z'))).toBe('active');
    expect(plainWords(old)[0]).toContain('until you withdraw it');
  });

  test('refused: no account, an account the house lacks, TikTok (its own yes on every post), no act', () => {
    expect(settleGrant({ accounts: [] }, ctx).error).toContain('at least one account');
    expect(settleGrant({ accounts: [{ id: 'x-9' }] }, ctx).error).toContain('no account "x-9"');
    expect(settleGrant({ accounts: [{ id: 'tiktok-1' }] }, ctx).error).toContain('cannot ride a mandate');
    expect(settleGrant({ accounts: [{ id: 'x-1' }], acts: { posts: false, renders: false } }, ctx).error).toContain('at least one act');
  });
});

describe('standing', () => {
  test('active, paused, withdrawn, expired, none', () => {
    const m = grant();
    expect(mandateStanding(null)).toBe('none');
    expect(mandateStanding(m, NOW)).toBe('active');
    expect(mandateStanding({ ...m, status: 'paused' }, NOW)).toBe('paused');
    expect(mandateStanding({ ...m, status: 'withdrawn' }, NOW)).toBe('withdrawn');
    expect(mandateStanding(m, new Date('2026-11-01T00:00:00Z'))).toBe('expired');
  });
});

describe('what a mandate covers', () => {
  const judge = (m, entry, extra = {}) => coverPost(m, { house: HOUSE, laneId: 'kestrel', entry, entries: [], now: NOW, ...extra });

  test('an in-scope post is covered', () => {
    expect(judge(grant(), post()).verdict).toBe('covered');
  });

  test('out of scope asks: another account, TikTok, a thread follow-up, a reply when replies are off, after the term, another lane', () => {
    const m = grant();
    expect(judge(m, post({ accountId: 'x-2' }))).toMatchObject({ verdict: 'ask' });
    expect(judge(m, post({ channelId: 'tiktok', accountId: 'tiktok-1' }))).toMatchObject({ verdict: 'ask' });
    expect(judge(m, post({ kind: 'self-reply' }))).toMatchObject({ verdict: 'ask' });
    expect(judge(m, post({ kind: 'reply' }))).toMatchObject({ verdict: 'ask', reason: 'replies are not in the mandate' });
    expect(judge(m, post({ scheduledFor: '2026-11-02T00:00:00Z' }))).toMatchObject({ verdict: 'ask', reason: 'it goes out after the mandate ends' });
    expect(coverPost(m, { house: HOUSE, laneId: 'ash', entry: post(), entries: [], now: NOW }).verdict).toBe('ask');
    expect(judge({ ...m, status: 'paused' }, post()).verdict).toBe('ask');
  });

  test('the pace trips on the operator\'s own day, not UTC\'s', () => {
    const m = grant({ timeZone: 'Asia/Jakarta' });
    // 09:00Z is 16:00 in Jakarta on the 24th: two already stand that day.
    expect(judge(m, post(), { entries: approvedUnder(2) })).toMatchObject({ verdict: 'trip', kind: 'pace' });
    // 18:00Z on the 24th is already the 25th in Jakarta: a fresh day.
    expect(judge(m, post({ scheduledFor: '2026-10-24T18:00:00Z' }), { entries: approvedUnder(2) }).verdict).toBe('covered');
    expect(paceDay('2026-10-24T18:00:00Z', 'Asia/Jakarta')).toBe('2026-10-25');
  });

  test('crossing companies or houses trips', () => {
    const m = grant();
    expect(judge(m, post(), { campaignCompanyId: 'ignis', accountCompanyId: 'neuma' })).toMatchObject({ verdict: 'trip', kind: 'cross-company' });
    expect(judge(m, post(), { house: `0x${'b2'.repeat(20)}` })).toMatchObject({ verdict: 'trip', kind: 'cross-house' });
  });

  test('renders, legal thresholds, spam refusals', () => {
    expect(coverRender(grant(), { house: HOUSE, laneId: 'kestrel', now: NOW }).verdict).toBe('covered');
    expect(coverRender(grant({ acts: { posts: true, renders: false } }), { house: HOUSE, laneId: 'kestrel', now: NOW }).verdict).toBe('ask');
    expect(legalTrips(grant(), 'high')).toBe(true);
    expect(legalTrips(grant(), 'medium')).toBe(false);
    expect(legalTrips(grant({ legalPauseAt: 'medium' }), 'medium')).toBe(true);
    expect(isSpamRefusal({ ok: false, detail: 'This request looks like it might be automated.' })).toBe(true);
    expect(isSpamRefusal({ ok: false, detail: 'fetch failed: ECONNREFUSED' })).toBe(false);
    expect(isSpamRefusal({ ok: true })).toBe(false);
  });
});

describe('words', () => {
  test('the grant in plain words, and what the seat reads', () => {
    const m = grant();
    expect(plainWords(m, { seatName: 'Kestrel' })[0]).toBe('Kestrel may post on x-1 (2 a day) and make images and videos without asking you, until it turns itself off on Oct 31.');
    expect(plainWords(m).join(' ')).toContain('anything drawn from it waits on you, and the rest goes on');
    expect(plainWords(m)).toContain('Replies still ask you.');
    expect(mandateGuidance(m, { now: NOW })).toContain('Your operator trusts you');
    expect(mandateGuidance(m, { now: NOW })).toContain('WHAT IS HELD (the rest goes on)');
    expect(mandateGuidance(null)).toContain('No mandate stands for you');
    expect(mandateBriefingLine({ current: m, past: [] }, { now: NOW })).toMatch(/^MANDATE: .*x-1 2\/day, renders.*mandate_read/);
    expect(mandateBriefingLine({ current: null, past: [] }, { now: NOW })).toBe('');
    const withdrawn = { ...m, status: 'withdrawn', withdrawnAt: '2026-10-24T09:00:00Z' };
    expect(mandateBriefingLine({ current: null, past: [withdrawn] }, { now: NOW })).toMatch(/^MANDATE WITHDRAWN/);
  });

  test('a paused mandate is one WAITING ON YOU row; an active one is none', () => {
    const m = grant();
    expect(mandateWaitingItem(m, { now: NOW })).toBeNull();
    const paused = { ...m, status: 'paused', pausedAt: '2026-10-24T09:30:00Z', pause: { reason: 'drill' } };
    expect(mandateWaitingItem(paused, { seatName: 'Kestrel', now: NOW })).toMatchObject({ kind: 'mandate', who: { name: 'Kestrel' }, where: { app: 'marketing' } });
  });
});

describe('DONE FOR YOU', () => {
  test('acts join their queue entry; events read as what the operator did', () => {
    const journal = [
      { at: '2026-10-24T09:05:00Z', kind: 'withdrawn', cancelled: ['q2'], inFlight: [] },
      { at: '2026-10-24T09:01:00Z', kind: 'act', act: 'post', queueId: 'q2', channelId: 'x', accountId: 'x-1', text: 'two' },
      { at: '2026-10-24T09:00:00Z', kind: 'act', act: 'post', queueId: 'q1', channelId: 'x', accountId: 'x-1', text: 'one' },
      { at: '2026-10-24T08:59:00Z', kind: 'act', act: 'video', text: 'a clip' },
    ];
    const rows = feedRows(journal, [
      { id: 'q1', channelId: 'x', status: 'sent', postId: '77' },
      { id: 'q2', channelId: 'x', status: 'withdrawn' },
    ]);
    expect(rows.map((r) => [r.what, r.status])).toEqual([
      ['You withdrew the mandate', 'withdrawn'], ['Posted', 'withdrawn'], ['Posted', 'sent'], ['Made a video', 'done'],
    ]);
    expect(rows[0].text).toBe('1 queued post(s) cancelled');
    expect(rows[2].link).toBe('https://x.com/i/web/status/77');
    expect(rows.map((r) => statusMark(feedKeyOf(r)).name)).toEqual(['MANDATE OFF', 'WITHDRAWN', 'SENT', 'DONE']);
  });
});

describe('the desk\'s view', () => {
  test('the grant screen starts with nothing chosen, TikTok never offered, and every body it sends has an end', () => {
    const draft = initialGrant([{ id: 'x-1' }, { id: 'tiktok-1', perPostConsent: true }]);
    expect(Object.keys(draft.accounts)).toEqual(['x-1']);
    const chosen = { ...draft, accounts: { 'x-1': { on: true, pace: 3 } } };
    expect(grantBody(chosen, 'UTC')).toEqual({
      accounts: [{ id: 'x-1', pace: 3 }], acts: chosen.acts, replyPace: 5, days: 7, timeZone: 'UTC',
    });
    expect(chipLine('active')).toMatchObject({ tone: 'live', label: 'MANDATE ON' });
    expect(chipLine('none')).toBeNull();
    expect(canWithdraw('paused')).toBe(true);
    expect(canWithdraw('withdrawn')).toBe(false);
  });
});
