// Reply candidates — the record of who replied to the house's OWN posts on
// X, landed by the reply listener for the X-bound being to answer.
//
// Every candidate is a REAL reply to a house post (referenced_tweets says
// `replied_to`, in_reply_to_user_id says to us) — an @mention alone never
// lands here, so this store IS the […] boundary the stage gate
// enforces: a being can only draft an answer to a post this record holds.
// The text is VERBATIM (the frame doctrine: never strip or mangle what
// arrived — framing happens at the context boundary, not at rest).
//
// A field record, not a secret: plain JSON, one file per HOUSE in its
// operator's realm dir (house-positions.js, replyCandidatesOf), same
// 0600/0700 posture as the sibling social stores. Factory shape so tests
// run the real disk path against tmp files.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from '../data-root.js';
import { createWriteChain } from '../write-chain.js';
import { houseKey } from '../staff/cos-designation.js';
import { housePositionFile } from './house-positions.js';
import { createChannelBindings } from './channel-bindings.js';

const DEFAULT_PATH = join(getSettingsDir(), 'reply-candidates.json');

// The machine record of the replies landed before they moved into the
// houses. Overridable per call so tests never touch the operator's live record.
export const replyCandidatesPath = () =>
  process.env.NEUMA_REPLY_CANDIDATES_PATH || DEFAULT_PATH;

// THE ESCALATION READ (ruling, 2026-07-28) — a PURE HEURISTIC, and honest about
// being one: a first-pass shape read over the reply's words so anything that
// might need care is COUNTED and MARKED for the being and the witness. It is
// never a gate and never a verdict — a miscategorized reply is still shown,
// still answerable; the category only decides how loudly the record speaks.
// First match wins, most severe first; the default is 'ordinary'.
export const REPLY_CATEGORIES = Object.freeze([
  'threat', 'legal', 'financial', 'abuse', 'support', 'criticism', 'ordinary',
]);

const CATEGORY_RULES = Object.freeze([
  ['threat', /\b(kill|murder|bomb|shoot|stab|hurt you|harm you|coming for you|beat you)\b/i],
  ['legal', /\b(lawyer|attorney|sue|suing|sued|lawsuit|legal action|court|subpoena|cease and desist)\b/i],
  ['financial', /\b(refund|refunded|chargeback|charged me|billing|invoice|payment|money back|stole my money|subscription)\b/i],
  ['abuse', /\b(scam|scammer|fraud|fraudsters|spam|shut up|stfu|idiot|moron|pathetic)\b/i],
  ['support', /\b(help|how do i|how do we|how to|can't|cannot|not working|doesn't work|does not work|broken|error|issue|bug|support)\b/i],
  ['criticism', /\b(disappointed|disappointing|worst|terrible|awful|hate|bad idea|overhyped|overrated)\b/i],
]);

/**
 * The escalation category of one reply's text (pure heuristic).
 * @param {string} text
 * @returns {'threat'|'legal'|'financial'|'abuse'|'support'|'criticism'|'ordinary'}
 */
export const categorizeCandidate = (text) => {
  const t = String(text || '');
  for (const [category, re] of CATEGORY_RULES) {
    if (re.test(t)) return category;
  }
  return 'ordinary';
};

// The categories the notification and the board raise their voice for.
export const ALERT_CATEGORIES = Object.freeze(['financial', 'legal', 'threat']);

// THE SUBSTANCE READ (Design note, 2026-07-28: […]). Same doctrine as the escalation
// read: a PURE HEURISTIC, honest about being one — a first-pass shape read
// over the reply's own words (mentions, hashtags, URLs, and emoji stripped —
// the address and the decoration are not the substance) so genuine engagement
// is MARKED and sorted first. It is never a gate and never a verdict: a
// low-effort reply is still on the record, still answerable; the standing
// only decides what the being and the board see FIRST.
const GENERIC_LOW_EFFORT = /\b(nice|great|cool|awesome|amazing|spot on|love (it|this)|lfg|gm|wagmi|bullish|based|fire|let'?s go|to the moon|good (project|one)|great project|nice project|well said|so true|facts)\b/i;

/**
 * The engagement standing of one reply's text (pure heuristic): is anyone
 * actually saying something about the post, or is this a drive-by? Eight or
 * more real words is engagement on its face; under that, generic praise and
 * stock crypto slogans read as low-effort, and four-plus real words still
 * count — a short genuine question ([…]) is substance.
 * @param {string} text
 * @returns {'substantive'|'low-effort'}
 */
export const assessSubstance = (text) => {
  const stripped = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@\w+/g, ' ')
    .replace(/#\w+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = stripped ? stripped.split(' ').length : 0;
  if (words >= 8) return 'substantive';
  if (words === 0) return 'low-effort';
  if (GENERIC_LOW_EFFORT.test(stripped)) return 'low-effort';
  return words >= 4 ? 'substantive' : 'low-effort';
};

// The queue standings that count as a LIVE answer (kept in the queue's own
// law — post-queue.js REPLY_LIVE_STANDINGS — and mirrored here so the
// disposition read never imports the whole queue module): an answer that
// stands or stood; the dead standings never speak.
const LIVE_ANSWER_STANDINGS = Object.freeze(['draft', 'approved', 'sending', 'sent']);

/**
 * The current disposition of one candidate (pure): what the house has done
 * about this reply so far, read from the candidate itself (dismissed) and
 * the queue's live entries targeting it. Dead answers (failed/withdrawn/
 * rejected) leave no disposition — a fresh answer may be staged.
 * @param {object|null} candidate
 * @param {Array<object>} queueEntries
 * @returns {'staged'|'approved'|'sent'|'dismissed'|'none'}
 */
export const replyDisposition = (candidate, queueEntries) => {
  if (!candidate) return 'none';
  if (candidate.dismissed) return 'dismissed';
  const live = (queueEntries || []).filter((e) => e?.kind === 'reply'
    && e?.reply?.toPostId === candidate.postId
    && LIVE_ANSWER_STANDINGS.includes(e.status));
  if (live.some((e) => e.status === 'sent')) return 'sent';
  if (live.some((e) => e.status === 'approved' || e.status === 'sending')) return 'approved';
  if (live.length) return 'staged';
  return 'none';
};

/**
 * The record as the inbox reads it (pure): each reply with its disposition, its
 * category (legacy rows landed before the escalation read are read now, the same
 * first pass), and the house's live answers to it — id, standing and words — so
 * neither the desk nor a being has to hunt the queue for what the house said.
 * @param {Array<object>} candidates
 * @param {Array<object>} queueEntries
 */
export const replyInboxRows = (candidates, queueEntries) => {
  const answers = new Map();
  for (const e of queueEntries || []) {
    if (e?.kind !== 'reply' || !LIVE_ANSWER_STANDINGS.includes(e.status)) continue;
    const to = String(e.reply?.toPostId || '');
    if (!answers.has(to)) answers.set(to, []);
    answers.get(to).push({ id: e.id, status: e.status, text: e.text });
  }
  return (candidates || []).map((c) => ({
    ...c,
    category: REPLY_CATEGORIES.includes(c.category) ? c.category : categorizeCandidate(c.text),
    disposition: replyDisposition(c, queueEntries),
    answers: answers.get(String(c.postId)) || [],
  }));
};

/**
 * @param {{ path?: string|(() => string), seed?: () => Promise<Array<object>> }} [opts]
 *   seed: what a file that was never written reads as (a house's share of
 *   the machine record)
 */
export const createReplyCandidates = (opts = {}) => {
  // Same law as createPostQueue: a supplied-but-empty `path` is a BUG, not a
  // request for the default — never bind silently to the operator's live
  // record because an env var name was mistyped.
  if ('path' in opts && !(typeof opts.path === 'function'
    || (typeof opts.path === 'string' && opts.path.length > 0))) {
    throw new TypeError('createReplyCandidates: `path` was supplied but is not a non-empty string or a function');
  }
  const { path = replyCandidatesPath, seed = async () => [] } = opts;
  const target = () => (typeof path === 'function' ? path() : path);

  // Serialize mutations — two ticks must never interleave a read+write.
  const serialize = createWriteChain();

  // impure — missing file = nobody has replied yet (or the house's share of
  // the machine record, its seed); a corrupt file surfaces,
  // never collapses to [] (that would silently re-offer every reply the
  // being already saw).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return seed();
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('reply-candidates: store is not an array');
    return parsed;
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

  return {
    load,

    /**
     * Land one reply candidate, deduped by post id — a slow tick revisits the
     * same mentions window, and a reply must never be offered twice. A
     * re-seen candidate BACKFILLS what a later lane learned to read (parent
     * linkage, the substance standing) so the record grows honest as the
     * lane does — never duplicated, never left blind. impure.
     * @param {{postId: string, conversationId?: string|null, authorId?: string|null,
     *   username?: string|null, verified: boolean, verifiedType?: string|null,
     *   text: string, postCreatedAt?: string|null, category?: string,
     *   inReplyToPostId?: string|null, substance?: string}} candidate
     * @returns {Promise<{added: boolean, candidate: object}>}
     */
    add(candidate) {
      return serialize(async () => {
        const entries = await load();
        const existing = entries.find((e) => e.postId === candidate.postId);
        if (existing) {
          let grew = false;
          if (!existing.inReplyToPostId && candidate.inReplyToPostId) {
            existing.inReplyToPostId = String(candidate.inReplyToPostId);
            grew = true;
          }
          if (!existing.substance) {
            existing.substance = candidate.substance === 'substantive' || candidate.substance === 'low-effort'
              ? candidate.substance
              : assessSubstance(existing.text);
            grew = true;
          }
          if (grew) await save(entries);
          return { added: false, candidate: existing };
        }
        const entry = {
          postId: String(candidate.postId),
          conversationId: candidate.conversationId || null,
          authorId: candidate.authorId || null,
          username: candidate.username || null,
          verified: candidate.verified === true,
          verifiedType: candidate.verifiedType || null,
          text: String(candidate.text || ''),
          postCreatedAt: candidate.postCreatedAt || null,
          // WHICH house post this answers — the context substance engagement
          // stands on. Null only when X sent no referenced_tweets.
          inReplyToPostId: candidate.inReplyToPostId ? String(candidate.inReplyToPostId) : null,
          // The escalation read, computed at landing when the caller did not
          // — stored so the being, the notification, and the board all read
          // the SAME first pass.
          category: REPLY_CATEGORIES.includes(candidate.category)
            ? candidate.category
            : categorizeCandidate(candidate.text),
          // The substance read, same law: computed once at landing, read the
          // same everywhere, never a gate.
          substance: candidate.substance === 'substantive' || candidate.substance === 'low-effort'
            ? candidate.substance
            : assessSubstance(candidate.text),
          firstSeenAt: new Date().toISOString(),
        };
        entries.push(entry);
        await save(entries);
        return { added: true, candidate: entry };
      });
    },

    /**
     * Set one candidate aside (the do-not-engage mark, Design note, 2026-07-28:
     * the decision is RECORDED on the candidate — who set it aside, when,
     * and why — never deleted. The record of what was said to the house is
     * the field's truth; dismissing only ends the knock. Idempotent: a
     * second dismissal stands on the first's record. impure.
     * @param {string} postId
     * @param {{by?: string, reason?: string}} [opts]
     * @returns {Promise<{ok: true, candidate: object}|{ok: false, error: string}>}
     */
    dismiss(postId, { by, reason } = {}) {
      return serialize(async () => {
        const entries = await load();
        const entry = entries.find((e) => e.postId === String(postId));
        if (!entry) return { ok: false, error: 'that reply is not on the house\'s record' };
        if (!entry.dismissed) {
          entry.dismissed = true;
          entry.dismissedBy = String(by || '');
          entry.dismissedAt = new Date().toISOString();
          if (reason) entry.reason = String(reason).replace(/\s+/g, ' ').trim().slice(0, 200);
          await save(entries);
        }
        return { ok: true, candidate: entry };
      });
    },

    /**
     * Take one reply back out of the bin — someone looked back and chose to
     * engage it after all. The set-aside is kept on the record as what it was
     * (restoredBy/At say who changed their mind), never erased. impure.
     * @param {string} postId
     * @param {{by?: string}} [opts]
     * @returns {Promise<{ok: true, candidate: object}|{ok: false, error: string}>}
     */
    restore(postId, { by } = {}) {
      return serialize(async () => {
        const entries = await load();
        const entry = entries.find((e) => e.postId === String(postId));
        if (!entry) return { ok: false, error: 'that reply is not on the house\'s record' };
        if (entry.dismissed) {
          entry.dismissed = false;
          entry.restoredBy = String(by || '');
          entry.restoredAt = new Date().toISOString();
          await save(entries);
        }
        return { ok: true, candidate: entry };
      });
    },

    /** One candidate by the reply's post id, or null. impure. */
    async byPostId(postId) {
      const entries = await load();
      return entries.find((e) => e.postId === String(postId)) || null;
    },
  };
};

// EACH HOUSE'S OWN RECORD (Design note, 2026-10-16: two houses are never confused):
// a house's listener lands the replies to its own posts in its own realm dir,
// and only that house's desk, beings and stage gate read them. The machine
// record written before then is read, never moved, and only by the house it
// was landed for: the one the machine X binding names (boundBy) — every
// reply in it came through that binding's account. A caller with no house
// reads nothing and lands nothing.
const HOUSE_FILE = 'reply-candidates.json';
const NOT_ON_RECORD = Object.freeze({ ok: false, error: 'that reply is not on the house\'s record' });
const NO_HOUSE = Object.freeze({
  load: async () => [],
  byPostId: async () => null,
  add: async () => { throw new Error('a reply lands in a house — no house was named'); },
  dismiss: async () => NOT_ON_RECORD,
  restore: async () => NOT_ON_RECORD,
});
const machineRecord = createReplyCandidates();
const machineBindings = createChannelBindings();
const houseStores = new Map();

/**
 * The reply record of one house (its operator's wallet). impure (the
 * returned store reads and writes disk).
 * @param {?string} wallet
 * @returns {ReturnType<typeof createReplyCandidates>}
 */
export const replyCandidatesOf = (wallet) => {
  const key = houseKey(wallet);
  if (!key) return NO_HOUSE;
  const file = housePositionFile(key, HOUSE_FILE);
  if (!houseStores.has(file)) {
    houseStores.set(file, createReplyCandidates({
      path: file,
      seed: async () => (houseKey((await machineBindings.bindingFor('x'))?.boundBy) === key ? machineRecord.load() : []),
    }));
  }
  return houseStores.get(file);
};
