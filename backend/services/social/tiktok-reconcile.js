// tiktok-reconcile.js — settle TikTok sends that were lost mid-flight (the
// process died, the poster threw, or TikTok was still processing when the
// poll window closed), against TikTok's OWN record of that publish. The
// scheduler's doctrine, unchanged: never blind-retry.
//
// The arbiter is the publish's ticket. The poster records TikTok's
// publish_id on the entry BEFORE any byte is sent, and TikTok's status read
// for that publish says what became of it: published or sent to the inbox
// (mark it sent), failed (mark it failed with TikTok's reason), or still
// going. A post made private (SELF_ONLY) is invisible to any public listing,
// so the account's own publish record is the only honest witness.
//   · No ticket on the entry: the publish was never opened, or its bytes
//     never followed — a FILE_UPLOAD without its bytes cannot publish, and
//     its upload link has expired by the lease — so nothing went out.
//   · Still processing past a day: TikTok will not finish it; marked failed
//     with the advice to look in the TikTok app before posting again.
//   · A live read that fails settles nothing until the next tick.
//
// Direction law: this module never imports the scheduler; the scheduler
// hands it its journal.

import { postQueue } from './post-queue.js';
import { tiktokAccessFor } from './tiktok-token.js';
import { fetchPublishStatus } from './tiktok-api.js';
import { readPublishState, landedOutcome } from './tiktok-poster.js';

const GIVE_UP_MS = 24 * 60 * 60 * 1000;

/**
 * The settlement for one stuck entry from TikTok's status answer, or null to
 * wait. Pure.
 * @param {object} entry - a stuck `sending` entry
 * @param {{ok: boolean, data?: object}|null} status - the status read for its ticket (null: no ticket)
 * @param {number} nowMs
 */
export const settleFromStatus = (entry, status, nowMs) => {
  if (!entry.sendTicket) {
    return { ok: false, detail: 'send lost mid-flight before TikTok received the video; nothing was published, and it wants a fresh decision' };
  }
  if (!status?.ok) return null;
  const landed = readPublishState(status.data);
  if (landed.state === 'failed') return { ok: false, detail: landed.detail };
  if (landed.state === 'pending') {
    const since = Date.parse(entry.sendingAt || entry.decidedAt || entry.createdAt || 0);
    return nowMs - since > GIVE_UP_MS
      ? { ok: false, detail: 'TikTok never finished processing this video; check the account in the TikTok app before posting it again' }
      : null;
  }
  return landedOutcome(landed, {
    publishId: entry.sendTicket,
    username: entry.postedAs?.username || '',
    privacyLevel: entry.tiktokConsent?.privacyLevel ?? null,
  });
};

/**
 * Settle one house's lost TikTok sends. impure — credential store, network,
 * queue store.
 * @param {string} house
 * @param {Array<object>} stuck - TikTok entries past their lease
 * @param {{journal: (entry: object, outcome: object) => Promise<void>,
 *   log: {info: Function, warn: Function}, nowMs?: number, accountId?: string}} deps — accountId: the account they went out as
 */
export const reconcileTikTokSends = async (house, stuck, { journal, log, nowMs = Date.now(), accountId }) => {
  if (!stuck.length) return;
  const ticketed = stuck.filter((e) => e.sendTicket);
  const token = ticketed.length ? await tiktokAccessFor(house, { accountId }).catch((err) => ({ ok: false, detail: err.message })) : null;
  if (token && !token.ok) {
    log.warn('TikTok stuck-send reconciliation deferred: no usable sign-in', { count: ticketed.length, detail: token.detail });
  }
  for (const entry of stuck) {
    const status = entry.sendTicket && token?.ok ? await fetchPublishStatus(token.accessToken, entry.sendTicket) : null;
    if (entry.sendTicket && !token?.ok) continue;
    const outcome = settleFromStatus(entry, status, nowMs);
    if (!outcome) {
      log.info('TikTok stuck send still unsettled; asking again next tick', { id: entry.id, detail: status?.detail || 'processing' });
      continue;
    }
    await postQueue.recordOutcome(entry.id, outcome);
    log.info('TikTok stuck send settled against TikTok\'s publish record', { id: entry.id, sent: outcome.ok });
    await journal(entry, outcome);
  }
};
