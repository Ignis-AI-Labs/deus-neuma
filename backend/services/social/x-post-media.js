/**
 * One door for a file riding an X post: a still or a video, told apart by its
 * bytes, read and uploaded the way its kind needs. The two send paths (the
 * queue's scheduler and a post sent now) both come through here, so a video
 * is handled the same on each.
 */

import { readMediaFile, uploadMedia } from './x-media.js';
import { readVideoHead } from './video-media.js';
import { uploadVideo, X_VIDEO_MAX_BYTES } from './x-video.js';

/**
 * Check one file for an X post. A still is read whole (it is small); a video
 * is only sniffed by its head.
 *
 * impure (disk)
 * @param {string} absPath - already resolved and authorised by the caller
 * @returns {Promise<{ok: true, kind: 'image'|'video', contentType: string, size?: number, path?: string}
 *   |{ok: false, detail: string}>}
 */
export const readXMedia = async (absPath) => {
  const video = await readVideoHead(absPath);
  if (video.ok) {
    return video.size > X_VIDEO_MAX_BYTES
      ? { ok: false, detail: `the video is ${(video.size / 1024 ** 3).toFixed(1)}GB; X takes at most ${X_VIDEO_MAX_BYTES / 1024 ** 3}GB` }
      : { ...video, kind: 'video' };
  }
  const still = await readMediaFile(absPath);
  return still.ok ? { ...still, kind: 'image' } : still;
};

/**
 * Whether a list of files is one X allows on a single post: up to four
 * stills, or one video on its own. Pure.
 * @param {Array<'image'|'video'>} kinds
 * @returns {string|null} the refusal, or null when the list stands
 */
export const xMediaMixRefusal = (kinds) => {
  const videos = kinds.filter((k) => k === 'video').length;
  if (videos > 1) return 'an X post carries one video at most';
  if (videos === 1 && kinds.length > 1) return 'an X post carries a video on its own, not beside images';
  return null;
};

/**
 * Read one file and upload it to X, as its kind needs. Publishes nothing.
 *
 * impure (disk + network)
 * @param {object} credentials
 * @param {string} absPath
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, mediaId: string, kind: 'image'|'video'}|{ok: false, refused?: true, detail: string}>}
 */
export const uploadXMedia = async (credentials, absPath, { signal } = {}) => {
  const read = await readXMedia(absPath);
  if (!read.ok) return { ok: false, refused: true, detail: read.detail };
  const up = read.kind === 'video' ? await uploadVideo(credentials, read, { signal }) : await uploadMedia(credentials, read, { signal });
  return up.ok ? { ok: true, mediaId: up.mediaId, kind: read.kind } : { ok: false, detail: up.detail };
};
