/**
 * THE MANDATE — the flow (RULE 0: the real sweep, queue, scheduler, poster
 * against a loopback X, the real realm on temp disk; no mock anywhere).
 *
 * Design note, 2026-10-24: […]. Proven here: a post inside the mandate flows with no card and
 * is shown in DONE FOR YOU; outside it, it asks; the pace pauses; WITHDRAW
 * cancels what has not left and nothing more sends; a send re-reads the
 * mandate; a paused mandate holds and resumes; another house is untouched.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { schedulerTick } from '../../backend/services/social/post-scheduler.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { readWaiting } from '../../backend/services/waiting/waiting-sources.js';
import { grantMandate, withdrawMandate, resumeMandate } from '../../backend/services/marketing/mandate/mandate-lifecycle.js';
import { readMandate, mutateMandate, retire } from '../../backend/services/marketing/mandate/mandate-store.js';
import { readMandateView } from '../../backend/services/marketing/mandate/mandate-feed.js';
import { tripMandate } from '../../backend/services/marketing/mandate/mandate-tripwire.js';
import { KIND } from '../../core/runtime/notification-record.js';
import {
  buildMandateHouse, teardownMandateHouse, resetHouse, stagePost, entryOf, lastEntry,
  notified, seatTold, grantInput, soon, HOUSE,
} from '../helpers/mandate-house-kit.js';

const OTHER_HOUSE = `0x${'b2'.repeat(20)}`;

let h;
beforeAll(async () => { h = await buildMandateHouse(); }, 30000);
afterAll(async () => { await teardownMandateHouse(h); });
beforeEach(async () => { await resetHouse(h); });

describe('inside the mandate, a post needs no card', () => {
  test('staged → approved under the mandate → sent by the scheduler → shown LIVE in DONE FOR YOU', async () => {
    const granted = await grantMandate(HOUSE, grantInput());
    expect(granted.ok).toBe(true);
    // The desk's account carries the ACTIVE mandate beside its items — the bell's quiet mark — and owes no row for it.
    const standing = await readWaiting(HOUSE);
    expect(standing.mandate).toEqual({ expiresAt: granted.mandate.expiresAt, timeZone: granted.mandate.timeZone || 'UTC' });
    expect(standing.mandate.expiresAt).toEqual(expect.any(String));
    expect(standing.items.some((i) => i.kind === 'mandate')).toBe(false);
    const [receipt] = await stagePost(h, { text: 'The armillary turns tonight.' });
    expect(receipt.status).toBe('ok');
    expect(receipt.content).toContain('approved under your mandate');
    const staged = await lastEntry();
    expect(staged).toMatchObject({ status: 'approved', decidedBy: HOUSE, decidedUnder: granted.mandate.id });
    // No approval card ever reached the operator's screen.
    expect(h.clientLog.filter((m) => m.type === 'tool:approval_request')).toEqual([]);

    await schedulerTick(Date.now());
    const sent = await entryOf(staged.id);
    expect(sent.status).toBe('sent');
    // Exactly the words on the record went out — the record the operator sees.
    expect(h.x.state.posts.map((p) => p.text)).toEqual([staged.text]);
    expect(staged.text.startsWith('The armillary turns tonight.')).toBe(true);

    const view = await readMandateView(HOUSE);
    expect(view.standing).toBe('active');
    const row = view.feed.find((r) => r.queueId === staged.id);
    expect(row).toMatchObject({ kind: 'act', what: 'Posted', status: 'sent', link: expect.stringMatching(new RegExp(`/status/${sent.postId}$`)) });
    // The desk draws the mandate as marks: its accounts and pace, and what pauses it, each tripwire named in its own words.
    expect(view.mandate.accounts.map((a) => [a.id, a.pace])).toEqual([['x-1', 2]]);
    expect(Object.keys(view.trips)).toEqual(['pace', 'legal', 'spam', 'rogue', 'widen', 'cross-company', 'cross-house']);
    expect(view.never.map((n) => n.mark)).toContain('NO MONEY');
  });

  test('outside the mandate it asks: an account the mandate does not hold stays a draft for the operator', async () => {
    await grantMandate(HOUSE, grantInput({ accounts: [{ id: 'x-1', pace: 2 }], acts: { posts: false, renders: true } }));
    const [receipt] = await stagePost(h, { text: 'Posts are not in this mandate.' });
    expect(receipt.content).toContain('your operator decides this draft');
    expect((await lastEntry()).status).toBe('draft');
    expect((await lastEntry()).decidedUnder).toBeUndefined();
  });

  test('with no mandate, nothing changes: the draft waits on the operator exactly as before', async () => {
    await stagePost(h, { text: 'No mandate stands.' });
    const entry = await lastEntry();
    expect(entry.status).toBe('draft');
    await schedulerTick(Date.now());
    expect((await entryOf(entry.id)).status).toBe('draft');
    expect(h.x.state.posts).toEqual([]);
  });
});

describe('the pace is a tripwire, never a silent block', () => {
  test('the post past the daily pace PAUSES the mandate, stays a draft, alerts the operator and tells the seat', async () => {
    await grantMandate(HOUSE, grantInput({ accounts: [{ id: 'x-1', pace: 1 }] }));
    await stagePost(h, { text: 'One a day — this is the one.' });
    expect((await lastEntry()).status).toBe('approved');
    const [receipt] = await stagePost(h, { text: 'And a second the same day.' });
    expect(receipt.content).toContain('PAUSED');
    expect((await lastEntry()).status).toBe('draft');

    const mandate = await readMandate(HOUSE);
    expect(mandate.status).toBe('paused');
    expect(mandate.pause.kind).toBe('pace');
    expect((await notified(KIND.mandateAlert)).map((r) => r.title)).toEqual([expect.stringContaining('PAUSED')]);
    const waiting = await readWaiting(HOUSE);
    expect(waiting.items.find((i) => i.kind === 'mandate')).toMatchObject({ where: { app: 'marketing' } });
    // Paused, it waits as a row — the bell's ACTIVE mark is gone.
    expect(waiting.mandate).toBeNull();
    expect((await seatTold()).some((t) => t.startsWith('Your mandate is PAUSED'))).toBe(true);
  });
});

describe('WITHDRAW — the contingency plan', () => {
  test('cancels what has not left, nothing more sends, the seat is told, and the next post asks', async () => {
    await grantMandate(HOUSE, grantInput({ accounts: [{ id: 'x-1', pace: 3 }] }));
    await stagePost(h, { text: 'Queued for later, one.', scheduledFor: soon(5 * 60_000) });
    await stagePost(h, { text: 'Queued for later, two.', scheduledFor: soon(6 * 60_000) });
    const queued = (await postQueue.load()).filter((e) => e.status === 'approved');
    expect(queued).toHaveLength(2);

    const out = await withdrawMandate(HOUSE, { by: HOUSE, reason: 'rogue drill' });
    expect(out.ok).toBe(true);
    expect(out.cancelled.sort()).toEqual(queued.map((e) => e.id).sort());
    for (const e of queued) expect(await entryOf(e.id)).toMatchObject({ status: 'withdrawn', withdrawnReason: 'mandate-withdrawn' });

    await schedulerTick(Date.now() + 10 * 60_000);
    expect(h.x.state.posts).toEqual([]);
    expect((await seatTold()).some((t) => t.startsWith('Your operator WITHDREW your mandate. 2 queued post(s)'))).toBe(true);

    const [after] = await stagePost(h, { text: 'After the withdrawal.' });
    expect(after.content).toContain('your operator decides this draft');
    expect((await lastEntry()).status).toBe('draft');
    expect((await readMandateView(HOUSE)).standing).toBe('none');
    expect((await readWaiting(HOUSE)).mandate).toBeNull();
  });

  test('the send re-reads the mandate: an approval whose mandate ended underneath it is cancelled, never sent', async () => {
    await grantMandate(HOUSE, grantInput());
    await stagePost(h, { text: 'Approved, then the mandate ends behind the queue.' });
    const entry = await lastEntry();
    // The record alone moves — as a CLI at the machine, or a crash between
    // the withdrawal and its sweep, would leave it.
    await mutateMandate(HOUSE, (record) => ({ record: retire(record, { ...record.current, status: 'withdrawn' }), result: {} }));
    await schedulerTick(Date.now());
    expect(await entryOf(entry.id)).toMatchObject({ status: 'withdrawn', withdrawnBy: 'system', withdrawnReason: 'mandate-withdrawn' });
    expect(h.x.state.posts).toEqual([]);
  });

  test('a paused mandate holds what it approved; RESUME lets it go', async () => {
    await grantMandate(HOUSE, grantInput());
    await stagePost(h, { text: 'Approved before the pause.' });
    const entry = await lastEntry();
    await tripMandate(HOUSE, { kind: 'rogue', detail: 'drill' });
    await schedulerTick(Date.now());
    expect((await entryOf(entry.id)).status).toBe('approved');
    expect(h.x.state.posts).toEqual([]);

    expect((await resumeMandate(HOUSE)).ok).toBe(true);
    await schedulerTick(Date.now());
    expect((await entryOf(entry.id)).status).toBe('sent');
    expect((await seatTold()).some((t) => t.startsWith('Your operator RESUMED your mandate'))).toBe(true);
  });

  test('a mandate is changed whole: a second grant while one stands is refused', async () => {
    await grantMandate(HOUSE, grantInput());
    const again = await grantMandate(HOUSE, grantInput({ accounts: [{ id: 'x-1', pace: 12 }] }));
    expect(again.ok).toBe(false);
    expect(again.error).toContain('withdraw it first');
    expect((await readMandate(HOUSE)).accounts[0].pace).toBe(2);
  });
});

describe('houses are never confused', () => {
  test('another house\'s drafts and record are untouched by this house\'s mandate and its withdrawal', async () => {
    // The other house's operator stages its own draft (an operator-authored entry names its house).
    const theirs = await postQueue.add({ channelId: 'x', text: 'The other house speaks for itself.', queuedBy: OTHER_HOUSE });
    await grantMandate(HOUSE, grantInput());
    await stagePost(h, { text: 'This house, under its mandate.' });
    await schedulerTick(Date.now());
    await withdrawMandate(HOUSE, { by: HOUSE });
    expect(await entryOf(theirs.id)).toMatchObject({ status: 'draft' });
    expect((await entryOf(theirs.id)).decidedUnder).toBeUndefined();
    expect(await readMandate(OTHER_HOUSE)).toBeNull();
    expect((await readWaiting(OTHER_HOUSE)).items.some((i) => i.kind === 'mandate')).toBe(false);
    // The other house holds no CMO: it cannot be granted one, and this house's record is not its to read.
    expect((await grantMandate(OTHER_HOUSE, grantInput())).ok).toBe(false);
    expect((await readMandateView(OTHER_HOUSE)).feed).toEqual([]);
  });
});
