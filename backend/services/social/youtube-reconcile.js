// youtube-reconcile.js — settle YouTube sends that were lost mid-flight (the
// process died, or the poster threw before an outcome could land), against
// the channel's OWN recent uploads. The scheduler's doctrine, unchanged:
// never blind-retry. A video found live under the approved title, uploaded
// after the send was claimed, went out unrecorded (mark it sent with its
// id); none found means it never published (mark it failed, visibly). A
// live read that fails settles nothing until the next tick.
//
// Split from post-scheduler.js so a YouTube send is never judged against
// another platform's posts. Direction law: this module never imports the
// scheduler; the scheduler hands it its journal.

import { postQueue } from './post-queue.js';
import { resolveChannelCredential } from './channel-credentials.js';
import { refreshAccessToken } from './youtube-oauth.js';
import { readRecentUploads } from './youtube-api.js';
import { parseYouTubeDraft } from './youtube-metadata.js';

// Clock skew between this machine and YouTube's stamps.
const SKEW_MS = 5 * 60 * 1000;

/**
 * The live upload that IS this entry, or null (pure): the approved title,
 * published no earlier than the send's claim.
 * @param {object} entry - a stuck `sending` queue entry
 * @param {Array<{id: string, title: string, publishedAt: string}>} uploads
 */
export const matchLiveUpload = (entry, uploads) => {
  const parsed = parseYouTubeDraft(entry.text);
  if (!parsed.ok) return null;
  const claimedAt = Date.parse(entry.sendingAt || entry.decidedAt || entry.createdAt || 0);
  return uploads.find((u) => u.title === parsed.meta.title
    && !(Date.parse(u.publishedAt) < claimedAt - SKEW_MS)) || null;
};

/**
 * Settle one house's lost YouTube sends. impure — credential store, network,
 * queue store.
 * @param {string} house
 * @param {Array<object>} stuck - YouTube entries past their lease
 * @param {{journal: (entry: object, outcome: object) => Promise<void>,
 *   log: {info: Function, warn: Function}}} deps
 */
export const reconcileYouTubeSends = async (house, stuck, { journal, log }) => {
  if (!stuck.length) return;
  const credentials = await resolveChannelCredential(house, 'youtube').catch(() => null);
  const token = credentials ? await refreshAccessToken(credentials) : null;
  const recent = token?.ok ? await readRecentUploads(token.accessToken) : null;
  if (!recent?.ok) {
    log.warn('YouTube stuck-send reconciliation deferred: the live read failed', {
      count: stuck.length, detail: recent?.detail || token?.detail || 'YouTube is not connected',
    });
    return;
  }
  for (const entry of stuck) {
    const match = matchLiveUpload(entry, recent.uploads);
    const outcome = match
      ? { ok: true, id: match.id }
      : { ok: false, detail: 'send lost mid-flight: the process died or the poster threw before an outcome could be recorded; the video is NOT on the channel and wants a fresh decision' };
    await postQueue.recordOutcome(entry.id, outcome);
    log.info('YouTube stuck send settled against the channel\'s uploads', { id: entry.id, live: Boolean(match) });
    await journal(entry, outcome);
  }
};
