// tiktok-staging.js — what a TikTok draft is told at STAGING, before the
// operator spends a decision on it: the account it will post as, and a video
// longer than that account may post refused now, in words, instead of failing
// at send after the approval. The send still asks creator info again before a
// byte leaves (tiktok-poster.js): this read informs, it never replaces that.

import { readVideoHead } from './video-media.js';
import { readVideoSeconds } from './video-duration.js';
import { readTikTokCreator } from './tiktok-poster.js';

/**
 * Judge a staged TikTok draft's one video against the house's account as
 * TikTok describes it now. impure — disk (the video's header) + network.
 * @param {string} house - the staging lane's house wallet
 * @param {{path: string}} video - the draft's one resolved video
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: false, reason: string}
 *   |{ok: true, account: string|null, note: string|null}>}
 */
export const tiktokStagingCheck = async (house, video, { signal } = {}) => {
  const head = await readVideoHead(video.path);
  const seconds = head.ok && head.contentType !== 'video/webm' ? await readVideoSeconds(head.path, head.size) : null;
  const read = await readTikTokCreator(house, { signal });
  if (!read.ok) {
    return { ok: true, account: null, note: `TikTok could not be asked about the account just now (${read.detail}); the video's length is checked again before it is sent` };
  }
  const max = read.creator.maxVideoSec;
  if (seconds != null && max && seconds > max) {
    return {
      ok: false,
      reason: `the video is ${Math.round(seconds)} seconds long; this TikTok account posts at most ${max} seconds. Attach a shorter video, or render one (image/generate seconds)`,
    };
  }
  return { ok: true, account: read.creator.username || null, note: null };
};
