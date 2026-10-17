// Reply listener — the reply lane's eyes: a slow heartbeat that reads the
// house's X mentions and lands the replies to the house's OWN posts as
// candidates for the X-bound being to answer.
//
// The lane's shape is Founder's (2026-07-28, second call): replies to OUR posts
// only, open to every author (verification is a displayed signal, never a
// gate), at most two answers per person PER CONVERSATION, the operator's
// approval on every word. This module owns only the FIRST act — seeing. The
// filters are pure (isReplyToUs / isVerifiedAuthor live with the reader);
// the cap is counted from the queue wherever a decision is made
// (notification, stage, send), never cached here where it could go stale.
//
// Same doctrine as the post scheduler: the tick is exported so tests prove
// the REAL path (a real loopback X-shaped server behind the real signed
// read — RULE 0), the interval is unref'd, and a listener that fails never
// stops the server. Never throws: a broken read is logged and the next tick
// tries again. A 429 is a real answer — back off one tick, log once.
//
// ONLY THE HOUSE THAT HOLDS X (house-served.js, Design note, 2026-10-16: two desks
// share one binding store, so a tick reads only when X's holder is a lane of
// a house this backend serves — the house that bound it — and the other
// desk's listener stands aside.

import { readXListings, isReplyToUs, isVerifiedAuthor } from './x-reader.js';
import { replyCandidates, categorizeCandidate, assessSubstance } from './reply-candidates.js';
import { channelBindings } from './channel-bindings.js';
import { servesLane } from '../house-served.js';
import { createLogger } from '../logger.js';

const log = createLogger('ReplyListener');

const TICK_MS = 10 * 60 * 1000;

// Module-scoped tick state: the 429 backoff (one tick) and the
// logged-the-idle-state-once flag. Both are observable through the tick's
// own answers, so tests need no seam into them.
let backoffNextTick = false;
let idleLogged = false;

/**
 * The candidate one mention becomes (pure): the frame-ready fields the
 * notification and the stage gate need, text VERBATIM — what arrived is the
 * record, and stripping at rest would be mangling the evidence before the
 * frame ever sees it.
 * @param {object} tweet one mention from the read
 * @param {object|null} author its expanded author, when X included one
 */
const candidateFromMention = (tweet, author) => ({
  postId: String(tweet?.id || ''),
  conversationId: tweet?.conversation_id ? String(tweet.conversation_id) : null,
  authorId: tweet?.author_id ? String(tweet.author_id) : null,
  username: author?.username || null,
  verified: isVerifiedAuthor(author),
  verifiedType: author?.verified_type || (author?.verified ? 'blue' : null),
  text: String(tweet?.text || ''),
  postCreatedAt: tweet?.created_at || null,
  // WHICH house post was answered — the `replied_to` reference X already
  // sends. Substance engagement stands on this context; without it the
  // being would be answering words about nothing.
  inReplyToPostId: (tweet?.referenced_tweets || []).find((r) => r?.type === 'replied_to')?.id
    ? String((tweet?.referenced_tweets || []).find((r) => r?.type === 'replied_to').id)
    : null,
  // The substance read lands WITH the candidate — computed once, read the
  // same by the knock, the being, and the board.
  substance: assessSubstance(tweet?.text),
  // The escalation read lands WITH the candidate — one first pass, computed
  // once, read the same by the notification, the being, and the board.
  category: categorizeCandidate(tweet?.text),
});

/**
 * ONE CANDIDATE PIPELINE (Design note, 2026-07-28: the mentions-read → candidate
 * upsert the listener tick AND a being-driven read_x share, so a reply the
 * being just read is answerable immediately — no ten-minute tick wait. The
 * our-posts-only law is enforced here, at the very first gate: what is not a
 * reply to the house never becomes a candidate, so nothing downstream can
 * ever answer it. impure — disk.
 * @param {{tweets?: Array, users?: Array, me?: object|null}} read the mentions
 *   read's payload
 * @returns {Promise<{landed: number}>}
 */
export const materializeReplyCandidates = async ({ tweets, users, me } = {}) => {
  const myId = me?.id;
  if (!myId) return { landed: 0 };
  const userById = Object.fromEntries((users || []).map((u) => [u.id, u]));
  let landed = 0;
  for (const tweet of tweets || []) {
    if (!isReplyToUs(tweet, myId)) continue;
    const { added } = await replyCandidates.add(candidateFromMention(tweet, userById[tweet.author_id] || null));
    if (added) landed += 1;
  }
  return { landed };
};

/**
 * One listener pass: mentions read → replied-to-us + dedupe → candidates
 * land. Exposed for tests (RULE 0: the tick is provable without waiting ten
 * minutes). Never throws.
 * @returns {Promise<{ok: boolean, landed?: number, seen?: number,
 *   skipped?: string, detail?: string}>}
 */
// impure — network + disk + clock
export const replyListenerTick = async () => {
  // A 429 on the last tick asked us to slow down — honour it for exactly one
  // tick, then try again. Rate limits are the lane's terms, not an error.
  if (backoffNextTick) {
    backoffNextTick = false;
    return { ok: true, skipped: 'backing off after a rate limit', landed: 0 };
  }
  const holder = (await channelBindings.load().catch(() => ({}))).x;
  if (!holder?.neumaId || !(await servesLane(holder.neumaId, holder.boundBy))) {
    return { ok: true, skipped: 'X is not held by a house this backend serves', landed: 0 };
  }
  let read;
  try {
    read = await readXListings({ kind: 'mentions', limit: 25 });
  } catch (err) {
    log.warn('reply listener read threw', { error: err.message });
    return { ok: false, detail: err.message };
  }
  if (!read.ok) {
    if (read.status === 429) {
      backoffNextTick = true;
      log.warn('X rate-limited the mentions read — backing off one tick');
      return { ok: false, detail: read.detail || 'rate limited' };
    }
    // An unconfigured lane is a normal resting state, not a malfunction —
    // say it once, then idle quietly until keys arrive.
    if (read.detail === 'X credentials are not configured') {
      if (!idleLogged) {
        idleLogged = true;
        log.info('reply listener idle — X credentials are not configured');
      }
      return { ok: false, detail: read.detail };
    }
    log.warn('reply listener read failed', { status: read.status, detail: read.detail });
    return { ok: false, status: read.status, detail: read.detail };
  }
  const { tweets, users, me } = read.data;
  const { landed } = await materializeReplyCandidates({ tweets, users, me });
  if (!me?.id) return { ok: false, detail: 'the account lookup returned no id' };
  if (landed > 0) log.info('reply candidates landed', { landed, seen: tweets.length });
  return { ok: true, landed, seen: tweets.length };
};

/**
 * Start the slow heartbeat. Never blocks the server's listen; the interval
 * is unref'd so it cannot hold the process open.
 * @param {{intervalMs?: number}} [opts]
 * @returns {() => void} stop
 */
// impure
export const startReplyListener = ({ intervalMs = TICK_MS } = {}) => {
  const timer = setInterval(() => {
    replyListenerTick().catch((err) => log.error('reply listener tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  log.info('reply listener standing', { everyMs: intervalMs });
  return () => clearInterval(timer);
};
