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
import { mediaLibraryRoot } from '../media-library.js';
import { focusGroundRoots } from '../focus-ground.js';

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
 * impure (disk)
 * @returns {Promise<{ok: true, media: Array<{path: string, alt: string}>}
 *   |{ok: false, detail: string}>}
 */
export const resolvePostMedia = async (connection, rawMedia) => {
  if (rawMedia == null) return { ok: true, media: [] };
  if (!Array.isArray(rawMedia)) return { ok: false, detail: 'media must be a list of {path, alt}' };
  if (rawMedia.length > MEDIA_PER_POST_MAX) {
    return { ok: false, detail: `at most ${MEDIA_PER_POST_MAX} images ride one post` };
  }
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
  ];
  const media = [];
  for (const item of rawMedia) {
    const resolved = await resolveMediaFile(item?.path, roots);
    if (!resolved.ok) return { ok: false, detail: resolved.detail };
    // Sniff now too, so a being learns at STAGE time that its file is not an
    // image — not hours later when the scheduler refuses to publish.
    const read = await readMediaFile(resolved.path);
    if (!read.ok) return { ok: false, detail: read.detail };
    media.push({ path: resolved.path, alt: String(item?.alt || '').slice(0, ALT_TEXT_MAX) });
  }
  return { ok: true, media };
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
