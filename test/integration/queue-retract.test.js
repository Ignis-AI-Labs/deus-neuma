/**
 * TAKING BACK WHAT THE HOUSE SAID (Design note, 2026-11-12: […]). RULE 0: the real reply door, the real queue, the real ACTS card over a
 * real WebSocket pair, the real signed DELETE against a loopback X — no mock.
 *
 * Proven: a SENT answer is retracted on the operator's card — deleted on X,
 * kept in the record as RETRACTED — and the reply it answered can be answered
 * again with the corrected words; DENY deletes nothing; an unsent post is sent
 * to queue_cancel; X refusing leaves the record as it was. And the CMO edits
 * its OWN draft with no card, the words still waiting on the operator.
 *
 * Not proven here: X's own DELETE endpoint (the loopback answers in X's
 * documented shape; a live delete has not been run).
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getChannel } from '../../backend/services/social/channel-registry.js';
import { grantMandate } from '../../backend/services/marketing/mandate/mandate-lifecycle.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { buildMandateHouse, teardownMandateHouse, resetHouse, grantInput, HOUSE, CMO } from '../helpers/mandate-house-kit.js';

const { _handleNeumaReply, _handleSocialTool, _handleNeumaQueueUpdate } = __test;
const REPLIES = { acts: { posts: true, renders: true, replies: true }, replyPace: 10 };

let h;
beforeAll(async () => { h = await buildMandateHouse(); }, 30000);
afterAll(async () => { await teardownMandateHouse(h); });
beforeEach(async () => { await resetHouse(h); });

const answer = (toPostId, text) => _handleNeumaReply(h.serverWs, h.connection, null, 'ask', { toPostId, text }, getChannel('x'));
const retract = (args) => _handleSocialTool(h.serverWs, h.connection, null, 'ask', { toolName: 'queue_retract', tool: 'social/queue_retract' }, args);
const carded = () => h.clientLog.filter((m) => m.type === 'tool:approval_request');
const sentAnswer = async () => {
  await grantMandate(HOUSE, grantInput(REPLIES));
  await answer('2001', 'Thank you for reading it.');
  const entry = (await postQueue.load()).find((e) => e.reply?.toPostId === '2001');
  expect(entry).toMatchObject({ status: 'sent', postId: expect.stringMatching(/^\d+$/) });
  h.clientLog.length = 0;
  return entry;
};

describe('retract a sent answer', () => {
  test('on the operator\'s card it is deleted on X, kept as RETRACTED, and the reply can be answered again', async () => {
    const entry = await sentAnswer();
    h.decide = () => 'allow';
    const out = await retract({ id: entry.id, reason: 'it named the wrong window' });
    expect(out.status).toBe('ok');
    expect(carded()[0].args).toContain('Thank you for reading it.');
    expect(carded()[0].args).toContain('it named the wrong window');
    expect(h.x.state.deleted).toEqual([entry.postId]);
    expect((await postQueue.load()).find((e) => e.id === entry.id)).toMatchObject({ status: 'retracted', retractReason: 'it named the wrong window', retractedBy: 'ReplyLaneEcho' });
    expect(out.content).toContain('The reply it answered can be answered again');

    const corrected = await answer('2001', 'Thank you — and a correction: the window is closed.');
    expect(corrected.content).toContain('under your mandate');
    expect(h.x.state.posts).toHaveLength(2);
  });

  test('DENY deletes nothing and the record stands', async () => {
    const entry = await sentAnswer();
    h.decide = () => 'deny';
    const out = await retract({ id: entry.id, reason: 'second thoughts' });
    expect(out.status).toBe('denied');
    expect(h.x.state.deleted).toEqual([]);
    expect((await postQueue.load()).find((e) => e.id === entry.id).status).toBe('sent');
  });

  test('X refusing the delete leaves the record as it was, and says so', async () => {
    const entry = await sentAnswer();
    h.decide = () => 'allow';
    h.x.state.mode = 'refuse-delete';
    const out = await retract({ id: entry.id, reason: 'wrong' });
    expect(out.status).toBe('error');
    expect(out.error).toContain(`X did not delete ${entry.postId}: You are not allowed to delete this Tweet. (HTTP 403). Nothing in the record changed`);
    expect((await postQueue.load()).find((e) => e.id === entry.id).status).toBe('sent');
  });

  test('an unsent post is pointed to queue_cancel before any card', async () => {
    const draft = await postQueue.add({ channelId: 'x', text: 'not out yet', authorNeumaId: CMO, queuedBy: CMO });
    h.decide = () => 'allow';
    const out = await retract({ id: draft.id, reason: 'x' });
    expect(out.error).toContain('it is draft, not sent — an unsent post is pulled with queue_cancel');
    expect(carded()).toEqual([]);
    expect(h.x.state.deleted).toEqual([]);
  });
});

describe('edit its own draft', () => {
  test('no card; the new words still wait on the operator', async () => {
    const draft = await postQueue.add({ channelId: 'x', text: 'The window is open until November.', authorNeumaId: CMO, queuedBy: CMO });
    h.decide = () => 'deny'; // were a card to rise, it would refuse
    const out = await _handleNeumaQueueUpdate(h.serverWs, h.connection, null, 'ask', { id: draft.id, text: 'The migration window is closed.' }, getChannel('x'));
    expect(out.status).toBe('ok');
    expect(carded()).toEqual([]);
    expect((await postQueue.load()).find((e) => e.id === draft.id)).toMatchObject({ status: 'draft', text: 'The migration window is closed.' });
  });
});
