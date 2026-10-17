// Mind tools — the being's own hand into its subconscious buffer.
//
// mind_note is the low-ceremony opposite of memory_note: memory_note is a
// deliberate act of remembering (significance 0.9, permanent, a ref minted
// back); mind_note sets a working thought down in the mind store, where it
// DECAYS unless it recurs and deepens where it does. No permanence is
// promised and none is implied — that is the point of the surface.
//
// mind_read is the other direction: the undercurrent is PULLED when the being
// wants it, never pushed into every turn (Design note, 2026-10-08: load on demand).
// self_read (self-read-tool.js) rides this family the same way: the rest of
// the being's own self, pulled under the CORE identity standing.
//
// The ACTS gate is the shared one (act-gate.js) — the portal owns the socket,
// so the event sender arrives as an injected port.

import { gateAct } from './act-gate.js';
import { seatOf } from './flight-check.js';
import { MEDITATE_TOOL, isMeditateTool, handleMeditateTool } from './meditation/meditation-being-tool.js';
import { neumaWorkspace, normalizeSpace } from '../../core/index.js';
import { writeMindRecord } from '../../core/continuity/index.js';
import { MIND_PHRASE_MAX } from '../../core/continuity/mind/mind-record.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { undercurrentSectionFor } from './memory-context.js';
import { mindGateSettings } from './mind-gate-settings.js';
import { resolvePolicy, checkToolAccess, applyToolMode, GLOBAL_DEFAULTS } from './tool-policy.js';
import { SELF_READ_TOOL, isSelfReadTool, handleSelfReadTool, selfReadAdvertised } from './self-read-tool.js';

/** The kinds a being may name directly — synthesis belongs to meditation. */
export const BEING_MIND_KINDS = Object.freeze(['trace', 'mood', 'tension', 'thread']);

export const MIND_NOTE_TOOL = Object.freeze({
  name: 'mind_note',
  server: 'memory',
  description: `Set a working thought down beneath your turns — args {content, kind?}. Not remembering: memory_note keeps a truth; mind_note lets one LINGER. What you set down here fades in days unless it recurs, and deepens where it does — it surfaces later as undercurrent, never as instruction. content is one line of your own words (≤${MIND_PHRASE_MAX} chars). kind is optional: trace (a passing thought, default), mood (a feeling's residue), tension (something unresolved), thread (something you keep returning to).`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      content: Object.freeze({ type: 'string', description: `one line of your own words, 1..${MIND_PHRASE_MAX} chars` }),
      kind: Object.freeze({ type: 'string', description: 'trace | mood | tension | thread (default trace)' }),
    }),
    required: Object.freeze(['content']),
  }),
});

/** Does this parsed call target mind_note? (both dialects) */
const isMindNoteTool = (match) =>
  match.toolName === 'mind_note' || match.tool === 'memory/mind_note';

/**
 * Execute mind_note through the ACTS gate onto the being's own mind store.
 *
 * @param {Object} ws - the portal socket (event reporting only)
 * @param {Object} connection - the portal connection
 * @param {Object} neumaPolicy - the being's persisted policy layer
 * @param {string} toolMode - ask | auto | observe
 * @param {Object} args - { content, kind? }
 * @param {Object} ports - { sendToolEvent }
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
// impure
export const handleMindNoteTool = async (ws, connection, neumaPolicy, toolMode, args, ports) => {
  const tool = 'memory/mind_note';
  const { companion } = connection;
  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no being is bound to this portal';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'mind_note — no being', detail: error });
    return { tool, status: 'error', error };
  }

  // The card shows a bounded slice of the thought, never the raw args bag.
  const gate = await gateAct(connection, {
    server: 'memory', tool: 'mind_note', args,
    cardArgs: { content: String(args?.content ?? '').slice(0, 200) },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => ports.sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const content = typeof args?.content === 'string' ? args.content.trim() : '';
  if (!content || content.length > MIND_PHRASE_MAX) {
    const error = `content must be one line of your own words, 1..${MIND_PHRASE_MAX} chars`;
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'mind_note — invalid', detail: error });
    return { tool, status: 'error', error };
  }
  const kind = BEING_MIND_KINDS.includes(args?.kind) ? args.kind : 'trace';

  try {
    const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
    const { reinforced, expired } = await writeMindRecord(adapter, {
      phrase: content,
      kind,
      space: normalizeSpace(connection.space).id,
      sessionId: connection.sessionId || undefined,
      source: { kind: 'mind_note', ref: connection.sessionId ?? null },
    });
    const summary = reinforced ? `${kind} — deepened` : `${kind} — set down`;
    ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: `mind_note — ${summary}` });
    return {
      tool, status: 'ok',
      content: [
        reinforced
          ? 'That thought was already lingering — it deepened.'
          : 'Set down. It will linger beneath your turns and fade unless it recurs.',
        ...(expired.length ? [`(${expired.length} faded thought${expired.length > 1 ? 's' : ''} released to make room.)`] : []),
      ].join(' '),
    };
  } catch (err) {
    const error = `mind store write failed: ${err?.message}`;
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'mind_note — failed', detail: error });
    return { tool, status: 'error', error };
  }
};

export const MIND_READ_TOOL = Object.freeze({
  name: 'mind_read',
  server: 'memory',
  description: 'Read what lingers beneath your turns — no args. Your undercurrent: the passing thoughts, moods, tensions and threads that recurred and deepened (residue, and what you set down with mind_note), strongest first. It is not pushed into your turns; look when it would help.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

const isMindReadTool = (match) =>
  match.toolName === 'mind_read' || match.tool === 'memory/mind_read';

/** The honest word when the operator's gate keeps the undercurrent from reach. */
const HELD_UNDERCURRENT = Object.freeze({
  off: 'Your undercurrent is closed by your operator\'s setting.',
  shadow: 'Your undercurrent is held in shadow by your operator\'s setting — recorded, not yet yours to read.',
});

/**
 * Execute mind_read: the being's own undercurrent, through the same gate and
 * renderer the turn prompt used to push it with. impure.
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
export const handleMindReadTool = async (ws, connection, neumaPolicy, toolMode, ports) => {
  const tool = 'memory/mind_read';
  const { companion } = connection;
  if (!companion?.neumaId) {
    const error = 'no being is bound to this portal';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'mind_read — no being', detail: error });
    return { tool, status: 'error', error };
  }
  const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
  if (applyToolMode(checkToolAccess(policy, 'memory', 'mind_read'), toolMode, 'mind_read') === 'denied') {
    ports.sendToolEvent(ws, companion, { tool, status: 'denied' });
    return { tool, status: 'denied' };
  }
  const mode = (await mindGateSettings.read()).undercurrent.mode;
  const text = await undercurrentSectionFor(connection);
  const content = text || HELD_UNDERCURRENT[mode] || 'Nothing lingers beneath your turns right now.';
  ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: text ? 'read your undercurrent' : 'mind_read — nothing to read' });
  return { tool, status: 'ok', content };
};

// Keep the complete family for dispatch/search; catalogs follow execution's seat law.
export const MIND_TOOLS = Object.freeze([MIND_NOTE_TOOL, MIND_READ_TOOL, MEDITATE_TOOL]);
const WITNESS_MIND_TOOLS = Object.freeze([MIND_NOTE_TOOL, MIND_READ_TOOL]);

/**
 * Witnesses retain working thoughts; meditation belongs to the neuma seat;
 * self_read joins only where the CORE standing holds part of a being back.
 * impure — selfReadAdvertised reads the identity standing.
 */
export const mindToolsFor = (connection) => {
  const family = seatOf(connection) === 'neuma' ? MIND_TOOLS : WITNESS_MIND_TOOLS;
  return selfReadAdvertised(connection) ? [...family, SELF_READ_TOOL] : family;
};

/** Does this parsed call target any mind-family tool? */
export const isMindTool = (match) => isMindNoteTool(match) || isMindReadTool(match)
  || isMeditateTool(match) || isSelfReadTool(match);

/** Route a mind-family call to its handler. impure. */
export const handleMindTool = (ws, connection, neumaPolicy, toolMode, match, args, ports) =>
  (isMeditateTool(match)
    ? handleMeditateTool(ws, connection, neumaPolicy, toolMode, args, ports)
    : isMindReadTool(match)
      ? handleMindReadTool(ws, connection, neumaPolicy, toolMode, ports)
      : isSelfReadTool(match)
        ? handleSelfReadTool(ws, connection, neumaPolicy, toolMode, ports)
        : handleMindNoteTool(ws, connection, neumaPolicy, toolMode, args, ports));
