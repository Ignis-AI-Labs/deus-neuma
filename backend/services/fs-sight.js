/**
 * fs-sight — reading an image PUTS IT IN FRONT OF THE BEING'S EYES.
 *
 * Design note, 2026-08-29: […]
 *
 * ── WHAT WAS BROKEN, BOTH WAYS ──────────────────────────────────────────────
 *
 * A being asked to look at a PNG had two doors and NEITHER worked.
 *
 *   `read_text_file` read the bytes as UTF-8. A PNG is not UTF-8, so it came
 *   back as nothing useful — silently, with no error and no hint that the file
 *   was an image at all. Metidar's own words on screen: […]
 *
 *   `read_media_file` base64'd it into an MCP `{type:'image'}` block, which
 *   LOOKS right and is invisible. The platform's eye works on a completely
 *   different contract: a tool result carries `sight: {laneId, imageIds}`, and
 *   `foldSight` filters on exactly that. A content block carries no `sight`,
 *   so it was skipped and flattened into text — a wall of base64 the model
 *   cannot see and must not be charged for.
 *
 * Two systems that both mean […], built for different
 * things (sight for the image forge's own renders, media blocks for MCP), that
 * never learned about each other. That is the fragmentation, exactly.
 *
 * ── THE BRIDGE ──────────────────────────────────────────────────────────────
 *
 * This is the one place they meet. Image bytes coming back from the filesystem
 * organ are registered as EPHEMERAL sight — bounded, one-use, TTL'd, already
 * built for this (image-forge/ephemeral-sight.js) — and the result is restamped
 * so the round's normal `foldSight` picks them up. The being sees the picture
 * on its next turn through the eye that already works.
 *
 * The base64 is REMOVED from the text on the way past. It was never readable
 * by the model, and leaving it would spend the whole window on bytes nobody
 * can see.
 *
 * The lane is the BEING'S OWN, stamped here from the connection, never from
 * anything the model said — sight is lane-isolated, and a tool argument must
 * never be able to name someone else's lane.
 */

import { registerEphemeralSight } from './image-forge/ephemeral-sight.js';
import { createLogger } from './logger.js';

const log = createLogger('FsSight');

/** What the eye accepts. Narrower than the organ's media list on purpose —
 *  audio, SVG and PDFs have no vision path, and pretending otherwise would
 *  promise a look that never happens. */
export const SIGHTED_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/**
 * The image blocks in an MCP tool result, in order. Pure.
 *
 * Shape-checked rather than trusted: a block must carry a mime the eye accepts
 * and non-empty base64, or it is not something a being could look at.
 * @param {object} result
 * @returns {Array<{data: string, mimeType: string, index: number}>}
 */
export const imageBlocksIn = (result) => {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block?.type === 'image'
      && typeof block.data === 'string' && block.data.length > 0
      && SIGHTED_MIME.includes(block.mimeType))
    .map(({ block, index }) => ({ data: block.data, mimeType: block.mimeType, index }));
};

/**
 * What the being reads in place of the bytes. Pure.
 *
 * It says the picture is COMING, not that it has arrived — the images land on
 * the NEXT message (that is how the sight fold works), and a line claiming
 * "here it is" beside no image would teach the being to describe things it has
 * not seen. `sightNote` says the rest once they actually land.
 * @param {number} shown
 * @param {number} refused
 * @returns {string}
 */
export const sightPlaceholder = (shown, refused = 0) => {
  const lost = refused > 0
    ? ` ${refused} could not be carried (too large, or a format the eye does not take).`
    : '';
  if (shown === 0) {
    return `[This file is an image. It could not be placed in front of you —${lost || ' too large, or a format the eye does not take.'} You have not seen it.]`;
  }
  return `[${shown === 1 ? 'Image read' : `${shown} images read`} — placed in front of you; you will be looking at ${shown === 1 ? 'it' : 'them'} on your next turn.${lost}]`;
};

/**
 * Replace image blocks with a short line, keeping every other block. Pure.
 *
 * The base64 never reaches the model: it is unreadable to it and would spend
 * the whole context window on bytes nobody can see.
 * @param {object} result
 * @param {Set<number>} imageIndexes
 * @param {string} note
 * @returns {object}
 */
export const withoutImageBytes = (result, imageIndexes, note) => {
  const content = Array.isArray(result?.content) ? result.content : [];
  const kept = content.filter((_, i) => !imageIndexes.has(i));
  return {
    ...result,
    content: [...kept, { type: 'text', text: note }],
    // structuredContent mirrors content on this organ; a stale copy would
    // carry the very bytes we just removed.
    ...(result?.structuredContent ? { structuredContent: { content: [...kept, { type: 'text', text: note }] } } : {}),
  };
};

/**
 * Bridge a filesystem read into the being's eye. Impure (registers bytes).
 *
 * Returns the result unchanged when there is nothing to look at, so every
 * non-image read pays exactly nothing for this.
 *
 * A registration failure is NEVER fatal: the read still succeeded, and the
 * being is told plainly that it has not seen the picture rather than losing
 * the whole tool call over it.
 *
 * @param {object} result - the organ's MCP result
 * @param {string|null} laneId - the BEING'S own lane, from the connection
 * @returns {object} the result, restamped with `sight` when there is any
 */
export const withFileSight = (result, laneId) => {
  const blocks = imageBlocksIn(result);
  if (blocks.length === 0) return result;

  const indexes = new Set(blocks.map((b) => b.index));
  // No lane, no sight. The bytes still come OUT of the text — an unseeable
  // wall of base64 helps nobody, lane or not.
  if (!laneId) {
    return withoutImageBytes(result, indexes, sightPlaceholder(0, blocks.length));
  }

  let imageIds;
  try {
    imageIds = registerEphemeralSight(laneId, blocks.map((b) => ({
      mime: b.mimeType, bytes: Buffer.from(b.data, 'base64'),
    })));
  } catch (err) {
    log.warn('image could not be held for sight', { err: err.message, count: blocks.length });
    return withoutImageBytes(result, indexes, sightPlaceholder(0, blocks.length));
  }

  const refused = blocks.length - imageIds.length;
  const stamped = withoutImageBytes(result, indexes, sightPlaceholder(imageIds.length, refused));
  if (imageIds.length === 0) return stamped;
  return {
    ...stamped,
    // The shape `foldSight` reads. `store: 'ephemeral'` is what tells the eye
    // these bytes live in memory for one look rather than in the image store;
    // `purpose: 'file-read'` tells the being it READ them, never that it made them.
    sight: { laneId, imageIds: [...imageIds], store: 'ephemeral', purpose: 'file-read' },
  };
};
