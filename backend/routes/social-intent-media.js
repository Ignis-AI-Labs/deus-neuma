/** Private approval-image preview; ownership and existing ground precede reads. */
import path from 'node:path';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { laneCardRoot } from '../services/social/lane-card-root.js';
import { resolveMediaFile } from '../services/social/media-source.js';
import { readMediaFile } from '../services/social/x-media.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('IntentMedia');
const missing = (res) => res.status(404).json({ error: 'Card image unavailable' });

/** impure — authenticated route handler; no ground creation or publishing.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const previewIntentMedia = async (req, res) => {
  const lane = req.query.lane;
  const name = req.query.name;
  if (typeof lane !== 'string' || typeof name !== 'string'
    || !/^[a-zA-Z0-9_-]+$/.test(lane) || !/^[A-Za-z0-9._-]+$/.test(name)
    || name === '.' || name === '..') {
    return res.status(400).json({ error: 'bad lane or file name' });
  }
  try {
    if (!await assertNeumaOwner(req, res, lane)) return;
    const cards = await laneCardRoot(req.walletAddress, lane);
    if (!cards) return missing(res);
    const resolved = await resolveMediaFile(path.join(cards, name), [cards]);
    if (!resolved.ok) return missing(res);
    const read = await readMediaFile(resolved.path);
    if (!read.ok) return missing(res);
    res.set({ 'Content-Type': read.contentType, 'Cache-Control': 'private, no-store' });
    return res.send(read.content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return missing(res);
    log.error('Intent media preview failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to read the card' });
  }
};
