/** Recent attachment continuity, bounded to one batch within the last ten visible records. */
import workspace from '../../core/workspace/neuma-workspace.js';
import { foldBranchView, isBranchViewRow } from '../../core/workspace/branch-view.js';
import { MAX_IMAGES_PER_MESSAGE } from './attachment-store.js';
import { composeVisionTurn } from './portal-turn-input.js';
import { createLogger } from './logger.js';

const log = createLogger('RecentImages');

/** Pure — preserve the latest recent image batch, never mix batches or replay superseded takes. */
export const recentImageMessages = (records, canSee) => {
  const recent = foldBranchView(records).filter((row) => !isBranchViewRow(row)).slice(-10);
  const row = recent.findLast((entry) => entry.role === 'user' && Array.isArray(entry.images) && entry.images.length);
  if (!row) return [];
  if (!canSee) return [{ role: 'user', content: '[Earlier images are recorded in this chat, but the current substrate cannot see them.]' }];
  if (row.images.length > MAX_IMAGES_PER_MESSAGE) {
    return [{ role: 'user', content: '[The earlier image batch exceeds the attachment limit and was not replayed. Ask the operator to share the relevant images again.]' }];
  }
  return [{ role: 'user', content: composeVisionTurn('Images shared earlier in this conversation, in their original order. Use these for follow-up questions; they are not new attachments.', row.images) }];
};

/** impure — read only this lane/session; new attachments supersede automatic recent-image replay. */
export const loadRecentImageMessages = async (laneId, sessionId, images, canSee) => {
  if (images.length || !laneId || !sessionId) return [];
  try { return recentImageMessages(await workspace.readSession(laneId, sessionId), canSee); }
  catch (error) {
    log.warn('Earlier images could not be loaded', { error: error.message });
    return [{ role: 'user', content: '[Earlier image attachments could not be loaded for this turn. Do not assume they are visible.]' }];
  }
};
