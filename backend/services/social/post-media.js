/**
 * Post media authorization — the one door every image attached to outward
 * speech passes through. Relocated out of portal-stream.js unchanged when
 * posting became a filed intent (Stage 2 of
 * docs/planning/proposals/being-tool-surface-primitives.md): the intent
 * executors and the reply-lane tools share this door.
 */
import { laneCardRoot } from './lane-card-root.js';
import { readMediaFile, ALT_TEXT_MAX, MEDIA_PER_POST_MAX } from './x-media.js';
import { resolveMediaFile } from './media-source.js';
import { readVideoHead } from './video-media.js';
import { ownMediaChannel } from './poster-registry.js';
import { mediaLibraryRoot } from '../media-library.js';
import { focusGroundRoots } from '../focus-ground.js';
import { laneDirs, resolveImage } from '../image-forge/image-store.js';

/**
 * Resolve the media a being named into authorised real paths.
 *
 * Attaching a file to a public post is egress of that file, so the paths are
 * checked against the grounds the operator actually opened for THIS seat
 * (`focusGroundRoots` plus anything granted this session) rather than trusted.
 * Refusal is total: if one image cannot be authorised the whole call fails,
 * because a post that silently drops an image is not the post that was asked
 * for. Alt text is carried through unchanged; its absence is surfaced by the
 * queue read, never invented here.
 *
 * A channel whose post IS its media (YouTube, TikTok: postsOwnMedia) takes one
 * VIDEO, sniffed by its head, instead of images; a still names that channel's
 * own photo refusal.
 *
 * An item names a file by `path`, or by `image`: the id the image forge gave
 * the being for one of its OWN renders (image/generate). The id resolves in
 * this lane's manifest only, so another being's id is "no such image".
 *
 * impure (disk)
 * @param {object} connection
 * @param {unknown} rawMedia
 * @param {{channelId?: string}} [opts] - the channel the media will go to
 * @returns {Promise<{ok: true, media: Array<{path: string, alt: string}>}
 *   |{ok: false, detail: string}>}
 */
export const resolvePostMedia = async (connection, rawMedia, { channelId = null } = {}) => {
  if (rawMedia == null) return { ok: true, media: [] };
  if (!Array.isArray(rawMedia)) return { ok: false, detail: 'media must be a list of {path, alt}' };
  const video = ownMediaChannel(channelId);
  if (video && rawMedia.length > 1) return { ok: false, detail: `a ${video.name} post is exactly one video` };
  if (rawMedia.length > MEDIA_PER_POST_MAX) {
    return { ok: false, detail: `at most ${MEDIA_PER_POST_MAX} images ride one post` };
  }
  const laneId = connection?.companion?.neumaId || null;
  const ownArt = laneId ? laneDirs(laneId) : [];
  const roots = [
    ...focusGroundRoots(connection),
    ...(Array.isArray(connection._grantedReadRoots) ? connection._grantedReadRoots : []),
    ...(Array.isArray(connection._grantedWriteRoots) ? connection._grantedWriteRoots : []),
    // THE CULTURE LIBRARY is trusted by construction (ruling, 2026-07-28):
    // every file in it arrived through media_save — the ACTS-chipped,
    // sniff-verified download — so it needs no Explorer ground to attach
    // from. It grants READ of its own directory only; nothing else widens.
    mediaLibraryRoot(),
    // THE BEING'S OWN CARD GROUND (x-card-pipeline move 4): cards it rendered
    // landed in its own working ground under cards/ — its own work product,
    // authored through the chipped render_card path. A standing attach root
    // for its own posts: the old law made attachability depend on which
    // folder the operator happened to have open. Egress is still the ACTS
    // gate; only the dead end died.
    ...(await laneCardsRoot(connection)),
    // THE BEING'S OWN RENDERS: the forge files them in its own art folder,
    // its own work product like the cards above.
    ...ownArt,
  ];
  const media = [];
  for (const item of rawMedia) {
    const resolved = item?.image != null ? await resolveOwnRender(laneId, item.image, ownArt) : await resolveMediaFile(item?.path, roots);
    if (!resolved.ok) return { ok: false, detail: resolved.detail };
    // Sniff now too, so a being learns at STAGE time that its file is not an
    // image (or, for a video channel, not a video) — not hours later when the
    // scheduler refuses to publish.
    const read = video ? await readVideoHead(resolved.path) : await readMediaFile(resolved.path);
    if (!read.ok && video && (await readMediaFile(resolved.path)).ok) return { ok: false, detail: video.photo };
    if (!read.ok) return { ok: false, detail: read.detail };
    media.push({ path: resolved.path, alt: String(item?.alt || '').slice(0, ALT_TEXT_MAX) });
  }
  return { ok: true, media };
};

// impure (disk) — one of this lane's own renders, by the id the forge gave it.
const resolveOwnRender = async (laneId, imageId, ownArt) => {
  if (!laneId) return { ok: false, detail: 'only a bound being has renders of its own to attach' };
  const found = resolveImage(laneId, String(imageId).trim());
  if (!found.ok) return { ok: false, detail: `image ${imageId}: ${found.error}` };
  return resolveMediaFile(found.path, ownArt);
};

/**
 * The `cards/` directory of THIS being's own house-ground working area —
 * where render_card lands every card it makes. Null when no wallet/lane
 * stands or the ground is not set yet (a missing root grants nothing).
 * impure (fs).
 */
const laneCardsRoot = async (connection) => {
  if (!connection?.walletAddress || !connection?.companion?.neumaId) return [];
  try {
    const root = await laneCardRoot(connection.walletAddress, connection.companion.neumaId);
    return root ? [root] : [];
  } catch {
    return [];
  }
};
