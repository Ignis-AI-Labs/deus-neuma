// Queue rules — the campaign queue's pure LAW: what is due, what is orphaned,
// what has expired, what is counted, and what a well-formed draft is.
//
// Split out of post-queue.js on 2026-08-26 (size-law breakdown). The store
// there owns the record and its transitions; the law those transitions and
// the scheduler consult is pure — entries in, verdicts out — and lives here.
// Every symbol is re-exported from post-queue.js so existing readers' import
// paths still stand. Direction law: this module never imports post-queue.js.

import { getChannel } from './channel-registry.js';

// Defensive ceiling only — each platform API is the authority on its limit.
const QUEUE_TEXT_MAX = 4000;

/**
 * The entries due for publishing (pure): approved, and their scheduled time
 * has arrived (an approved post with no schedule is due immediately).
 * THE THREAD LAW (Founder/Kagipem 2026-07-29): a self-reply carries no slot of
 * its own — it is due the moment its PARENT stands sent with a live post
 * id, because its whole schedule is the parent's event.
 * @param {Array<{status: string, scheduledFor?: string|null, kind?: string,
 *   thread?: {parentId?: string}, postId?: string}>} entries
 * @param {number} nowMs
 */
export const duePosts = (entries, nowMs) => {
  const byId = new Map((entries || []).map((e) => [e.id, e]));
  return entries.filter((e) => {
    if (e.status !== 'approved') return false;
    // THE REPLY CLOCK LAW (Design note, 2026-08-06: a reply is never the scheduler's
    // to send — approval itself fires it (claimReplyForSend on the approval
    // call). An `approved` reply here is a pre-law legacy entry; the tick's
    // expiry sweep settles it, the wire never does.
    if (e.kind === 'reply') return false;
    if (e.kind === 'self-reply') {
      const parent = byId.get(e.thread?.parentId);
      return parent?.status === 'sent' && Boolean(parent?.postId);
    }
    return !e.scheduledFor || Date.parse(e.scheduledFor) <= nowMs;
  });
};

/**
 * The thread's dead branches (pure): self-replies whose parent can never
 * publish — withdrawn, rejected, failed, or simply GONE (removed). The
 * scheduler withdraws these quietly; a child of a dead parent must never
 * publish independently (Kagipem's law 7).
 * @param {Array<object>} entries
 * @returns {Array<object>} the orphaned self-replies in live standings
 */
export const threadOrphans = (entries) => {
  const byId = new Map((entries || []).map((e) => [e.id, e]));
  return (entries || []).filter((e) => {
    if (e?.kind !== 'self-reply') return false;
    if (!['draft', 'approved'].includes(e.status)) return false;
    const parent = byId.get(e.thread?.parentId);
    return !parent || parent.status === 'withdrawn' || parent.status === 'rejected' || parent.status === 'failed';
  });
};

// THE REPLY CAP (Design note, 2026-07-28: […]; second call, same day: the cap counts per (person, CONVERSATION),
// never a lifetime exclusion — a new exchange with the same person is a new
// conversation). Counted FROM THE QUEUE, never from a side ledger: the queue
// is the one governance record of what was staged or sent, so the count
// cannot drift from the truth. The DEAD standings (rejected/withdrawn/failed)
// never count — a reply that never stood is not engagement.
export const REPLY_CAP_PER_CONVERSATION = 2;
export const REPLY_LIVE_STANDINGS = Object.freeze(['draft', 'approved', 'sending', 'sent']);

// THE REPLY TTL (Design note, 2026-07-28: an answer is worth giving while the
// conversation is warm. A reply that stood unanswered for a day is
// system-withdrawn at its due moment — quiet, never a failure — so a draft
// from Tuesday never publishes Friday.
export const REPLY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Replies whose moment has passed while still undecided or armed (pure):
 * draft, or `approved` — which since the 2026-08-06 reply-clock law can only
 * be a pre-law legacy entry the scheduler will never send, so the TTL is the
 * one thing that settles it. The tick withdraws these quietly
 * (expired-unanswered), never as a failure — a cold conversation is nobody's
 * error.
 * @param {Array<object>} entries
 * @param {number} nowMs
 */
export const expiredReplies = (entries, nowMs) =>
  (entries || []).filter((e) => e?.kind === 'reply'
    && ['draft', 'approved'].includes(e.status)
    // add() always stamps expiresAt; a legacy or hand-edited entry without
    // one still expires — off its createdAt — rather than standing forever.
    && (e.expiresAt ? Date.parse(e.expiresAt) : Date.parse(e.createdAt || 0) + REPLY_TTL_MS) <= nowMs);

/**
 * How many replies to one X user on ONE conversation stand in live standings
 * (pure). The cap is `count < REPLY_CAP_PER_CONVERSATION` at stage time and
 * `count <= REPLY_CAP_PER_CONVERSATION` at send time, where the sending entry
 * counts itself.
 * @param {Array<object>} entries
 * @param {string} toUserId the reply target's X user id
 * @param {string|null} conversationId the conversation the answer belongs to
 */
export const replyCountForConversation = (entries, toUserId, conversationId) =>
  (entries || []).filter((e) => e?.kind === 'reply'
    && e?.reply?.toUserId === toUserId
    && String(e?.reply?.conversationId ?? '') === String(conversationId ?? '')
    && REPLY_LIVE_STANDINGS.includes(e.status)).length;

/**
 * Validate the shape of a new queue entry (pure). Returns an error string or
 * null — the store never persists a malformed request.
 * @param {{channelId?: string, text?: string, scheduledFor?: string|null,
 *   campaignId?: string, pillar?: string, kind?: string, reply?: object,
 *   expiresAt?: string|null}} draft
 */
export const validateDraft = ({ channelId, text, scheduledFor, campaignId, pillar, media, kind, reply, thread, expiresAt, placeholder } = {}) => {
  if (!getChannel(channelId || '')) return `Unknown channel: ${channelId}`;
  if (placeholder != null && typeof placeholder !== 'boolean') {
    return 'placeholder must be a boolean';
  }
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return 'the post needs text';
  if (t.length > QUEUE_TEXT_MAX) return 'the post text is far beyond any postable length';
  // THE CHANNEL'S OWN CEILING (x-card-pipeline move 3): X allows 280 — the
  // wall belongs HERE at staging, stated with the count, not at the API after
  // the operator has already approved the post once or twice.
  const channel = getChannel(channelId || '');
  if (channel?.maxChars && t.length > channel.maxChars) {
    return `the post is ${t.length} characters — ${channel.name || channelId} allows at most ${channel.maxChars}`;
  }
  if (scheduledFor != null && Number.isNaN(Date.parse(scheduledFor))) {
    return 'scheduledFor must be an ISO-8601 time';
  }
  if (expiresAt != null && Number.isNaN(Date.parse(expiresAt))) {
    return 'expiresAt must be an ISO-8601 time';
  }
  // The reply KIND (Design note, 2026-07-28: an answer to a reply on one of the
  // house's own posts, carrying BOUNDED linkage to what it answers. Replies
  // MAY carry media — shape-validated here exactly like a post's (≤4 entries,
  // a path each, alt ≤1000; the shared media block below), with the bytes
  // re-checked at send like any attachment. They NEVER carry a schedule
  // (Design note, 2026-08-06, reversing the 2026-07-28 […] ruling: […] — the
  // focus is the TONE against what was said, and the send fires on approval).
  // They always carry an expiry — the lane answers while the conversation is
  // warm.
  if (kind != null && kind !== 'reply' && kind !== 'self-reply') return `Unknown kind: ${kind}`;
  if (kind === 'self-reply') {
    // THE THREAD KIND (Founder/Kagipem 2026-07-29): a follow-up to the house's
    // OWN queued post — the parent is a QUEUE ENTRY, because the X id it
    // will answer does not exist until the parent sends. It carries NO
    // slot of its own: the schedule is the parent's event, and a caller
    // naming one is a confusion worth refusing at the door.
    if (!thread || typeof thread !== 'object' || typeof thread.parentId !== 'string'
      || !/^[0-9a-f]{16}$/.test(thread.parentId)) {
      return 'a self-reply needs its parent — thread.parentId is a queue entry id';
    }
    if (scheduledFor != null) {
      return 'a self-reply inherits its parent\'s moment — it carries no schedule of its own';
    }
  }
  if (kind === 'reply') {
    if (scheduledFor != null) {
      return 'a reply carries no schedule — it goes out the moment the operator approves it';
    }
    if (!reply || typeof reply !== 'object') return 'a reply needs the post it answers';
    for (const [label, v] of [['toPostId', reply.toPostId], ['toUserId', reply.toUserId]]) {
      if (typeof v !== 'string' || !/^\d{1,40}$/.test(v)) return `reply ${label} must be the platform's numeric id`;
    }
    if (reply.conversationId != null && (typeof reply.conversationId !== 'string' || !/^\d{1,40}$/.test(reply.conversationId))) {
      return 'reply conversationId must be the platform\'s numeric id';
    }
    if (reply.toUsername != null && (typeof reply.toUsername !== 'string' || reply.toUsername.length > 50)) {
      return 'reply toUsername is too long';
    }
    if (reply.toTextPreview != null && (typeof reply.toTextPreview !== 'string' || reply.toTextPreview.length > 300)) {
      return 'reply toTextPreview is too long';
    }
    if (reply.toVerifiedType != null && (typeof reply.toVerifiedType !== 'string' || reply.toVerifiedType.length > 20)) {
      return 'reply toVerifiedType is too long';
    }
    if (reply.category != null && (typeof reply.category !== 'string' || reply.category.length > 20)) {
      return 'reply category is too long';
    }
  } else if (reply != null) {
    return 'reply linkage rides only on a reply';
  }
  if (kind !== 'self-reply' && thread != null) {
    return 'thread linkage rides only on a self-reply';
  }
  // Media rides as already-RESOLVED real paths (media-source.js did the
  // authorising at stage time) plus their alt text. Shape only here — the
  // bytes are re-checked at send.
  if (media != null) {
    if (!Array.isArray(media)) return 'media must be a list';
    if (media.length > 4) return 'at most 4 images ride one post';
    for (const m of media) {
      if (!m || typeof m.path !== 'string' || !m.path.trim()) return 'each media entry needs a path';
      if (m.alt != null && typeof m.alt !== 'string') return 'media alt text must be a string';
      if (typeof m.alt === 'string' && m.alt.length > 1000) return 'media alt text is too long';
    }
  }
  for (const [label, v] of [['campaignId', campaignId], ['pillar', pillar]]) {
    if (v == null) continue;
    if (typeof v !== 'string') return `${label} must be a string`;
    if (v.length > 100) return `${label} is too long`;
  }
  return null;
};
