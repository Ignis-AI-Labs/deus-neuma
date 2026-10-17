/**
 * media/keep — keep an image the OPERATOR shared in this chat as a real file
 * in the house media library, so it can ride a post.
 *
 * A shared image reaches the being as sight only: its bytes live inside the
 * sealed session record, never as a file. A being asked to post one had no
 * path to name on `media`, and searched the disk for it round after round —
 * […]
 * (live 2026-09-25). This act is that path: the image comes from the chat's
 * own record, lands through the library's door (real JPEG/PNG/GIF/WEBP,
 * size-capped, 0600, provenance kept), and the path comes back.
 *
 * Curation holds: nothing is saved until the being keeps it. No egress — the
 * bytes never leave the machine, and posting it is still its own act.
 */
import { neumaWorkspace } from '../../../core/index.js';
import { foldBranchView, isBranchViewRow } from '../../../core/workspace/branch-view.js';
import { mediaLibrary } from '../media-library.js';
import { createLogger } from '../logger.js';

const log = createLogger('MediaKeepIntent');
const RECENT_ROWS = 10;

/**
 * Pure — the latest operator-shared image batch in a chat's records, as the
 * recent-image replay reads it (the same ten visible rows, never a superseded
 * take). Each entry is base64 or a data URI.
 * @param {Array<Object>} records
 * @returns {string[]}
 */
export const latestSharedImages = (records) => {
  const recent = foldBranchView(records || []).filter((row) => !isBranchViewRow(row)).slice(-RECENT_ROWS);
  const row = recent.findLast((entry) => entry.role === 'user' && Array.isArray(entry.images) && entry.images.length);
  return row ? [...row.images] : [];
};

/** Pure — base64 or data-URI → bytes. */
const bytesOf = (image) => Buffer.from(String(image).replace(/^data:[^,]*,/, ''), 'base64');

export const mediaKeepIntent = Object.freeze({
  name: 'media/keep',
  policyTool: 'media.keep',
  fieldsForPrompt: '{image?, alt}',
  descriptionForPrompt: 'Keep an image your operator SHARED in this chat as a file in the house media library, so a post can carry it. image is its place in the latest shared batch (1 = first, the default). Returns the path to name on `media`. alt is how part of the audience will read it — write it now.',
  availableFor: async ({ laneId }) => (laneId ? {} : null),
  validate: async (payload, { connection }) => {
    if (!connection.companion?.neumaId || !connection.sessionId) {
      return { ok: false, status: 'denied', reason: 'no chat on this connection — only an image shared in a chat can be kept' };
    }
    const image = payload?.image === undefined ? 1 : Number(payload.image);
    if (!Number.isInteger(image) || image < 1) {
      return { ok: false, status: 'invalid', reason: 'media/keep {image} is the image\'s place in the shared batch — 1 for the first' };
    }
    return { ok: true, value: { image, alt: payload?.alt } };
  },
  summarize: (payload) => `keep shared image ${payload?.image ?? 1} in the house media library`,
  // impure — reads this chat's record, writes one library entry.
  execute: async ({ image, alt }, { connection }) => {
    const { neumaId } = connection.companion;
    const shared = latestSharedImages(await neumaWorkspace.readSession(neumaId, connection.sessionId));
    if (shared.length === 0) {
      return { ok: false, reason: 'no image has been shared in this chat recently — ask your operator to paste it again' };
    }
    if (image > shared.length) {
      return { ok: false, reason: `the latest shared batch holds ${shared.length} image${shared.length === 1 ? '' : 's'} — there is no image ${image}` };
    }
    const saved = await mediaLibrary.save({
      bytes: bytesOf(shared[image - 1]),
      sourceUrl: `shared by the operator in chat ${connection.sessionId}`,
      alt,
      savedBy: connection.companion?.name || '',
    });
    if (!saved.ok) return { ok: false, reason: saved.detail };
    const abs = await mediaLibrary.pathFor(saved.entry.id);
    await neumaWorkspace.addJournalEntry(neumaId, {
      type: 'tool_call',
      content: `media/keep — ok: ${saved.entry.file} ← shared image ${image}`,
      significance: 0.3,
      metadata: { server: 'media', tool: 'media/keep', status: 'ok' },
    }).catch((err) => log.error('Media keep journal failed', { neumaId, error: err.message }));
    return {
      ok: true,
      detail: `Kept in the media library: ${saved.entry.file} (${saved.entry.contentType}, ${(saved.entry.bytes / 1024).toFixed(0)}KB)\npath: ${abs}\nAttach it to a post or reply by naming that path on \`media\`.`,
    };
  },
});
