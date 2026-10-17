// Post scheduler — the campaign lane's publisher: a slow heartbeat that sends
// witness-approved posts when their time arrives.
//
// The scheduler publishes ONLY what the witness explicitly approved, and
// re-checks the world at send time, not approval time: the channel binding
// (the author must still hold the channel — no cross-routing through a stale
// approval) and the credentials (still fully configured). Either failing
// marks the post failed with the honest reason; nothing is retried silently.
// The claim step (approved → sending) is serialized in the store, so two
// ticks can never double-publish one post.
//
// ONLY THIS BACKEND'S HOUSES (house-served.js, Design note, 2026-10-16. The queue is
// one machine-wide file and two desks run a scheduler over it; lane ids are
// not unique across houses. A tick acts only on entries whose house this
// backend serves — the approver's (or stager's) wallet, and the author's lane
// as that house's lane on this backend's grounds — and never journals into a
// lane it does not serve (the ghost lane found live 2026-10-16).

import { readMediaFile, setAltText, uploadMedia } from './x-media.js';
import { reverifyMediaFile } from './media-source.js';
import { postQueue, duePosts, threadOrphans, expiredReplies, replyCountForConversation, REPLY_CAP_PER_CONVERSATION } from './post-queue.js';
import { readXPost, readXListings, readXAccount } from './x-reader.js';
import { channelBindings } from './channel-bindings.js';
import { sectorCrew, canSendStaged } from '../sector-crew.js';
import { resolveChannelCredential } from './channel-credentials.js';
import { posterFor } from './poster-registry.js';
import { getChannel } from './channel-registry.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { readServed, servedWallet, laneHouse, houseWallet, servesLane } from '../house-served.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('PostScheduler');

const TICK_MS = 60 * 1000;

// THE LEASE. A claimed send has this long to land an outcome before the
// reconciler treats it as lost mid-flight (process died, or the poster threw
// before the outcome could record). Fifteen minutes is generous for one POST
// call and tight enough that a real loss surfaces the same hour.
const SEND_LEASE_MS = 15 * 60 * 1000;

// An approved post this far past its slot is overdue — logged, loudly, once
// per tick (the board's OVERDUE meta tells the same story on the desk).
const OVERDUE_GRACE_MS = 10 * 60 * 1000;

// pure — the shape a text match is judged on: whitespace collapsed, capped.
// X can re-wrap copy; the first 120 chars of collapsed text is the honest
// fingerprint for […].
const normalizeText = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * impure — settle entries whose send was lost mid-flight. NEVER blind-retry:
 * a post that actually went out must never go out twice (that is the
 * duplicate-publication machine). The house's live posts are the arbiter:
 * copy found live means it went out unrecorded (mark sent with the live id);
 * not found means it genuinely failed (mark failed, visibly, revisable).
 * A verification read that fails settles nothing — an unproven loss is
 * better left for the next tick than a wrong verdict.
 */
const reconcileStuckSends = async (entries, nowMs) => {
  const stuck = entries.filter((e) => e.status === 'sending'
    && nowMs - Date.parse(e.sendingAt || e.decidedAt || e.createdAt || 0) > SEND_LEASE_MS);
  if (!stuck.length) return;
  const recent = await readXListings({ kind: 'recent', limit: 25 }).catch(() => null);
  if (!recent?.ok) {
    log.warn('stuck-send reconciliation deferred — the live read failed', {
      count: stuck.length, detail: recent?.detail || 'no answer',
    });
    return;
  }
  const live = recent.data?.tweets || [];
  for (const entry of stuck) {
    const match = live.find((t) => normalizeText(t.text) === normalizeText(entry.text));
    if (match) {
      // It DID go out — the outcome just never landed. The record joins the
      // truth; nothing is ever reposted.
      await postQueue.recordOutcome(entry.id, { ok: true, id: match.id });
      log.info('stuck send reconciled — the copy was already live', { id: entry.id, postId: match.id });
      await journalSend(entry, { ok: true, id: match.id });
    } else {
      const detail = 'send lost mid-flight — the process died or the poster threw before an outcome could be recorded; the copy is NOT live and wants a fresh decision';
      await postQueue.recordOutcome(entry.id, { ok: false, detail });
      log.warn('stuck send marked failed — copy not live', { id: entry.id });
      await journalSend(entry, { ok: false, detail });
    }
  }
};

// pure — the house a queue entry belongs to on this backend, or null when it
// is not served here: the wallet that approved (or staged) it names the house,
// and an author's lane must be that house's lane on this backend's grounds.
const entryHouse = (served, entry) => {
  const named = houseWallet(entry.decidedBy) ?? houseWallet(entry.queuedBy);
  if (entry.authorNeumaId) return laneHouse(served, entry.authorNeumaId, named);
  return servedWallet(served, named) ? named : null;
};

// impure — the author's outward speech is part of their record; non-blocking.
// The record says WHAT went out (a reply is not a post) and, when a decision
// fired it, WHO approved it (2026-08-06: on the reply lane the approval IS
// the send, so the approver belongs in the author's own record).
const journalSend = async (entry, outcome) => {
  if (!entry.authorNeumaId) return;
  if (!(await servesLane(entry.authorNeumaId, houseWallet(entry.decidedBy) ?? houseWallet(entry.queuedBy)))) {
    log.warn('the author is not a lane this backend serves — no journal entry written', { id: entry.id, neumaId: entry.authorNeumaId });
    return;
  }
  const spoke = entry.kind === 'reply' ? 'reply' : entry.kind === 'self-reply' ? 'thread follow-up' : 'post';
  try {
    await neumaWorkspace.addJournalEntry(entry.authorNeumaId, {
      type: 'tool_call',
      content: outcome.ok
        ? `queued ${spoke} published to ${entry.channelId} (post ${outcome.id}): ${entry.text.slice(0, 120)}`
        : `queued ${spoke} to ${entry.channelId} failed: ${outcome.detail}`,
      significance: 0.5,
      metadata: {
        server: 'social',
        tool: `post_to_${entry.channelId}`,
        queued: true,
        status: outcome.ok ? 'ok' : 'error',
        ...(entry.kind ? { kind: entry.kind } : {}),
        ...(entry.decidedBy ? { approvedBy: entry.decidedBy } : {}),
      },
    });
  } catch (err) {
    log.warn('journal entry for queued post not written', { neumaId: entry.authorNeumaId, error: err.message });
  }
  // THE FAILURE SIGNAL (the CoS audit's G2): a send that failed is an event
  // the operator must HEAR — the July orphan sat failed for a month because
  // nothing poked anyone. One card per failure, at the moment of failure; the
  // author's seat hears nothing here (its journal above is its record).
  if (!outcome.ok) {
    try {
      const owner = await neumaWorkspace.readOwner(entry.authorNeumaId).catch(() => null);
      if (owner?.wallet) {
        notifyOperator({
          wallet: owner.wallet,
          kind: KIND.postFailed,
          standing: STANDING.system,
          title: `A queued ${spoke} FAILED — ${entry.channelId}`,
          detail: (outcome.detail || 'unknown failure').slice(0, 300),
          actor: { id: entry.authorNeumaId },
          ref: { queueId: entry.id, channel: entry.channelId },
        });
      }
    } catch (err) {
      log.warn('post-failure notification not delivered', { id: entry.id, error: err.message });
    }
  }
};

/**
 * Publish one claimed entry: binding re-check → credentials → poster. The
 * real stores and the real posters, always — this path has no injection seam
 * on purpose (RULE 0: nothing here may ever be faked to make a test pass).
 * Recording failures can throw after acceptance; callers must preserve uncertainty.
 * @param {Object} entry a queue entry in `sending` state
 */
// impure — network + disk
/**
 * Upload every image on an entry and describe it. Returns the media ids in the
 * order the operator staged them, or the first honest failure.
 *
 * impure — disk + network
 * @param {object} credentials
 * @param {object} entry
 * @returns {Promise<{ok: true, mediaIds: Array<string>}|{ok: false, detail: string}>}
 */
const uploadEntryMedia = async (credentials, entry) => {
  const mediaIds = [];
  for (const item of entry.media) {
    const verified = await reverifyMediaFile(item.path);
    if (!verified.ok) return { ok: false, detail: `media refused — ${verified.detail}` };
    const read = await readMediaFile(verified.path);
    if (!read.ok) return { ok: false, detail: `media refused — ${read.detail}` };
    const up = await uploadMedia(credentials, read);
    if (!up.ok) return { ok: false, detail: `media upload failed — ${up.detail}` };
    if (item.alt) {
      // Alt text failing must not sink a post that is otherwise ready; it is
      // logged loudly instead, because shipping an undescribed image is a real
      // accessibility regression and should be visible.
      const described = await setAltText(credentials, up.mediaId, item.alt);
      if (!described.ok) log.warn('alt text did not attach', { id: entry.id, detail: described.detail });
    }
    mediaIds.push(up.mediaId);
  }
  return { ok: true, mediaIds };
};

export const publishEntry = async (entry) => {
  // The binding law holds at SEND time. A witness-authored post (no
  // authorNeumaId) is the witness's own speech and needs no binding.
  if (entry.authorNeumaId) {
    // THE SEND LAW under the crew model (Design note, 2026-07-26: a crew member drafts,
    // the operator approves by hand, and the post leaves on the HOLDER's keys.
    // So the author need not be the holder — but the channel must still HAVE
    // one, and the author must still be on the crew. Removing someone from the
    // sector therefore kills their pending posts, exactly as unbinding used to:
    // approval does not outlive membership.
    const [bound, crewStore] = await Promise.all([
      channelBindings.load().catch(() => ({})),
      sectorCrew.load().catch(() => ({})),
    ]);
    if (!canSendStaged(crewStore, bound, entry.channelId, entry.authorNeumaId)) {
      const outcome = { ok: false, detail: 'the author is no longer on this channel\'s crew, or the channel has no holder — approval does not outlive membership' };
      await postQueue.recordOutcome(entry.id, outcome);
      await journalSend(entry, outcome);
      return outcome;
    }
  }

  const credentials = await resolveChannelCredential(entry.channelId).catch(() => null);
  const post = posterFor(entry.channelId);
  // A null credential needs no guard here: every poster and every reader
  // answers a missing credential with its own NAMED `{ok:false}` refusal
  // (poster-registry contract — "never a throw"), so the honest,
  // channel-named detail lands on the record through the ordinary paths.

  // THE THREAD SEND LAW (Kagipem 2026-07-29): a self-reply speaks ONLY as
  // an answer to its parent's LIVE post. The parent's queue id resolved to
  // an X post id when the parent sent; if that is not true RIGHT NOW (the
  // parent failed, was withdrawn, or never sent), the child holds — it
  // never speaks without its parent, and never as a standalone post.
  let threadReplyToId = null;
  if (entry.kind === 'self-reply') {
    const all = await postQueue.load().catch(() => null);
    const parent = all?.find((p) => p.id === entry.thread?.parentId) || null;
    if (!parent || parent.status !== 'sent' || !parent.postId) {
      const outcome = { ok: false, detail: 'the parent never published — the thread post holds; it never speaks without its parent' };
      await postQueue.recordOutcome(entry.id, outcome);
      await journalSend(entry, outcome);
      log.warn('self-reply held — parent not sent', { id: entry.id, parentId: entry.thread?.parentId });
      return outcome;
    }
    // The parent's LIVE post must still stand — same doctrine as the reply
    // lane's target check: a deleted parent is not answered by a fallback.
    const standing = await readXPost(parent.postId);
    if (!standing.ok) {
      const outcome = { ok: false, detail: `the parent's post no longer stands (${standing.detail}) — the thread post stays in the record, unsent` };
      await postQueue.recordOutcome(entry.id, outcome);
      await journalSend(entry, outcome);
      log.warn('self-reply failed — parent post gone', { id: entry.id, detail: standing.detail });
      return outcome;
    }
    threadReplyToId = parent.postId;
  }

  // THE REPLY SEND LAW (Design note, 2026-07-28: a reply re-checks the world at send
  // time, same doctrine as the binding re-check above. The target post must
  // still stand — a vanished target fails the send honestly, never a
  // fallback post — and the per-conversation cap must still hold, counted
  // from the queue RIGHT NOW with this entry counting itself (approval did
  // not pre-authorize over-engagement).
  if (entry.kind === 'reply' && entry.reply?.toPostId) {
    const target = await readXPost(entry.reply.toPostId);
    if (!target.ok) {
      const outcome = { ok: false, detail: `the reply's target post no longer stands (${target.detail}) — the answer stays in the record, unsent` };
      await postQueue.recordOutcome(entry.id, outcome);
      await journalSend(entry, outcome);
      log.warn('queued reply failed — target gone', { id: entry.id, detail: target.detail });
      return outcome;
    }
    const entries = await postQueue.load().catch(() => null);
    if (!entries || replyCountForConversation(entries, entry.reply.toUserId, entry.reply.conversationId ?? null) > REPLY_CAP_PER_CONVERSATION) {
      const outcome = {
        ok: false,
        detail: !entries
          ? 'the queue is unreadable at send time — the per-conversation cap cannot be counted, so the answer holds'
          : `the per-conversation cap no longer holds (more than ${REPLY_CAP_PER_CONVERSATION} replies to this account on this conversation stand) — the answer holds`,
      };
      await postQueue.recordOutcome(entry.id, outcome);
      await journalSend(entry, outcome);
      log.warn('queued reply failed — cap', { id: entry.id, detail: outcome.detail });
      return outcome;
    }
  }

  // MEDIA, at send time. Uploading publishes nothing — an unused media id
  // expires — so this stays ahead of the single irreversible act below. Each
  // file is re-resolved and must still be the exact real path staging
  // authorised: a file swapped for a symlink in the meantime fails the send
  // rather than being discovered by the public. Any media failure fails the
  // WHOLE post: half a composition is not the thing the operator approved.
  // Replies ride the same path — their media was resolved and witnessed at
  // stage time like any post's.
  let mediaIds = [];
  if (post && Array.isArray(entry.media) && entry.media.length) {
    const uploaded = await uploadEntryMedia(credentials, entry);
    if (!uploaded.ok) {
      await postQueue.recordOutcome(entry.id, uploaded);
      await journalSend(entry, uploaded);
      log.warn('queued post failed at media', { id: entry.id, detail: uploaded.detail });
      return uploaded;
    }
    mediaIds = uploaded.mediaIds;
  }

  const outcome = post
    ? await post(credentials, entry.text, {
      mediaIds,
      // The reply's linkage rides to the wire — the poster turns it into
      // in_reply_to_tweet_id; a plain post carries none. A self-reply
      // answers its parent's live post (the thread law, resolved above).
      ...(entry.kind === 'reply' ? { replyToId: entry.reply?.toPostId } : {}),
      ...(entry.kind === 'self-reply' && threadReplyToId ? { replyToId: threadReplyToId } : {}),
    })
    : { ok: false, detail: `no poster for channel ${entry.channelId}` };

  // THE ACCOUNT IT WENT OUT AS, stamped on the record (Design note, 2026-07-28:
  // […]). Cached
  // and warm from the lane's other reads; a failed lookup never blocks a
  // real publish — postedAs is simply absent, never invented.
  if (outcome.ok && entry.channelId === 'x') {
    const account = await readXAccount().catch(() => null);
    if (account) outcome.postedAs = account;
  }

  await postQueue.recordOutcome(entry.id, outcome);
  await journalSend(entry, outcome);
  const channel = getChannel(entry.channelId);
  if (outcome.ok) {
    log.info('queued post published', { id: entry.id, channel: channel?.name, postId: outcome.id });
  } else {
    log.warn('queued post failed', { id: entry.id, channel: channel?.name, detail: outcome.detail });
  }
  return outcome;
};

/**
 * One scheduler pass: claim and publish every due post. Exposed for tests
 * (RULE 0: the tick is provable without waiting a minute).
 * @param {number} [nowMs]
 */
// impure
export const schedulerTick = async (nowMs = Date.now()) => {
  let entries;
  let served;
  try {
    [entries, served] = await Promise.all([postQueue.load(), readServed()]);
  } catch (err) {
    log.error('post queue unreadable — holding all publishes', { error: err.message });
    return [];
  }
  const ours = (entry) => Boolean(entryHouse(served, entry));
  await reconcileStuckSends(entries.filter(ours), nowMs);
  // THE EXPIRY SWEEP, its own pass (Design note, 2026-08-06, with the reply-clock
  // law): the scheduler no longer sends replies — approval does — but the
  // TTL stays the tick's to keep. A reply that sat past its moment is
  // system-withdrawn (never sent, never FAILED — a cold conversation is
  // nobody's error), whether it is a draft nobody decided or a pre-law
  // `approved` entry the wire will never take.
  for (const cold of expiredReplies(entries, nowMs).filter(ours)) {
    // The snapshot can be stale by one approval: a reply claimed to
    // `sending` (or already settled) since the tick's load refuses here —
    // that refusal is a benign result, never logged as a withdrawal.
    const pulled = await postQueue.withdraw(cold.id, { withdrawnBy: 'system', reason: 'expired-unanswered' });
    if (pulled.ok) {
      log.info('queued reply expired — withdrawn unanswered', { id: cold.id, expiresAt: cold.expiresAt });
    } else {
      log.debug('expired reply had already moved — the sweep left it', { id: cold.id, detail: pulled.error });
    }
  }
  // Overdue approved posts are SEEN (Design note, 2026-07-28: an approved + scheduled
  // post must go out, and the failure must be loud). One line per tick,
  // never one per post per minute.
  const overdue = entries.filter(ours).filter((e) => e.status === 'approved' && e.scheduledFor
    && nowMs - Date.parse(e.scheduledFor) > OVERDUE_GRACE_MS);
  if (overdue.length) {
    log.warn('approved posts overdue past grace', { count: overdue.length, ids: overdue.map((e) => e.id) });
  }
  const outcomes = [];
  // THE CHAIN PASS (Kagipem 2026-07-29): due is RE-READ after every send —
  // a self-reply becomes due the moment its parent lands, and […] means the same pass, not a minute
  // later. Termination is structural: every iteration either sends one
  // entry (approved → sending, out of the due set for good) or withdraws
  // it, and `processed` names each entry once.
  const processed = new Set();
  for (;;) {
    const fresh = await postQueue.load().catch(() => null);
    if (!fresh) { log.error('post queue unreadable mid-pass — holding', {}); break; }
    // THE THREAD'S DEAD BRANCHES, re-read EVERY pass (Kagipem's law 7): a
    // parent that fails or is withdrawn MID-PASS takes its thread with it —
    // quietly, never a failure, never an independent ad on the wire.
    for (const orphan of threadOrphans(fresh).filter((o) => ours(o) && !processed.has(o.id))) {
      processed.add(orphan.id);
      await postQueue.withdraw(orphan.id, { withdrawnBy: 'system', reason: 'parent-not-published' });
      log.info('self-reply withdrawn — its parent never published', { id: orphan.id, parentId: orphan.thread?.parentId });
    }
    const dueNow = duePosts(fresh, nowMs).filter((e) => ours(e) && !processed.has(e.id));
    if (!dueNow.length) break;
    for (const e of dueNow) {
      processed.add(e.id);
      // (The reply expiry check that used to sit here moved to the per-tick
      // sweep above — duePosts no longer surfaces replies at all under the
      // 2026-08-06 reply-clock law, so a check here would be dead code.)
      const claimed = await postQueue.claimForSend(e.id);
      if (!claimed.ok) continue; // another tick took it, or state moved — not ours
      try {
        outcomes.push(await publishEntry(claimed.entry));
      } catch (err) {
        // Acceptance may have preceded a store failure. Keep the sending lease
        // so reconciliation can establish the outcome without a duplicate post.
        log.error('publish threw — outcome unknown; awaiting reconciliation', { id: e.id, error: err.message });
        outcomes.push({ ok: false, pending: true, detail: `publish outcome unknown: ${err.message}` });
      }
    }
  }
  return outcomes;
};

/**
 * Start the slow heartbeat. Never blocks the server's listen; the interval is
 * unref'd so it cannot hold the process open.
 * @returns {() => void} stop
 */
// impure
export const startPostScheduler = ({ intervalMs = TICK_MS } = {}) => {
  const timer = setInterval(() => {
    schedulerTick().catch((err) => log.error('scheduler tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  log.info('post scheduler standing', { everyMs: intervalMs });
  return () => clearInterval(timer);
};
