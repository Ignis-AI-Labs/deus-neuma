// mandate-act — where the house's MANDATE meets the acts it covers. Each
// door is the ordinary door with one question added — […] — and every answer is journaled:
//
//   · a post the CMO stages (social/queue): covered → approved on the spot
//     under the mandate (decidedBy = the house that granted it,
//     decidedUnder = the mandate's id), so no card waits; the scheduler sends it.
//   · a reply the CMO stages (queue_reply_to_x), when replies were granted:
//     covered → sent at once, through the same publishEntry every send uses.
//   · a render (image/generate, video/generate): covered → no card.
//   · at SEND time the scheduler asks again: a post decided under a mandate
//     leaves only while that mandate stands (paused → held; withdrawn or
//     ended → cancelled) and only if the legal check does not now rate it serious.
//   · after a send: what the platform said is journaled; a spam refusal trips.
//   · an act drawn from hostile text the CMO read (mandate-hostile.js) is
//     never covered: it is staged as an ordinary card, and the rest goes on.
//
// Everything outside the mandate's scope answers 'ask' and the usual approval
// law runs unchanged. Every law that is no mandate's to grant (content law,
// AI disclosure, secrets, money, houses) lives in the doors themselves and is
// never consulted here, so a mandate cannot reach past it.
//
// impure — the house's stores.

import { postQueue } from '../../social/post-queue.js';
import { houseEntries } from '../../social/queue-house.js';
import { houseOfLane } from '../../social/house-positions.js';
import { loadAccountStore } from '../../social/account-store.js';
import { houseWallet } from '../../house-served.js';
import { houseKey } from '../../staff/cos-designation.js';
import { cmoDesignation } from '../cmo-designation.js';
import { campaignStoreFor } from '../campaign-store.js';
import { withLegalFlags } from '../draft-review.js';
import { coverPost, coverRender, legalTrips, isSpamRefusal, mandateStanding } from './mandate-shape.js';
import { readMandate, journalMandate } from './mandate-store.js';
import { tripMandate } from './mandate-tripwire.js';
import { heldFor } from './mandate-hostile.js';
import { noteInjectionSighting } from '../../security/injection-sightings.js';
import { createLogger } from '../../logger.js';

const log = createLogger('Marketing.MandateAct');

// The render rows a mandate may cover — nothing else on the intents server.
const RENDER_TOOLS = Object.freeze(['image.generate', 'video.generate']);

const excerpt = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);

// impure — the house's mandate, when this lane is its seated CMO.
const seatedMandate = async (house, laneId) => {
  if (!house || !laneId) return null;
  const mandate = await readMandate(house);
  if (!mandate || mandate.laneId !== laneId) return null;
  return (await cmoDesignation.holds(house, laneId)) ? mandate : null;
};

// impure — the companies on both sides of a post: its account's and its campaign's.
const companiesOf = async (house, entry) => {
  const [store, campaigns] = await Promise.all([
    loadAccountStore(house),
    entry.campaignId ? campaignStoreFor(house).then((bench) => bench.load()) : [],
  ]);
  return {
    accountCompanyId: store.accounts?.[entry.accountId]?.companyId ?? null,
    campaignCompanyId: campaigns.find((c) => c.id === entry.campaignId)?.companyId ?? null,
  };
};

// impure — the legal check's verdict on one post right now (the claims check
// over its company's kit). Unreadable reads as serious: a mandate that cannot
// see the check does not send past it.
const legalSeverityOf = async (house, entry) => {
  try {
    const [flagged] = await withLegalFlags([entry], house);
    return flagged?.legal?.open ? flagged.legal.severity : null;
  } catch (err) {
    log.warn('the legal check could not be read for a mandate act — treated as serious', { id: entry.id, error: err.message });
    return 'critical';
  }
};

// impure — judge one staged entry against the mandate. Returns the mandate
// when it is covered, or {reason} (with the trip already pulled, or the hold
// that keeps it out named). `from` is where it was staged: the chat, and its
// words before link tracking.
const judge = async (house, laneId, entry, { sessionId = null, text = entry.text } = {}) => {
  const mandate = await seatedMandate(house, laneId);
  if (!mandate) return { reason: 'no mandate stands' };
  const held = await heldFor({ house, laneId, sessionId, postId: entry.reply?.toPostId || null, text });
  if (held) return { reason: held.reason, held: true };
  const [entries, companies] = await Promise.all([houseEntries(house), companiesOf(house, entry)]);
  const verdict = coverPost(mandate, { house, laneId, entry, entries, ...companies });
  if (verdict.verdict === 'trip') {
    await tripMandate(house, { kind: verdict.kind, detail: verdict.reason, ref: { queueId: entry.id } });
    return { reason: verdict.reason, tripped: true };
  }
  if (verdict.verdict !== 'covered') return { reason: verdict.reason };
  const severity = await legalSeverityOf(house, entry);
  if (legalTrips(mandate, severity)) {
    const reason = `the legal check rates this post ${severity}`;
    await tripMandate(house, { kind: 'legal', detail: reason, ref: { queueId: entry.id } });
    return { reason, tripped: true };
  }
  return { mandate };
};

/**
 * A post the CMO just staged: approve it under the standing mandate when the
 * mandate covers it. impure; never throws — an error leaves the draft for
 * the operator, the ordinary law.
 * @param {{laneId: string, entry: object, sessionId?: ?string, text?: string}} staged
 *   sessionId — the chat it was staged from; text — its words before link tracking
 * @returns {Promise<{covered: boolean, reason?: string, tripped?: boolean, held?: boolean, entry?: object}>}
 */
export const approveUnderMandate = async ({ laneId, entry, sessionId = null, text = entry?.text }) => {
  try {
    const house = await houseOfLane(laneId);
    const judged = await judge(house, laneId, entry, { sessionId, text });
    if (!judged.mandate) return { covered: false, reason: judged.reason, tripped: Boolean(judged.tripped), held: Boolean(judged.held) };
    const result = await postQueue.approve(entry.id, { decidedBy: house, under: judged.mandate.id });
    if (!result.ok) return { covered: false, reason: result.error };
    await journalMandate(house, {
      mandateId: judged.mandate.id, kind: 'act', act: 'post', queueId: entry.id,
      channelId: entry.channelId, accountId: entry.accountId, text: excerpt(entry.text), scheduledFor: entry.scheduledFor || null,
    });
    return { covered: true, entry: result.entry };
  } catch (err) {
    log.error('a staged post could not be judged against the mandate — it waits for the operator', { id: entry?.id, error: err.message });
    return { covered: false, reason: 'the mandate could not be read' };
  }
};

/**
 * May the CMO stage a reply with no card? Only when replies were granted, the
 * account is in scope, nothing holds that conversation or chat, and the reply
 * it answers is not itself hostile text — a stranger's […] is answered only with the operator's yes (the full judgment
 * runs again at send). impure.
 * @param {{laneId: string, accountId: string, sessionId?: ?string, postId?: ?string, answering?: string}} q
 *   answering — the words of the reply being answered
 */
export const replyMandateFor = async ({ laneId, accountId, sessionId = null, postId = null, answering = '' }) => {
  const house = await houseOfLane(laneId).catch(() => null);
  const mandate = await seatedMandate(house, laneId).catch(() => null);
  if (!(mandate && mandateStanding(mandate) === 'active' && mandate.acts.replies
    && mandate.accounts.some((a) => a.id === accountId))) return false;
  const hostile = await noteInjectionSighting({
    wallet: house, lane: laneId, kind: 'reply', source: 'reply', origin: `the reply to post ${postId || '—'}`,
    text: answering, read: true, sessionId, postId,
  });
  if (hostile) return false;
  return !(await heldFor({ house, laneId, sessionId, postId }));
};

/**
 * A reply the CMO staged under the mandate: approving a reply IS its send
 * (the reply-lane law), so the mandate claims and publishes it now through
 * `publish` — the scheduler's own publishEntry. impure; never throws.
 * @param {{laneId: string, entry: object, publish: (entry: object) => Promise<object>, sessionId?: ?string}} staged
 */
export const sendReplyUnderMandate = async ({ laneId, entry, publish, sessionId = null }) => {
  try {
    const house = await houseOfLane(laneId);
    const judged = await judge(house, laneId, entry, { sessionId });
    if (!judged.mandate) return { covered: false, reason: judged.reason, tripped: Boolean(judged.tripped), held: Boolean(judged.held) };
    const claimed = await postQueue.claimReplyForSend(entry.id, { decidedBy: house, textSeen: entry.text, under: judged.mandate.id });
    if (!claimed.ok || claimed.entry.status !== 'sending') return { covered: false, reason: claimed.error || 'the conversation went cold — nothing was sent' };
    await journalMandate(house, {
      mandateId: judged.mandate.id, kind: 'act', act: 'reply', queueId: entry.id,
      channelId: entry.channelId, accountId: entry.accountId, text: excerpt(entry.text),
    });
    const outcome = await publish(claimed.entry).catch((err) => ({ ok: false, pending: true, detail: `outcome unknown: ${err.message}` }));
    await mandateAfterSend(claimed.entry, outcome);
    return { covered: true, outcome };
  } catch (err) {
    log.error('a reply could not be sent under the mandate — it waits for the operator', { id: entry?.id, error: err.message });
    return { covered: false, reason: 'the mandate could not be read' };
  }
};

/**
 * The intent sweep's question for a render: a card the policy would raise
 * is answered by the mandate when it covers renders. Every other tier
 * (denied, an observe hold, allowed) stands as it was. impure.
 * @param {object} connection
 * @param {string} access - the tier the policy chain resolved
 * @param {string} policyTool
 * @param {string} summary - the act in one line, for the journal
 */
export const mandateRenderAccess = async (connection, access, policyTool, summary) => {
  if (access !== 'approval_required' || !RENDER_TOOLS.includes(policyTool)) return access;
  try {
    const laneId = connection.companion?.neumaId || null;
    const house = houseKey(connection.walletAddress) || await houseOfLane(laneId);
    const mandate = await seatedMandate(house, laneId);
    if (!mandate || coverRender(mandate, { house, laneId }).verdict !== 'covered') return access;
    if (await heldFor({ house, laneId, sessionId: connection.sessionId || null, text: summary })) return access;
    await journalMandate(house, { mandateId: mandate.id, kind: 'act', act: policyTool === 'video.generate' ? 'video' : 'image', text: excerpt(summary) });
    return 'allowed';
  } catch (err) {
    log.warn('a render could not be judged against the mandate — it asks', { error: err.message });
    return access;
  }
};

/**
 * The scheduler's send-time question for a post decided under a mandate.
 * true → send it now; false → not this tick (held, or cancelled here).
 * impure; never throws — an unreadable mandate holds.
 * @param {object} entry - an `approved` queue entry
 */
export const mandateLetsSend = async (entry) => {
  if (!entry?.decidedUnder) return true;
  const house = houseWallet(entry.decidedBy);
  try {
    const mandate = await readMandate(house);
    const standing = mandate?.id === entry.decidedUnder ? mandateStanding(mandate) : 'withdrawn';
    if (standing === 'paused') return false;
    if (standing !== 'active') {
      const pulled = await postQueue.withdraw(entry.id, { withdrawnBy: 'system', reason: standing === 'expired' ? 'mandate-ended' : 'mandate-withdrawn' });
      if (pulled.ok) await journalMandate(house, { mandateId: entry.decidedUnder, kind: 'cancelled', queueId: entry.id, reason: standing });
      return false;
    }
    const severity = await legalSeverityOf(house, entry);
    if (legalTrips(mandate, severity)) {
      await tripMandate(house, { kind: 'legal', detail: `the legal check now rates this post ${severity}`, ref: { queueId: entry.id } });
      return false;
    }
    return true;
  } catch (err) {
    log.error('the mandate could not be read at send time — the post holds', { id: entry.id, error: err.message });
    return false;
  }
};

/**
 * Journal what the platform said about a post sent under a mandate; a spam
 * refusal trips the mandate. impure; never throws.
 */
export const mandateAfterSend = async (entry, outcome) => {
  if (!entry?.decidedUnder) return;
  const house = houseWallet(entry.decidedBy);
  try {
    await journalMandate(house, {
      mandateId: entry.decidedUnder, kind: outcome?.ok ? 'sent' : outcome?.pending ? 'pending' : 'failed',
      queueId: entry.id, channelId: entry.channelId, accountId: entry.accountId,
      ...(outcome?.ok ? { postId: String(outcome.id) } : { detail: excerpt(outcome?.detail) }),
    });
    if (isSpamRefusal(outcome)) {
      await tripMandate(house, { kind: 'spam', detail: `${entry.channelId} said: ${excerpt(outcome.detail)}`, ref: { queueId: entry.id } });
    }
  } catch (err) {
    log.error('a mandate send could not be journaled', { id: entry.id, error: err.message });
  }
};
