// Post queue — the campaign lane's ledger: outward speech staged, operator-
// approved, then published on schedule.
//
// A queued post is NOT egress — it is a request for the operator's decision.
// Every entry carries its author (the neuma bound to the channel at queue
// time, or the operator themself) and moves draft → approved → sent, or
// draft → rejected, or approved → failed (with the honest reason). Publishing
// happens only from `approved`, only at/after its scheduled time, and only
// after the channel binding and credentials are re-checked at send time — an
// approval is not a bypass of the no-cross-routing law.
//
// THE REPLY EXCEPTION (ruling, 2026-08-06): a reply never rests at `approved`.
// Approving a reply IS the send — claimReplyForSend moves draft → sending in
// one atom and the approval call itself publishes. An answer has no clock;
// what matters is the tone against what was said, so the only acts on a reply
// are approve(-and-send), reject, revise, withdraw.
//
// Governance record, not a secret: plain JSON under data/settings, same
// 0600/0700 posture as the sibling social stores. Factory shape so tests run
// the real disk path against tmp files.

import fs from 'fs/promises';
import crypto from 'crypto';
import { campaignFieldsRefusal, campaignFieldsOf } from './queue-campaign.js';
import { approveGroupIn } from './queue-group.js';
import { permalinkOf } from './permalink.js';
import { join, dirname } from 'path';
import { withFileLock, LOCK_TIMEOUT } from '../file-lock.js';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { validateDraft, queuedSecretRefusal, quoteFieldsOf, REPLY_LIVE_STANDINGS, REPLY_TTL_MS } from './queue-rules.js';
import { previewUpdate, appendRevision, EDITABLE_STANDINGS } from './queue-edit.js';
import { approveThreadIn } from './queue-thread.js';
import { tiktokApproveRefusal } from './tiktok-metadata.js';
import { channelOfAccountId, firstAccountId } from './account-shape.js';
import { disclosed, markedMedia, IN_METADATA } from './disclosure-line.js';
import { restageFailed } from './queue-retry.js';
import { retractSent } from './queue-retract.js';

const DEFAULT_PATH = join(getSettingsDir(), 'social-post-queue.json');

// Overridable per call so tests never touch the operator's live queue.
export const postQueuePath = () =>
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH || DEFAULT_PATH;

export const QUEUE_STATUSES = Object.freeze(['draft', 'approved', 'sending', 'sent', 'failed', 'rejected', 'withdrawn', 'retracted']);

// The queue's pure LAW (what is due, orphaned, expired, counted, well-formed)
// lives in ./queue-rules.js, the editing law (#208) in ./queue-edit.js, TRY
// AGAIN's in ./queue-retry.js; re-exported so every reader's path stands.
export {
  duePosts, threadOrphans, expiredReplies, replyCountForConversation, validateDraft,
  REPLY_CAP_PER_CONVERSATION, REPLY_LIVE_STANDINGS, REPLY_TTL_MS,
} from './queue-rules.js';
export {
  normalizePatch, previewUpdate, appendRevision, QUEUE_PATCH_FIELDS, REVISIONS_MAX,
} from './queue-edit.js';

// The being-facing VIEW of this record (what a consciousness may scan, and how
// it renders) lives in ./queue-view.js: the store owns the record and its law.

/**
 * @param {{ path?: string|(() => string) }} [opts]
 */
export const createPostQueue = (opts = {}) => {
  // A supplied-but-empty `path` is a BUG, not a request for the default: on
  // 2026-07-27 `{ path: process.env.TYPO }` bound a tmp-aimed driver to the LIVE
  // queue and transitioned a real staged post. Omitting the key = the live store.
  if ('path' in opts && !(typeof opts.path === 'function'
    || (typeof opts.path === 'string' && opts.path.length > 0))) {
    throw new TypeError('createPostQueue: `path` was supplied but is not a non-empty string or a function');
  }
  const { path = postQueuePath } = opts;
  const target = () => (typeof path === 'function' ? path() : path);

  // Serialize mutations — two concurrent decisions must never clobber each
  // other's read+write.
  const serialize = createWriteChain();

  // impure — missing file = empty queue; a corrupt file surfaces, never
  // collapses to [] (that would silently drop staged speech on next save).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('post-queue: store is not an array');
    return parsed.map(disclosed); // an unsent post's AI disclosure lives in its metadata
  };

  const save = async (entries) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(dirname(file), 0o700);
    await fs.chmod(file, 0o600);
  };

  // The lock sits beside the store it guards, so a tmp store in a test gets its
  // own and never contends with the operator's live queue.
  const lockPath = () => `${target()}.lock`;

  /**
   * ONE chokepoint for every mutation: in-process ordering (`serialize`) AND
   * cross-process exclusion (the lock).
   *
   * `serialize` alone was a lie on this box. Two servers run against this one
   * checkout — the dev stack and the Electron desk — and each ran its own
   * publisher over this same file. A promise chain is per-process, so both
   * could read `approved`, both write `sending`, and both publish: a 400-entry
   * two-process race claimed 298 entries TWICE. `save()`'s tmp+rename prevents
   * a torn file; it cannot prevent a lost update. Only something outside both
   * processes can make the read and the write one atom.
   *
   * impure — takes a real lock file.
   */
  const mutate = (fn) => serialize(() => withFileLock(lockPath(), fn));

  // A lock timeout is a refusal the caller can retry, never a throw.
  const busy = (err) => {
    if (err?.code !== LOCK_TIMEOUT) throw err;
    return { ok: false, error: 'the campaign queue is busy on another process — not acted on' };
  };

  // impure — one guarded transition; fn(entry) mutates, or returns {error} to
  // refuse WITHOUT saving (a failed validation must leave the record as it
  // was). A lock timeout is reported as a refusal, NOT thrown: the scheduler
  // then simply skips this entry and retries next tick. Every other error
  // still propagates, so a corrupt store surfaces instead of hiding behind a
  // retry.
  const transition = (id, allowedFrom, apply) => mutate(async () => {
    const entries = await load();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return { ok: false, error: 'no such queued post' };
    if (!allowedFrom.includes(entry.status)) {
      return { ok: false, error: `cannot act on a ${entry.status} post` };
    }
    const refusal = apply(entry);
    if (refusal && typeof refusal.error === 'string') return { ok: false, error: refusal.error };
    await save(entries);
    return { ok: true, entry };
  }).catch(busy);

  // impure — one all-or-nothing decision over several entries (a thread, a
  // group): decide(entries, now) approves in place or refuses, under the lock.
  const approveAll = (decide) => mutate(async () => {
    const entries = await load();
    const { error, ...result } = decide(entries, new Date());
    if (error) return { ok: false, error };
    await save(entries);
    return { ok: true, entries: result.approved, ...result };
  }).catch(busy);

  return {
    load,

    /**
     * Stage one post as a draft awaiting the operator. impure.
     * @param {{channelId: string, text: string, scheduledFor?: string|null,
     *   campaignId?: string, pillar?: string,
     *   media?: Array<{path: string, alt?: string}>,
     *   kind?: 'reply', reply?: object, expiresAt?: string|null,
     *   authorNeumaId?: string|null, queuedBy: string}} draft
     */
    add(draft) {
      // THE ACCOUNT IT WILL SPEAK AS (campaign plan §2.4): every new entry
      // names one; a draft that names none speaks as its platform's first
      // account, and one that names another platform's account is refused.
      const invalid = validateDraft(draft) || campaignFieldsRefusal(draft)
        || (draft?.accountId != null && channelOfAccountId(draft.accountId) !== draft.channelId
          ? `account ${draft.accountId} is not a ${draft.channelId} account` : null);
      if (invalid) return Promise.reject(new Error(invalid));
      return mutate(async () => {
        const entries = await load();
        // ONE LIVE ANSWER PER TARGET (ruling, 2026-07-28): while a live entry
        // already answers this post, a second stage is refused honestly —
        // […]. A DEAD answer (failed/withdrawn/
        // rejected) blocks nothing: a fresh answer may be staged.
        if (draft.kind === 'reply') {
          const clash = entries.find((e) => e?.kind === 'reply'
            && e?.reply?.toPostId === String(draft.reply.toPostId)
            && REPLY_LIVE_STANDINGS.includes(e.status));
          if (clash) {
            throw new Error(`the house is already answering that one — a ${clash.status} reply [${clash.id}] to post ${draft.reply.toPostId} stands in the queue: "${String(clash.text || '').replace(/\s+/g, ' ').trim()}" (queue_get ${clash.id} reads it whole)`);
          }
        }
        // THE THREAD'S PARENT LAW (Kagipem 2026-07-29): the parent must be
        // a REAL queue entry, and not a dead one — a child staged under a
        // parent that can never publish is an orphan from birth (the
        // scheduler's cascade catches parents that die LATER).
        if (draft.kind === 'self-reply') {
          const parent = entries.find((e) => e.id === draft.thread.parentId);
          if (!parent) {
            throw new Error(`the parent is not on the queue — a self-reply follows one of the house's own queued posts`);
          }
          if (['withdrawn', 'rejected', 'failed'].includes(parent.status)) {
            throw new Error(`the parent is ${parent.status} — it can never publish, so the thread cannot grow from it`);
          }
        }
        const createdAt = new Date();
        const entry = {
          id: crypto.randomBytes(8).toString('hex'),
          channelId: draft.channelId,
          accountId: draft.accountId || firstAccountId(draft.channelId),
          text: String(draft.text ?? '').trim(), disclosure: IN_METADATA,
          scheduledFor: draft.scheduledFor || null,
          campaignId: draft.campaignId?.trim() || null,
          pillar: draft.pillar?.trim() || '',
          // Resolved real paths + alt text. Whitelisted field-by-field so a
          // caller cannot smuggle extra keys onto a governance record.
          media: markedMedia({ ...draft, media: Array.isArray(draft.media) // a being's images: the AI marker in their alt text
            ? draft.media.map((m) => ({ path: m.path, alt: String(m.alt || '').slice(0, 1000) })) : [] }),
          // The STAGING KIND (the CoS audit's G4) — a placeholder holds the slot,
          // not the copy, never an operator decision — and the thread kind with
          // its bounded linkage: copied only when set, no smuggled keys.
          ...(draft.placeholder === true ? { placeholder: true } : {}),
          ...(draft.kind === 'self-reply' ? {
            kind: 'self-reply',
            thread: { parentId: String(draft.thread.parentId) },
          } : {}),
          // The reply KIND, whitelisted the same way; its expiry rides beside it
          // (REPLY_TTL_MS unless the caller named an honest earlier moment).
          ...(draft.kind === 'reply' ? {
            kind: 'reply',
            reply: {
              toPostId: String(draft.reply.toPostId),
              toUserId: String(draft.reply.toUserId),
              toUsername: String(draft.reply.toUsername || '').slice(0, 50),
              toTextPreview: String(draft.reply.toTextPreview || '').slice(0, 300),
              toVerifiedType: String(draft.reply.toVerifiedType || '').slice(0, 20),
              conversationId: draft.reply.conversationId ? String(draft.reply.conversationId) : null,
              category: String(draft.reply.category || '').slice(0, 20),
            },
            expiresAt: draft.expiresAt || new Date(createdAt.getTime() + REPLY_TTL_MS).toISOString(),
          } : {}),
          // Its place in a campaign — angle, group — copied only when set.
          ...campaignFieldsOf(draft), ...quoteFieldsOf(draft),
          authorNeumaId: draft.authorNeumaId || null,
          queuedBy: String(draft.queuedBy || ''),
          status: 'draft',
          createdAt: createdAt.toISOString(),
        };
        entries.push(entry);
        await save(entries);
        return entry;
      });
    },

    /**
     * The operator approves a draft (optionally re-timing it). impure.
     * @param {string} id
     * @param {{decidedBy: string, scheduledFor?: string|null, tiktokConsent?: object|null, textSeen?: string, under?: string}} decision
     */
    approve(id, { decidedBy, scheduledFor, tiktokConsent, textSeen, under } = {}) {
      if (scheduledFor != null && Number.isNaN(Date.parse(scheduledFor))) {
        return Promise.resolve({ ok: false, error: 'scheduledFor must be an ISO-8601 time' });
      }
      return transition(id, ['draft'], (entry) => {
        const secret = queuedSecretRefusal(entry, 'nothing was approved');
        if (secret) return { error: secret };
        // A reply is sent BY approval, never armed by it (ruling, 2026-08-06).
        // Arming one here would strand it: the scheduler refuses the kind, so
        // an approved reply is a promise the system can no longer keep.
        if (entry.kind === 'reply') {
          return { error: 'a reply goes out the moment it is approved — decide it through the reply approval (approve-and-send), not the schedule lane' };
        }
        const tiktok = tiktokApproveRefusal(entry, { consent: tiktokConsent, textSeen });
        if (tiktok) return { error: tiktok };
        if (entry.channelId === 'tiktok') entry.tiktokConsent = tiktokConsent ?? null;
        entry.status = 'approved';
        entry.decidedBy = String(decidedBy || '');
        entry.decidedAt = new Date().toISOString();
        // A decision the operator's MANDATE made (marketing/mandate/): it stands only while that mandate does.
        if (under) entry.decidedUnder = String(under);
        if (scheduledFor !== undefined) entry.scheduledFor = scheduledFor;
      });
    },

    /**
     * The operator approves a whole THREAD at once — every draft from its root
     * down, all or nothing, in one atom (queue-thread.js holds the law). impure.
     * @param {string} id - any post of the thread
     * @param {{decidedBy: string, textsSeen: Record<string, string>}} decision
     */
    approveThread(id, { decidedBy, textsSeen } = {}) {
      return approveAll((entries, now) => approveThreadIn(entries, id, { decidedBy, textsSeen, now }));
    },

    /**
     * The operator approves a GROUP — one asset on several accounts — in one
     * atom (queue-group.js holds the law); `ids` are the house's own members. impure.
     * @param {string} groupId
     * @param {{ids: ReadonlySet<string>, decidedBy: string, textsSeen: Record<string, string>, consents?: object}} decision
     */
    approveGroup(groupId, decision = {}) {
      return approveAll((entries, now) => approveGroupIn(entries, groupId, { ...decision, now }));
    },
    /** The operator declines a draft — it stays in the record, marked. impure. */
    reject(id, { decidedBy } = {}) {
      return transition(id, ['draft'], (entry) => {
        entry.status = 'rejected';
        entry.decidedBy = String(decidedBy || '');
        entry.decidedAt = new Date().toISOString();
      });
    },

    /**
     * Pull a staged post back before it publishes — a DRAFT or an APPROVED one.
     * impure.
     *
     * Deliberately NOT `reject` (2026-07-26): the operator's approval is never
     * rewritten into a rejection — the copy was superseded (a figure corrected,
     * a line overtaken) and the record says so plainly. DRAFT joined 2026-07-27
     * so a being can retract its OWN unapproved copy: it writes `withdrawnBy`,
     * never `decidedBy`, so the verdict stays `reject`'s alone.
     *
     * Safe against the publisher by construction: `claimForSend` moves
     * approved → sending through the same `mutate` gate, so either the
     * withdrawal lands first or the claim does and this refuses.
     */
    withdraw(id, { withdrawnBy, reason } = {}) {
      return transition(id, ['draft', 'approved'], (entry) => {
        entry.status = 'withdrawn';
        entry.withdrawnBy = String(withdrawnBy || '');
        entry.withdrawnAt = new Date().toISOString();
        if (reason) entry.withdrawnReason = String(reason);
      });
    },

    /**
     * Edit a staged post IN PLACE (#208) — draft or approved only; sending is
     * locked, settled is history. The patch is whitelisted and validated
     * through the same law as a staged draft (previewUpdate), applied under
     * the same mutate gate as every other transition, and recorded: updatedBy
     * + updatedAt on the entry, and the PREVIOUS values of what changed
     * appended to its bounded revision trail.
     *
     * The approval law is previewUpdate's: new words or images on an approved
     * post return it to DRAFT — the operator approved different copy, so the
     * decision renews rather than being quietly ridden. The old approval is
     * not rewritten into anything; it simply no longer covers this copy. A
     * schedule-only edit preserves the approval.
     *
     * Safe against the publisher by construction: claimForSend moves
     * approved → sending through this same gate, so either the edit lands
     * first (and a reset approval can never be claimed) or the claim lands
     * first and this refuses a sending post honestly.
     *
     * impure.
     * @param {string} id
     * @param {{text?: string, scheduledFor?: string|null, campaignId?: string|null,
     *   pillar?: string, media?: Array<{path: string, alt?: string}>}} patch
     * @param {{by?: string}} [actor]
     */
    update(id, patch, { by } = {}) {
      return transition(id, EDITABLE_STANDINGS, (entry) => {
        const preview = previewUpdate(entry, patch);
        if (!preview.ok) return { error: preview.error };
        for (const field of Object.keys(preview.changed)) entry[field] = preview.patch[field];
        if (preview.resetsApproval) {
          entry.status = 'draft';
          delete entry.decidedBy;
          delete entry.decidedAt;
        }
        const at = new Date().toISOString();
        entry.updatedBy = String(by || '');
        entry.updatedAt = at;
        entry.revisions = appendRevision(entry.revisions, {
          at, by: String(by || ''), changed: preview.changed,
        });
        return null;
      });
    },

    /** The publisher claims one due post. approved → sending is atomic under
     *  `mutate` — across PROCESSES, not merely across awaits — so two ticks can
     *  never double-publish, including the two servers this box runs. impure.
     *  `sendingAt` is the lease: the reconciler (post-scheduler) treats a send
     *  older than the lease as lost mid-flight and settles it honestly —
     *  before this stamp, a dead process stranded the entry forever
     *  (c34d0505214ab341, 2026-07-28). */
    claimForSend(id) {
      return transition(id, ['approved'], (entry) => {
        // Refused, the entry stays `approved` and unsent: an edit (which
        // re-runs validateDraft) or a withdrawal is the operator's way out.
        const secret = queuedSecretRefusal(entry, 'nothing was sent');
        if (secret) return { error: secret };
        entry.status = 'sending';
        entry.sendingAt = new Date().toISOString();
      });
    },

    /**
     * THE REPLY APPROVAL (ruling, 2026-08-06): approving a reply IS the send.
     * draft → sending in ONE atom — a reply never rests at `approved` — and
     * the caller publishes immediately after, outside the lock (a network
     * call must never ride inside the file lock). `sendingAt` is the same
     * lease claimForSend stamps, so a send that crashes mid-flight is settled
     * by the reconciler, never stranded and never blind-retried.
     *
     * Two preconditions, both inside the atom:
     * - textSeen must equal the entry's text — the operator approves the
     *   WORDS they read, so a revision landing between render and click
     *   refuses rather than sending copy nobody saw (TOCTOU).
     * - a reply past its expiry is withdrawn expired-unanswered right here
     *   (same vocabulary as the tick's sweep) — the conversation went cold,
     *   so approving it sends nothing. The caller reads entry.status to tell
     *   the two outcomes apart.
     * impure.
     * @param {string} id
     * @param {{decidedBy: string, textSeen: string}} decision
     */
    claimReplyForSend(id, { decidedBy, textSeen, under } = {}) {
      return transition(id, ['draft'], (entry) => {
        if (entry.kind !== 'reply') {
          return { error: 'only a reply is sent on approval — approve posts through the schedule lane' };
        }
        if (typeof textSeen !== 'string' || textSeen !== entry.text) {
          return { error: 'the copy moved since it was read — re-read the reply and decide again' };
        }
        const secret = queuedSecretRefusal(entry, 'nothing was sent');
        if (secret) return { error: secret };
        const at = new Date();
        if (entry.expiresAt && Date.parse(entry.expiresAt) <= at.getTime()) {
          entry.status = 'withdrawn';
          entry.withdrawnBy = 'system';
          entry.withdrawnAt = at.toISOString();
          entry.withdrawnReason = 'expired-unanswered';
          return null;
        }
        entry.status = 'sending';
        entry.decidedBy = String(decidedBy || '');
        entry.decidedAt = at.toISOString();
        if (under) entry.decidedUnder = String(under);
        entry.sendingAt = at.toISOString();
        return null;
      });
    },

    /** Keep a platform's ticket for a send in flight (TikTok's publish_id),
     *  so the reconciler can ask the platform what became of it. impure. */
    recordSendTicket(id, ticket) {
      return transition(id, ['sending'], (entry) => { entry.sendTicket = String(ticket); });
    },

    /** Record the real outcome of a publish attempt. impure. A successful
     *  send also stamps WHO it went out as (postedAs) when the publisher
     *  proved it — the account locked in for THIS post, permanently. */
    recordOutcome(id, outcome) {
      return transition(id, ['sending'], (entry) => {
        if (outcome.ok) {
          entry.status = 'sent';
          entry.sentAt = new Date().toISOString();
          entry.postId = outcome.id;
          if (outcome.postedAs?.id) {
            entry.postedAs = {
              id: String(outcome.postedAs.id),
              username: String(outcome.postedAs.username || ''),
            };
          }
          // The post's address, kept (it was dropped here before slice 6).
          const url = permalinkOf(entry.channelId, outcome);
          if (url) entry.url = url;
        } else {
          entry.status = 'failed';
          entry.failedAt = new Date().toISOString();
          entry.error = outcome.detail || 'unknown failure';
          if (Number.isInteger(outcome.status)) entry.errorStatus = outcome.status; // the platform's own answer (send-failure.js)
        }
      });
    },

    /** TRY AGAIN: a failed post the platform stumbled on, back to DRAFT — the same entry (queue-retry.js). impure. */
    restage(id, { by } = {}) { return transition(id, ['failed'], (entry) => restageFailed(entry, { by, at: new Date().toISOString() })); },

    /** RETRACT: a SENT post deleted from its platform, kept in the record (queue-retract.js). impure. */
    retract(id, act = {}) { return transition(id, ['sent'], (entry) => retractSent(entry, { ...act, at: new Date().toISOString() })); },

    /** Remove a draft or rejected entry entirely (sent history stays). impure. */
    remove(id) {
      return mutate(async () => {
        const entries = await load();
        const entry = entries.find((e) => e.id === id);
        if (!entry) return false;
        if (!['draft', 'rejected', 'failed', 'withdrawn'].includes(entry.status)) return false;
        await save(entries.filter((e) => e.id !== id));
        return true;
      });
    },
  };
};

// The one instance the routes and the scheduler share.
export const postQueue = createPostQueue();
