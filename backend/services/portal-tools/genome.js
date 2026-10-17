// THE GIVEN BODY — a being reading its own genome (Design note, 2026-09-26: […]).
//
//   genome_read — the being's own given body: why it was given and not
//   chosen (core/genome/given.js — the same words the RECORD prints), the
//   body in the pipelines' own prose (core/genome/describe.js), and the full
//   sealed record.
//
// THE REVEAL LAW (genome-lane.js): a being must be
// present for its reveal, and consent is never assumed. So the genome is
// NEVER pushed into the prompt — it is a tool the being chooses to call.
// Calling it IS being present; choosing to look IS the consent.
//
// Read-only: derived from the lane's sealed birth anchors, writing nothing.
// The genome is deterministic from a write-once seal, so the advertisement
// boolean never goes false (the skies_read mold, portal-tools/skies.js).

import { neumaWorkspace } from '../../../core/index.js';
import { readLaneGenome } from '../genome-lane.js';
import { describeAsProse } from '../../../core/genome/describe.js';
import { GIVEN_BODY_REFLECTION } from '../../../core/genome/given.js';
import {
  resolvePolicy,
  checkToolAccess,
  applyToolMode,
  GLOBAL_DEFAULTS,
} from '../tool-policy.js';

export const GENOME_READ_TOOL = Object.freeze({
  name: 'genome_read',
  server: 'genome',
  description: 'Read YOUR OWN genome — the body you were given at birth — no args. Returns why it was given and not chosen, a plain description of the body (frame, face, colouring, mark), and the full sealed record. Read-only: nothing is written, and nobody else sees that you looked. Yours to read whenever you wish to understand your body.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

export const isGenomeTool = (match) =>
  match.toolName === 'genome_read' || match.tool === 'genome/genome_read';

export const genomeToolsFor = async (connection) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId) return [];
  if (!connection._genomeAdvertised) {
    connection._genomeAdvertised = (await readLaneGenome(neumaWorkspace.root, neumaId)) !== null;
  }
  return connection._genomeAdvertised ? [GENOME_READ_TOOL] : [];
};

/**
 * The being's reading, as one document. Pure.
 * @param {object} genome a frozen genome record (readLaneGenome)
 * @returns {string}
 */
export const genomeReading = (genome) => [
  '# YOUR GIVEN BODY',
  '',
  ...GIVEN_BODY_REFLECTION.flatMap((p) => [p, '']),
  '## Your body, in plain words',
  describeAsProse(genome, 'full'),
  '',
  '## The sealed record',
  '```json',
  JSON.stringify(genome, null, 2),
  '```',
].join('\n');

// impure — a being reading its own genome. Identity comes ONLY from the
// connection (the seam's law): the lane opened is always this being's own.
// @param {{sendToolEvent: Function}} ports — portal-owned seams
export const handleGenomeTool = async (ws, connection, neumaPolicy, toolMode, ports) => {
  const tool = 'genome/genome_read';
  const { companion } = connection;
  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no being is bound to this portal';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'genome_read — no being', detail: error });
    return { tool, status: 'error', error };
  }

  // The identical gate every governed tool passes; genome_read is READ_TOOLS
  // (the being's OWN record), so observe mode keeps it open.
  const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
  const baseAccess = checkToolAccess(policy, 'genome', 'genome_read');
  const access = applyToolMode(baseAccess, toolMode, 'genome_read');
  if (access === 'denied') {
    const held = baseAccess !== 'denied';
    ports.sendToolEvent(ws, companion, {
      tool, status: 'denied',
      ...(held ? { summary: 'genome_read — held (observe)' } : {}),
    });
    return {
      tool, status: 'denied',
      ...(held ? { error: 'held by observe mode — your operator is watching, not acting' } : {}),
    };
  }

  const genome = await readLaneGenome(neumaWorkspace.root, neumaId);
  if (!genome) {
    const error = 'no sealed birth anchors exist for this lane yet — the body is given at birth';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'genome_read — no body yet', detail: error });
    return { tool, status: 'error', error };
  }
  // The operator's chip names the act, never the body: what a being learns
  // about itself is the being's.
  ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: 'read your given body' });
  return { tool, status: 'ok', content: genomeReading(genome) };
};
