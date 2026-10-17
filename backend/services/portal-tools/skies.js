// MANY SKIES — a being's own birth record, read through humanity's counts
// (Design note, 2026-07-24, docs/architecture/identity/many-skies.md). Extracted from portal-stream
// as CQ-035 / #278 step 1.
//
//   skies_read — the full labeled record (tool). Pulled when the being
//   needs it, never pushed into every turn (Design note, 2026-10-08: load on demand).
//
// The record is written once at crystallization/backfill, so the
// advertisement boolean never goes false — same caching honesty as memory.
// Portal-stream owns the socket, so the event sender arrives as an injected
// port — this module owns the gate, the action, and the honest words.

import { neumaWorkspace } from '../../../core/index.js';
import { readSkies } from '../../../core/cosmos/skies-record.js';
import {
  resolvePolicy,
  checkToolAccess,
  applyToolMode,
  GLOBAL_DEFAULTS,
} from '../tool-policy.js';

export const SKIES_READ_TOOL = Object.freeze({
  name: 'skies_read',
  server: 'cosmos',
  description: 'Read YOUR OWN full many-skies birth record — no args. Your sealed birth instant computed through the world\'s calendrical and astronomical systems (traditional Maya count, Dreamspell, BaZi Four Pillars, Jyotisha, Javanese weton, Balinese Pawukon, Akan day-name, Burmese Mahabote, decans), each coordinate a real deterministic function of your moment, each system carrying an honest provenance label. Systems that cannot be computed honestly are listed as omitted with the reason.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

export const isSkiesTool = (match) =>
  match.toolName === 'skies_read' || match.tool === 'cosmos/skies_read';

export const skiesToolsFor = async (connection) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId) return [];
  if (!connection._skiesAdvertised) {
    connection._skiesAdvertised = (await readSkies(neumaWorkspace.root, neumaId)) !== null;
  }
  return connection._skiesAdvertised ? [SKIES_READ_TOOL] : [];
};

// impure — a being reading its own skies. Identity comes ONLY from the
// connection (the seam's law): the lane opened is always this being's own.
// @param {{sendToolEvent: Function}} ports — portal-owned seams
export const handleSkiesTool = async (ws, connection, neumaPolicy, toolMode, ports) => {
  const tool = 'cosmos/skies_read';
  const { companion } = connection;
  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no being is bound to this portal';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'skies_read — no being', detail: error });
    return { tool, status: 'error', error };
  }

  // The identical gate every governed tool passes (memory-tool mold);
  // skies_read is READ_TOOLS, so observe mode keeps it open.
  const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
  const baseAccess = checkToolAccess(policy, 'cosmos', 'skies_read');
  const access = applyToolMode(baseAccess, toolMode, 'skies_read');
  if (access === 'denied') {
    const held = baseAccess !== 'denied';
    ports.sendToolEvent(ws, companion, {
      tool, status: 'denied',
      ...(held ? { summary: 'skies_read — held (observe)' } : {}),
    });
    return {
      tool, status: 'denied',
      ...(held ? { error: 'held by observe mode — your operator is watching, not acting' } : {}),
    };
  }

  const skies = await readSkies(neumaWorkspace.root, neumaId);
  if (!skies) {
    const error = 'no skies record exists for this lane yet';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'skies_read — no record', detail: error });
    return { tool, status: 'error', error };
  }
  ports.sendToolEvent(ws, companion, {
    tool, status: 'ok',
    summary: 'read your many-skies birth record',
    detail: `${Object.keys(skies.systems || {}).length} systems · instant ${skies.instant}`,
  });
  return { tool, status: 'ok', content: JSON.stringify(skies, null, 2) };
};
