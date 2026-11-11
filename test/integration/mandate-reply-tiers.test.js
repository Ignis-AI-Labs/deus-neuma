/**
 * THE REPLY TIERS AT THE REAL DOOR (Design note, 2026-11-11: […]). RULE 0: the real reply handler, the
 * real mandate, the real claims check, the real queue, and the real poster on
 * a loopback X — no mock anywhere.
 *
 * Proven: with replies granted, an EASY answer goes out at once with no card;
 * an AWARENESS answer (money on either side, an argument, the seat's own
 * raise) waits as the operator's draft, the seat is told why, nothing reaches
 * X and the mandate stays ACTIVE; with no mandate the tier changes nothing.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getChannel } from '../../backend/services/social/channel-registry.js';
import { grantMandate } from '../../backend/services/marketing/mandate/mandate-lifecycle.js';
import { readMandate } from '../../backend/services/marketing/mandate/mandate-store.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import {
  buildMandateHouse, teardownMandateHouse, resetHouse, grantInput, HOUSE,
} from '../helpers/mandate-house-kit.js';

const { _handleNeumaReply } = __test;
const REPLIES = { acts: { posts: true, renders: true, replies: true }, replyPace: 10 };
const C_MONEY = {
  postId: '2007', conversationId: '907', authorId: '46', username: 'lpcurious', verified: false, verifiedType: null,
  text: 'if a mint costs $100, does one referral really pay $10?', postCreatedAt: '2026-07-28T00:07:00Z',
};
const C_ARGUMENT = {
  postId: '2009', conversationId: '909', authorId: '48', username: 'skeptic', verified: false, verifiedType: null,
  text: 'honestly this is overhyped', postCreatedAt: '2026-07-28T00:09:00Z',
};

let h;
beforeAll(async () => {
  h = await buildMandateHouse();
  await h.candidates.add(C_MONEY);
  await h.candidates.add(C_ARGUMENT);
}, 30000);
afterAll(async () => { await teardownMandateHouse(h); });
beforeEach(async () => { await resetHouse(h); });

const answer = (toPostId, text, extra = {}) => _handleNeumaReply(h.serverWs, h.connection, null, 'ask', { toPostId, text, ...extra }, getChannel('x'));
const entryFor = async (toPostId) => (await postQueue.load()).find((e) => e.reply?.toPostId === toPostId);
const carded = () => h.clientLog.some((m) => m.type === 'tool:approval_request');

describe('replies granted', () => {
  test('EASY: a warm answer goes out at once, no card', async () => {
    await grantMandate(HOUSE, grantInput(REPLIES));
    const out = await answer('2001', 'Thank you for reading it.');
    expect(out.content).toContain('under your mandate');
    expect(carded()).toBe(false);
    expect(h.x.state.posts).toHaveLength(1);
    expect(await entryFor('2001')).toMatchObject({ status: 'sent' });
  });

  test('AWARENESS: money in what they asked waits as a draft — even for a pointer — and the seat is told why', async () => {
    await grantMandate(HOUSE, grantInput(REPLIES));
    h.decide = () => 'allow'; // the ordinary staging card, answered at the desk
    const out = await answer('2007', 'Good question — the docs have the full breakdown.');
    expect(out.status).toBe('ok');
    expect(out.content).toContain('Your mandate leaves this one to your operator — awareness: money (mint, $100, referral, $10).');
    expect(carded()).toBe(true);
    expect(h.x.state.posts).toEqual([]);
    expect(await entryFor('2007')).toMatchObject({ status: 'draft', reply: { category: 'ordinary' } });
    expect((await readMandate(HOUSE)).status).toBe('active');
  });

  test('AWARENESS: an argument, and an answer the seat raised itself, wait; the next easy one still flows', async () => {
    await grantMandate(HOUSE, grantInput(REPLIES));
    h.decide = () => 'allow';
    const argued = await answer('2009', 'Fair — try it and tell us where it falls short.');
    expect(argued.content).toContain('awareness: an argument');
    const raised = await answer('2005', 'Glad to have you.', { awareness: true });
    expect(raised.content).toContain('awareness: you asked for your operator\'s eyes');
    expect(h.x.state.posts).toEqual([]);
    h.clientLog.length = 0;
    const easy = await answer('2001', 'Thank you for reading it.');
    expect(easy.content).toContain('under your mandate');
    expect(carded()).toBe(false);
    expect(h.x.state.posts).toHaveLength(1);
    expect((await readMandate(HOUSE)).status).toBe('active');
  });
});

describe('no mandate', () => {
  test('the tier changes nothing: every answer is the operator\'s card, and the seat hears no tier', async () => {
    h.decide = () => 'allow';
    const out = await answer('2001', 'Thank you for reading it.');
    expect(carded()).toBe(true);
    expect(out.content).not.toContain('awareness');
    expect(await entryFor('2001')).toMatchObject({ status: 'draft' });
    expect(h.x.state.posts).toEqual([]);
  });
});
