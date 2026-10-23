/**
 * The forge renders a filed post would attach, so its approval card shows the
 * clip or still a yes is about to make public (Design note, 2026-10-23: the queue board
 * played a forge clip the post card never showed). A being attaches its own
 * render by id (`media: [{image: […]}]`, social/post-media.js); the id is
 * resolved in the ASKING lane's manifest only, so another lane's id shows
 * nothing. The desk fetches the bytes through the lane-scoped, authenticated
 * /api/v1/image-forge/images route, which re-checks ownership — this list is a
 * signpost, never the grant.
 *
 * impure — reads the lane's image manifest.
 */
import { resolveImage } from './image-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('ApprovalRenders');

/** As many renders as a post can carry previews for (approvalMedia's cap). */
const RENDERS_MAX = 4;

/**
 * @param {string|null|undefined} laneId the lane that filed the act
 * @param {Object|undefined} args the filed fields the card shows
 * @returns {Array<{imageId: string, mime: string, laneId: string}>}
 */
export const approvalRenders = (laneId, args) => {
  if (!laneId) return [];
  const media = Array.isArray(args?.media) ? args.media : [];
  const ids = media.map((item) => item?.image).filter((id) => typeof id === 'string' && id.length > 0).slice(0, RENDERS_MAX);
  if (ids.length === 0) return [];
  try {
    return ids
      .map((id) => resolveImage(laneId, id))
      .filter((found) => found.ok)
      .map(({ record }) => ({ imageId: record.imageId, mime: String(record.mime || 'image/png'), laneId }));
  } catch (err) {
    // A manifest that cannot be read costs the preview, never the card.
    log.warn('the card shows no render preview: the lane manifest could not be read', { laneId, err: err.message });
    return [];
  }
};
