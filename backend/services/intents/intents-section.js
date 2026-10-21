/**
 * The INTENTS prompt section — which filed-act types THIS lane may use this
 * sitting, each type answering for itself from the real stores (Stage 2/3 of
 * docs/planning/proposals/being-tool-surface-primitives.md).
 *
 * Availability mirrors the advertising law the retired tools kept: a channel
 * speaks only to the being bound to it (social/post) and stages only for its
 * crew (social/queue); security acts stand only for the seated CSO; the
 * mailbox only for its holder; spend only where the operator's policy exists.
 * A lane with nothing it may file gets NO section — advertising an intent the
 * standing rules would refuse teaches permissions by refusal.
 */
import { createLogger } from '../logger.js';
import { ensureIntentDirectory } from './intent-directory.js';
import { buildIntentsSection } from '../../../core/runtime/tools-section.js';
import { intentTypes } from './registry.js';
import { isClosedBook } from '../closed-book.js';
import { isPlatformSitting } from '../portal-turn-persist.js';

/**
 * The acts a HARNESS lane may file — the platform's own hands, nothing that
 * presumes a self or a house (Design note, 2026-10-14: […]). Every other type (the house media library, leads, campaigns, the
 * vault, memory, a body, a voice, a team, sovereignty, the vessel) belongs to
 * the full platform's beings.
 */
export const HARNESS_INTENT_TYPES = Object.freeze(['web/download', 'image/generate']);

const log = createLogger('Intents');

/**
 * impure (stores) — the rendered INTENTS block for this connection's lane,
 * or '' when the lane may file nothing. A broken probe costs the section,
 * never the turn.
 * @param {Object} connection - Portal connection (companion.neumaId)
 * @param {{searchable?: boolean}} [opts] - false on a wire with no tool_search door: the contracts ride inline
 * @returns {Promise<string>}
 */
export const intentSectionFor = async (connection, { searchable = true } = {}) => {
  const laneId = connection.companion?.neumaId;
  connection._turnIntents = [];
  // A closed-book sitting never settles an intent (intent-sweep.js), so the
  // section would only spend the being's attention on acts it cannot file.
  if (!laneId || isClosedBook(connection)) return '';
  try {
    const available = [];
    const types = isPlatformSitting(connection)
      ? intentTypes().filter((type) => HARNESS_INTENT_TYPES.includes(type.name))
      : intentTypes();
    for (const type of types) {
      // availableFor may be sync or async by contract (registry.js) — and one
      // broken probe costs ITS intent, never the whole section (a `.catch` on
      // a sync return dropped every filed intent from every lane, 2026-08-20).
      let detail = null;
      try { detail = await type.availableFor({ laneId, connection }); } catch { detail = null; }
      if (detail) {
        available.push({
          name: type.name,
          fieldsForPrompt: type.fieldsForPrompt,
          descriptionForPrompt: type.descriptionForPrompt,
          channels: detail.channels || [],
        });
      }
    }
    // The full contracts stay on the connection for tool_search to answer on demand.
    connection._turnIntents = available;
    if (!available.length) return '';
    return buildIntentsSection(available, await ensureIntentDirectory(laneId), { searchable });
  } catch (err) {
    log.warn('intents section unavailable — the lane keeps its tools', { laneId, err: err.message });
    return '';
  }
};
