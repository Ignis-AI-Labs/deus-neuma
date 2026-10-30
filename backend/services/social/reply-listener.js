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
// ONLY A HOUSE THAT HOLDS X (house-served.js, Design note, 2026-10-16: each house
// keeps its own binding and keys (house-positions.js), so a tick reads, with
// that house's own keys, for each house this backend serves whose X holder
// is one of its lanes here — and the other desk's houses stand aside.

import { readXListings, isReplyToUs, isVerifiedAuthor } from './x-reader.js';
import { replyCandidatesOf, categorizeCandidate, assessSubstance } from './reply-candidates.js';
import { channelBindings } from './channel-bindings.js';
import { readServed, laneHouse } from '../house-served.js';
import { channelOfAccountId } from './account-shape.js';
import { createLogger } from '../logger.js';
import { signalWake } from '../house-clock/wake-signal.js';

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
 * ONE CANDIDATE PIPELINE (ruling, 2026-07-28): the mentions-read → candidate
 * upsert the listener tick AND a being-driven read_x share, so a reply the
 * being just read is answerable immediately — no ten-minute tick wait. The
 * our-posts-only law is enforced here, at the very first gate: what is not a
 * reply to the house never becomes a candidate, so nothing downstream can
 * ever answer it. impure — disk.
 * @param {{tweets?: Array, users?: Array, me?: object|null}} read the mentions
 *   read's payload
 * @param {string} house - the operator wallet whose account was read: its replies land in its own record
 * @param {?string} [accountId] - which of the house's X accounts was read (the one an answer speaks as)
 * @returns {Promise<{landed: number, ids: string[]}>} ids: the replies that landed new
 */
export const materializeReplyCandidates = async ({ tweets, users, me } = {}, house, accountId = null) => {
  const myId = me?.id;
  if (!myId) return { landed: 0, ids: [] };
  const userById = Object.fromEntries((users || []).map((u) => [u.id, u]));
  const ids = [];
  for (const tweet of tweets || []) {
    if (!isReplyToUs(tweet, myId)) continue;
    const { added, candidate } = await replyCandidatesOf(house).add({ ...candidateFromMention(tweet, userById[tweet.author_id] || null), accountId });
    if (added) ids.push(String(candidate?.postId ?? tweet.id));
  }
  return { landed: ids.length, ids };
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
  let served;
  try {
    served = await readServed();
  } catch (err) {
    log.warn('reply listener could not read the houses it serves', { error: err.message });
    return { ok: false, detail: err.message };
  }
  // Every X ACCOUNT a house here holds, each read with its own keys.
  const accounts = [];
  for (const house of served.houses) {
    const bindings = await channelBindings.load(house).catch(() => ({}));
    for (const [accountId, holder] of Object.entries(bindings)) {
      if (channelOfAccountId(accountId) === 'x' && holder?.neumaId && laneHouse(served, holder.neumaId, house)) {
        accounts.push({ house, accountId, holder: holder.neumaId });
      }
    }
  }
  if (!accounts.length) {
    return { ok: true, skipped: 'X is not held by a house this backend serves', landed: 0 };
  }
  let landed = 0;
  let seen = 0;
  for (const { house, accountId, holder } of accounts) {
    const one = await listenFor(house, accountId, holder);
    if (!one.ok) return one;
    landed += one.landed;
    seen += one.seen;
  }
  return { ok: true, landed, seen };
};

// impure — one house account's mentions read with its own keys, its replies landed.
// THE BRIDGE (the house economy's Stage 4): replies that land new wake the
// account's holder, so an answer is drafted without waiting for its next turn —
// inside the charter (house-clock/wake-signal.js), every answer still the
// operator's to approve.
const listenFor = async (house, accountId, holder) => {
  let read;
  try {
    read = await readXListings({ kind: 'mentions', limit: 25, wallet: house, accountId });
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
  const { landed, ids } = await materializeReplyCandidates({ tweets, users, me }, house, accountId);
  if (!me?.id) return { ok: false, detail: 'the account lookup returned no id' };
  if (landed > 0) {
    log.info('reply candidates landed', { landed, seen: tweets.length });
    signalWake({ seat: holder, reason: 'reply', ref: `reply:${ids.at(-1)}`, detail: { channel: 'x', accountId, count: landed } });
  }
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
