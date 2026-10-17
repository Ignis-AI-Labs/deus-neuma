/**
 * THE REPLY LANE — the stage gates, end to end with NO mock on any claimed
 * path (RULE 0). (The publish wire + being-driven read live in
 * reply-lane-wire.test.js; the shared house in helpers/reply-lane-house.js.)
 *
 * A. queue_reply_to_x — REAL WebSocket pair, REAL policy cascade, REAL
 *    candidate store and REAL queue on REAL temp disk. The lane's gates are
 *    proven: our-posts-only (the record is the target list), set-aside
 *    replies refused, the live per-conversation cap, the crew gate, the
 *    fail-closed ACTS chip.
 * B. _replyCandidatesSection — the binding-gated knock: the X holder is told,
 *    honestly counted with the escalation read; every other lane reads ''
 *    (prompt byte-identical).
 *
 * LAW CHANGES (Design note, 2026-07-28, second call — noted where they bite):
 *  - verification is a DISPLAYED signal, never a gate — an unverified
 *    author IS answerable;
 *  - the cap counts per (person, CONVERSATION), never a lifetime exclusion.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { __test } from '../../backend/services/portal-test-surface.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import {
  NEUMA_ID, C_VERIFIED,
  buildReplyLaneHouse, teardownReplyLaneHouse,
  freshConnection as fresh, untilClient as until,
} from '../helpers/reply-lane-house.js';

const {
  _handleNeumaReply, _handleNeumaReplyDismiss, _replyCandidatesSection,
  _queueReplyToolChannel, _replyDismissToolChannel, _handleSocialTool, SOCIAL_TOOLS,
} = __test;

describe('the reply lane — gates (real WS + real stores, gnosis)', () => {
  let h;

  const freshConnection = () => fresh(h);
  const untilClient = (pred, ms) => until(h, pred, ms);

  beforeAll(async () => {
    h = await buildReplyLaneHouse();
  }, 60000);

  afterAll(async () => {
    await teardownReplyLaneHouse(h);
  });

  // ---- B. the knock (runs first: its counts assume an empty queue) ----

  test('NOTIFICATION — the X holder is told, honestly counted; every other lane reads nothing', async () => {
    const holder = await _replyCandidatesSection({ companion: { name: 'ReplyLaneEcho', neumaId: NEUMA_ID } });
    // LAW CHANGE (2026-07-28, second call): answerable is NOT verified-gated
    // — the unverified reply counts; verification rides as a displayed count.
    expect(holder).toContain('3 replies to the house on X from 2 people — 3 answerable (2 verified, 3 substantive).');
    expect(holder).toContain('queue_reply_to_x');
    expect(holder).toContain('reply_dismiss_to_x');
    expect(holder).toContain('at most 2 per conversation');
    // THE SUBSTANCE READ rides the knock (Design note, 2026-07-28: the being is told
    // to work genuine engagement first — a signal, never a gate.
    expect(holder).toContain('answer the substantive ones first');
    // ANY PUBLIC POST (Design note, 2026-10-12: […]): the holder is told the tool answers any post, by id or link, and that a
    // reply goes out on approval — and is never told to hand over text to paste.
    expect(holder).toContain('answers ANY public post on X');
    expect(holder).toContain('never hand your operator text to paste by hand');
    expect(holder).toContain('goes out the moment they approve it');
    expect(holder).not.toContain('scheduledFor');

    // A lane that does not HOLD the X binding gets '' — its prompt is
    // byte-identical to before this section existed.
    const other = await _replyCandidatesSection({ companion: { name: 'Intruder', neumaId: 'someotherneuma' } });
    expect(other).toBe('');
    // And a bare portal (no being) gets ''.
    expect(await _replyCandidatesSection({ companion: null })).toBe('');
  });

  // ---- A. the stage gate ----

  test('THE TARGET IS REAL — a post off the record that X cannot show is refused before any chip', async () => {
    // Since 2026-10-12 any public post is answerable, read live from X. A post X cannot show
    // (here: X unreachable, a dead loopback — this gate test never touches a network) is no target.
    const savedRoot = process.env.NEUMA_X_API_ROOT;
    process.env.NEUMA_X_API_ROOT = 'http://127.0.0.1:9/2';
    try {
      const connection = freshConnection();
      h.serverWs.__connection = connection;
      h.clientLog.length = 0;
      h.decide = null; // the witness must never even be asked

      const result = await _handleNeumaReply(h.serverWs, connection, null, 'auto', { toPostId: '9999', text: 'an answer' }, h.channel);
      expect(result.status).toBe('denied');
      expect(result.error).toMatch(/X could not show that post/);
      expect(h.clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    } finally {
      if (savedRoot === undefined) delete process.env.NEUMA_X_API_ROOT;
      else process.env.NEUMA_X_API_ROOT = savedRoot;
    }
  });

  test('LAW CHANGE — an UNVERIFIED author IS answerable (verification is displayed, never a gate)', async () => {
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = () => 'allow';

    const result = await _handleNeumaReply(h.serverWs, connection, null, 'ask', { toPostId: '2003', text: 'we do not post links on command — but you are heard' }, h.channel);
    expect(result.status).toBe('ok');

    // The witness WAS asked (the act is governed), and the entry carries the
    // honest standing: no verification, named as none — not a refusal.
    await untilClient((m) => m.type === 'tool:approval_request');
    const stored = (await postQueue.load()).find((e) => e.reply?.toPostId === '2003');
    expect(stored.status).toBe('draft');
    expect(stored.reply.toVerifiedType).toBe('');
    expect(stored.reply.conversationId).toBe('902');
  }, 30000);

  test('FAIL-CLOSED ACTS — staging pauses on the witness chip, and a reply REFUSES a calendar', async () => {
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = () => 'allow';

    // THE REPLY CLOCK LAW (Design note, 2026-08-06, reversing 2026-07-28's second
    // call): a caller naming a slot is refused at the door with the store's
    // own reason — an answer rides no calendar; approval itself sends it.
    const slotted = await _handleNeumaReply(h.serverWs, connection, null, 'ask', {
      toPostId: '2001',
      text: 'thank you — that means the house',
      scheduledFor: '2026-07-30T00:00:00Z',
      campaignId: 'launch-week',
    }, h.channel);
    expect(slotted.status).toBe('error');
    expect(slotted.error).toContain('carries no schedule');
    // The refused staging landed NOTHING for this target (earlier tests'
    // own drafts, on other targets, rightly remain).
    expect((await postQueue.load()).some((e) => e.reply?.toPostId === '2001')).toBe(false);

    const result = await _handleNeumaReply(h.serverWs, connection, null, 'ask', {
      toPostId: '2001',
      text: 'thank you — that means the house',
      campaignId: 'launch-week',
    }, h.channel);
    expect(result.status).toBe('ok');

    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('social/queue_reply_to_x');

    // The entry landed as a reply DRAFT with the linkage from the RECORD —
    // never from the being's say-so — plus its campaign and the lane's
    // expiry, and NO slot: a reply has none by law.
    const stored = (await postQueue.load()).find((e) => e.reply?.toPostId === '2001');
    expect(stored.status).toBe('draft');
    expect(stored.kind).toBe('reply');
    expect(stored.reply.toPostId).toBe('2001');
    expect(stored.reply.toUserId).toBe('42');
    expect(stored.reply.toUsername).toBe('bluefriend');
    expect(stored.reply.toVerifiedType).toBe('blue');
    expect(stored.reply.conversationId).toBe('900');
    expect(stored.reply.category).toBe('ordinary');
    expect(stored.reply.toTextPreview).toBe(C_VERIFIED.text);
    expect(stored.scheduledFor).toBeNull();
    expect(stored.campaignId).toBe('launch-week');
    expect(Date.parse(stored.expiresAt)).toBeGreaterThan(Date.now());
    expect(stored.authorNeumaId).toBe(NEUMA_ID);
  }, 30000);

  test('THE CAP — a third answer to the same person ON THE SAME CONVERSATION is refused before any chip', async () => {
    // One draft already stands on conversation 900 from the test above;
    // stage a second directly so two live standings exist for (42, 900).
    await postQueue.add({
      channelId: 'x', text: 'a second answer', kind: 'reply',
      reply: { toPostId: '2077', toUserId: '42', toUsername: 'bluefriend', conversationId: '900' },
      queuedBy: NEUMA_ID, authorNeumaId: NEUMA_ID,
    });

    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = null; // the cap refuses BEFORE the witness is asked

    const result = await _handleNeumaReply(h.serverWs, connection, null, 'auto', { toPostId: '2001', text: 'a third answer' }, h.channel);
    expect(result.status).toBe('denied');
    expect(result.error).toContain('already stand');
    expect(result.error).toContain('at most 2 per conversation');
    expect(h.clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  });

  test('THE CAP, OTHER SIDE — the same person on a DIFFERENT conversation is a fresh count', async () => {
    // (42, 900) stands full from the test above; (42, 905) has never been
    // answered. LAW CHANGE (2026-07-28, second call): the cap is per
    // conversation, never a lifetime exclusion.
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = null; // 'auto' — the policy tier allows without a chip

    const result = await _handleNeumaReply(h.serverWs, connection, null, 'auto', { toPostId: '2005', text: 'a place is kept for you' }, h.channel);
    expect(result.status).toBe('ok');
    const stored = (await postQueue.load()).find((e) => e.reply?.toPostId === '2005');
    expect(stored.status).toBe('draft');
    expect(stored.reply.conversationId).toBe('905');
  }, 30000);

  test('OBSERVE MODE holds the reply — watching, not acting', async () => {
    // Clear the cap first so ONLY observe can refuse this one.
    for (const e of await postQueue.load()) await postQueue.withdraw(e.id, { withdrawnBy: 'test' });

    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = null;

    const result = await _handleNeumaReply(h.serverWs, connection, null, 'observe', { toPostId: '2001', text: 'held answer' }, h.channel);
    expect(result.status).toBe('denied');
    expect(result.error).toContain('observe');
    expect(h.clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  });

  test('the matchers accept both dialects and refuse strangers', () => {
    expect(_queueReplyToolChannel({ toolName: 'queue_reply_to_x' })?.id).toBe('x');
    expect(_queueReplyToolChannel({ tool: 'social/queue_reply_to_x' })?.id).toBe('x');
    expect(_queueReplyToolChannel({ toolName: 'queue_reply_to_myspace' })).toBeNull();
    expect(_queueReplyToolChannel({ toolName: 'queue_post_to_x' })).toBeNull();
    expect(_replyDismissToolChannel({ toolName: 'reply_dismiss_to_x' })?.id).toBe('x');
    expect(_replyDismissToolChannel({ tool: 'social/reply_dismiss_to_x' })?.id).toBe('x');
    expect(_replyDismissToolChannel({ toolName: 'reply_dismiss_to_myspace' })).toBeNull();
    expect(_replyDismissToolChannel({ toolName: 'queue_reply_to_x' })).toBeNull();
  });

  // ---- the do-not-engage mark ----

  test('DISMISS — setting a reply aside is RECORDED (who, when, why), never a delete', async () => {
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = null; // 'auto' — the mark lands without a chip

    const result = await _handleNeumaReplyDismiss(h.serverWs, connection, null, 'auto', { toPostId: '2003', reason: 'bait' }, h.channel);
    expect(result.status).toBe('ok');

    const marked = await h.candidates.byPostId('2003');
    expect(marked).not.toBeNull(); // the record stands — dismissing never deletes
    expect(marked.dismissed).toBe(true);
    expect(marked.dismissedBy).toBe('ReplyLaneEcho');
    expect(marked.dismissedAt).toBeTruthy();
    expect(marked.reason).toBe('bait');
  }, 30000);

  test('DISMISSED — the reply gate refuses a set-aside reply honestly', async () => {
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.clientLog.length = 0;
    h.decide = null;

    const result = await _handleNeumaReply(h.serverWs, connection, null, 'auto', { toPostId: '2003', text: 'an answer anyway' }, h.channel);
    expect(result.status).toBe('denied');
    expect(result.error).toContain('set aside');
    expect(h.clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  });

  test('DISMISS — a post the record never landed cannot be set aside either', async () => {
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    const result = await _handleNeumaReplyDismiss(h.serverWs, connection, null, 'auto', { toPostId: '9999' }, h.channel);
    expect(result.status).toBe('denied');
    expect(result.error).toContain('not on the house\'s record');
  });

  test('NOTIFICATION — dismissed stops surfacing; the escalation read names what needs care', async () => {
    // A reply whose words carry a financial shape lands with its category.
    await h.candidates.add({
      postId: '2006', conversationId: '906', authorId: '46', username: 'worried',
      verified: false, verifiedType: null,
      text: 'I was charged me twice — refund please', postCreatedAt: '2026-07-28T00:06:00Z',
    });
    const holder = await _replyCandidatesSection({ companion: { name: 'ReplyLaneEcho', neumaId: NEUMA_ID } });
    // 2003 is dismissed — the knock counts 2001, 2005, 2006 now.
    expect(holder).toContain('3 replies to the house on X from 2 people — 3 answerable (2 verified, 3 substantive).');
    expect(holder).toContain('1 need care: 1 financial.');
  });

  // THE INBOX (Design note, 2026-10-13: […]): the being reads the house's whole record by bucket, with no chip — a
  // local read — and what was set aside sits in the bin, out of the work.
  test('replies_list — the unanswered work by default, the set-aside in the bin, and the knock points at it', async () => {
    expect(SOCIAL_TOOLS.map((t) => t.name)).toContain('replies_list');
    const connection = freshConnection();
    h.serverWs.__connection = connection;
    h.decide = null; // a chip would hang the read: there must be none

    const work = await _handleSocialTool(h.serverWs, connection, null, 'auto', { toolName: 'replies_list' }, {});
    expect(work.status).toBe('ok');
    expect(work.content).toMatch(/^Reply inbox: \d+ unanswered · \d+ staged · \d+ answered · 1 in the bin/);
    expect(work.content).not.toContain('reply 2003');

    const bin = await _handleSocialTool(h.serverWs, connection, null, 'auto', { toolName: 'replies_list' }, { bucket: 'bin' });
    expect(bin.status).toBe('ok');
    expect(bin.content).toContain('reply 2003 · @wolf');
    expect(bin.content).toContain('IN THE BIN');
    expect(bin.content).toContain('That is all 1.');

    const bad = await _handleSocialTool(h.serverWs, connection, null, 'auto', { toolName: 'replies_list' }, { bucket: 'trash' });
    expect(bad.status).toBe('error');
    expect(bad.error).toContain('unknown bucket trash');

    const holder = await _replyCandidatesSection({ companion: { name: 'ReplyLaneEcho', neumaId: NEUMA_ID } });
    expect(holder).toMatch(/Inbox: \d+ unanswered · \d+ staged · \d+ answered · 1 in the bin\./);
    expect(holder).toContain('Work them with replies_list');
    expect(holder).toContain('To put one in the bin, reply_dismiss_to_x');
  });
});
