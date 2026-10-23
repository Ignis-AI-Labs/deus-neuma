/**
 * GET /api/v1/social-channels/queue/:id/media/:index — one staged
 * attachment's BYTES, for the operator's preview before they decide. The
 * send-time re-check doctrine applies here too: the stored path must still
 * resolve to the exact real path staging authorised, and the bytes must
 * still sniff as what the channel takes (an image, or the video of a
 * YouTube post) — a file swapped or gutted since staging is a 404, never a
 * stream. Private and never cached: these are drafts awaiting a decision,
 * not public media. A video is streamed from disk, never read whole.
 *
 * Mounted inside the social router, behind its session and the `/queue/:id`
 * house door.
 */
import { createReadStream } from 'fs';
import { postQueue } from '../services/social/post-queue.js';
import { reverifyMediaFile } from '../services/social/media-source.js';
import { readMediaFile } from '../services/social/x-media.js';
import { readVideoHead } from '../services/social/video-media.js';
import { postsOwnMedia } from '../services/social/poster-registry.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SocialQueueMedia');

/** impure — authenticated route handler; reads disk, publishes nothing.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const previewQueueMedia = async (req, res) => {
  try {
    const entries = await postQueue.load();
    const entry = entries.find((e) => e.id === req.params.id);
    const index = Number.parseInt(req.params.index, 10);
    const item = entry && Number.isInteger(index) && index >= 0
      ? entry.media?.[index]
      : null;
    if (!item) return res.status(404).json({ error: 'no such media on that queue entry' });
    const verified = await reverifyMediaFile(item.path);
    if (!verified.ok) {
      return res.status(404).json({ error: `the staged media no longer stands — ${verified.detail}` });
    }
    if (postsOwnMedia(entry.channelId)) {
      const video = await readVideoHead(verified.path);
      if (!video.ok) return res.status(404).json({ error: `the staged media is unreadable — ${video.detail}` });
      res.set({ 'Content-Type': video.contentType, 'Content-Length': String(video.size), 'Cache-Control': 'private, no-store' });
      return createReadStream(video.path)
        .on('error', (err) => { log.warn('video preview stream broke', { id: entry.id, error: err.message }); res.destroy(err); })
        .pipe(res);
    }
    const read = await readMediaFile(verified.path);
    if (!read.ok) {
      return res.status(404).json({ error: `the staged media is unreadable — ${read.detail}` });
    }
    res.set({ 'Content-Type': read.contentType, 'Cache-Control': 'private, no-store' });
    return res.send(read.content);
  } catch (error) {
    log.error('Queue media preview failed', { id: req.params.id, error: error.message });
    return res.status(500).json({ error: 'Failed to read the staged media' });
  }
};
