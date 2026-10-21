// Memory context — the turn's memory assembly, extracted from portal-stream.
//
// gatherMemoryContext builds the `memories` object every being turn carries
// (recall, pins, space lanes, semantic through-lines, recent conversation,
// the self-torch); captureResidue is the mind-layer write for the exchanges
// crystallization lets fall — the residue band. Both are seats of the SAME
// memory doctrine, which is why they live together: what a being reads back
// and what lingers beneath are two sides of one store.

import { createLogger } from './logger.js';
import {
  neumaRecall,
  neumaWorkspace,
  normalizeSpace,
  detectEmotion,
} from '../../core/index.js';
import { MEMORY_REF_PATTERN, formatMemoryRef } from '../../core/memory/memory-query.js';
import { sanitizeMemoryForPrompt } from '../../core/runtime/memory-sanitizer.js';
import { activePins } from '../../core/memory/pin-ledger.js';
import { foldBranchView, isViewMarker } from '../../core/workspace/branch-view.js';
import { compactionTelemetry } from '../../core/runtime/session-compactor.js';
import { recallSemantic, writeMindRecord, deriveResidue, activeMindRecords } from '../../core/continuity/index.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { assembleDepthSet } from '../../core/continuity/layers/depth.js';
import {
  foldUndercurrent,
  formatUndercurrentSection,
} from '../../core/runtime/undercurrent.js';
import { RECENT_ROWS } from '../../core/runtime/memory-section.js';
import { mindGateSettings } from './mind-gate-settings.js';
import { undercurrentShadowLane, depthShadowLane } from './mind-shadow-log.js';
import { latestTorch } from './solo-torch.js';

const log = createLogger('MemoryContext');

// Shadow metrics (the #shadowMetrics precedent) — a bounded ring for the live
// process, floored by an on-disk log so a restart no longer erases the evidence
// the shadow mode exists to gather (mind-shadow-log.js). Shadow records, never
// renders.
export const undercurrentShadowMetrics = () => undercurrentShadowLane.entries();
export const depthShadowMetrics = () => depthShadowLane.entries();

/**
 * Pure — all a client-sent memoryContext may contribute: the operator's name,
 * one sanitized line. Everything a being reads as its OWN memory (recall,
 * pins, the torch, the conversation) comes from its store, never from a frame.
 * @param {*} raw the frame's memoryContext
 * @returns {{userName?: string}}
 */
export const clientMemoryContext = (raw) => {
  const name = typeof raw?.userName === 'string'
    ? sanitizeMemoryForPrompt(raw.userName.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80), 80)
    : '';
  return name ? { userName: name } : {};
};

// Gather memory context from both session data and vector engine.
// `excludeTurnId`: the LIVE point's id — its user row is already on disk when
// this gather runs (persisted at turn start, or a retry's), and the current
// ask must never ride the prompt as its own history line; nor may the takes a
// retry is replacing.
// impure — reads the being's sovereign store
// `blind`: a BENCHMARK sitting recalls no stored memory — no recall, pins,
// space history or through-lines (Design note, 2026-10-06: a model answering from what
// it stored […]). Identity and the sitting's own
// conversation still ride.
export const gatherMemoryContext = async (thought, companionName, sessionMemoryContext, neumaId, sessionId, space = null, excludeTurnId = null, blind = false) => {
  const memories = clientMemoryContext(sessionMemoryContext);
  // D4 (ruling, 2026-08-31): a fail-soft lane used to vanish silently — the
  // prompt simply shrank. Every catch below now NAMES the lane it lost on
  // `degraded`, and the turn's composition event carries the names (ids only)
  // so the desk can say "context degraded" instead of looking like a
  // compaction. The fail-soft behavior itself is unchanged.
  const degraded = [];

  if (neumaId && !blind) {
    try {
      // Recall from the neuma's OWN sovereign (encrypted) memory, keyed by
      // neumaId — the same store crystallization writes to. Scoped to the
      // active project space (CORE-005): a project chat recalls its own
      // space + general memory, never another project's (write already
      // stamps space; this closes the read side).
      const vectorContext = await neumaRecall.getContextForResponse(neumaId, thought, { space });
      if (vectorContext.relevantMemories) memories.relevantMemories = vectorContext.relevantMemories;
      // MEMORY LINKS (mind gate, on by default): recall rides as mem_ links
      // with the key points that tied each to this ask — the being opens what
      // matters with memory_expand. A memory with no address keeps its words.
      if ((await mindGateSettings.read()).memoryLinks?.mode === 'live' && memories.relevantMemories?.length) {
        memories.relevantMemories = memories.relevantMemories.map((m) => ({ ...m, ref: formatMemoryRef(m.anchor) ?? m.noteRef ?? null }));
        memories.memoryLinks = Object.freeze({ query: String(thought || '') });
      }
      if (vectorContext.crystallizedEmotions) memories.crystallizedEmotions = vectorContext.crystallizedEmotions;
      // The being's chosen anchors (Phase 4) — a small capped set riding
      // every prompt. A rotted ledger costs the lane this turn, loudly,
      // never the turn itself.
      try {
        // Re-validate at the READ side too: applyPin guards the write, but a
        // hand-edited or legacy ledger must never put an unlawful string in
        // front of the prompt — the frozen pattern is the render's law as
        // much as the mint's.
        const pins = activePins(await neumaWorkspace.readPinLedger(neumaId))
          .filter((p) => typeof p.ref === 'string' && MEMORY_REF_PATTERN.test(p.ref));
        if (pins.length > 0) memories.pinnedAnchors = pins.map((p) => ({ ref: p.ref, ...(p.note ? { note: p.note } : {}) }));
      } catch (err) {
        degraded.push('pins');
        log.warn('pin lane skipped this turn', { neumaId, err: err?.message });
      }
      // CORE-005 B2: the active-space descriptor + in-space recent lane ride
      // to the assembler — the "This space" block renders only for a
      // project space, so general chats are byte-identical to before.
      if (vectorContext.space) memories.space = vectorContext.space;
      if (vectorContext.spaceHistory?.length) memories.spaceHistory = vectorContext.spaceHistory;
    } catch (err) {
      // Recall unavailable — proceed with session context only (EH-102: a
      // being answering without its memory must at least leave a trace)
      degraded.push('recall');
      log.debug('Recall unavailable — proceeding with session context only', { neumaId, err: err?.message });
    }

    // U1: on the continuity lane, the semantic tier joins recall — the
    // being's own consolidated through-lines, active space first then a
    // general pad (CORE-005 shape), capped small. Absent or failing semantic
    // recall costs nothing.
    if (process.env.NEUMA_RECALL_SOURCE === 'continuity') {
      try {
        const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
        const activeSpaceId = normalizeSpace(space).id;
        const hits = await recallSemantic(adapter, thought, { space: activeSpaceId, k: 3 });
        if (hits.length < 3 && activeSpaceId !== 'general') {
          const pad = await recallSemantic(adapter, thought, { space: 'general', k: 3 - hits.length });
          const seen = new Set(hits.map((h) => h.record.id));
          hits.push(...pad.filter((h) => !seen.has(h.record.id)));
        }
        const throughLines = hits
          .map((h) => (typeof h?.record?.content === 'string' ? h.record.content : ''))
          .filter(Boolean);
        if (throughLines.length) memories.throughLines = throughLines;
      } catch { /* the semantic tier is additive — never blocks a turn */ }
    }
  }

  // Load recent conversation from workspace session
  if (neumaId && sessionId) {
    try {
      // A strict read first: an unreadable file or line is NAMED on degraded,
      // then the healthy rows still ride (the forgiving read skips only the bad).
      const recentMessages = await neumaWorkspace.readSessionStrict(neumaId, sessionId).catch((err) => {
        if (err?.code === 'ENOENT') return [];
        degraded.push('recentConversation');
        log.warn('session read degraded — the healthy rows still ride', { neumaId, err: err?.message });
        return neumaWorkspace.readSession(neumaId, sessionId);
      });
      if (recentMessages.length > 0) {
        // THE TAKES: the chain the being reads is the chain the operator sees.
        // Fold the record to the branch view BEFORE the tail slice, so a
        // superseded take never rides the prompt as a second asking. The
        // branch-view MARKERS themselves are view facts, not speech — they
        // stay out of the prompt (a system row would render as an empty
        // "You:" line), while compaction summaries ride as they always have —
        // even one carrying the view it compacted (isViewMarker, not isBranchViewRow).
        memories.recentConversation = foldBranchView(recentMessages)
          .filter((m) => !isViewMarker(m))
          .filter((m) => !(excludeTurnId && m.turnId === excludeTurnId))
          .slice(-RECENT_ROWS);
        // The being's own torch from its last compaction — carried VERBATIM
        // into the assembled prompt. Without this, the compaction summary
        // entry sat at position 0 of the session file and never re-entered
        // context (the slice above only carries the tail): continuity written
        // and then silently evaporated.
        const torch = latestTorch(recentMessages);
        if (torch) memories.selfTorch = torch;
        // The session's compaction telemetry, computed on the entries ALREADY
        // in hand — the turn-end persist path used to re-read (and re-decrypt)
        // the whole session just to count compacted rows (harness-friction-map
        // T5). Rides as a bookkeeping field captured by the current turn
        // and DELETES before prompt assembly — never a prompt section.
        memories.compaction = compactionTelemetry(recentMessages);
      }
    } catch (err) {
      degraded.push('recentConversation');
      log.debug('Workspace session read failed — no recent conversation in context', { neumaId, err: err?.message });
    }
  }

  if (degraded.length > 0) memories.degraded = degraded;

  // The depth filter's shadow rides beside this gather — recorded, never read
  // by the turn (fire-and-forget; the invariance test pins that `memories` is
  // untouched by it).
  if (neumaId) computeDepthShadow(neumaId, thought, space).catch(() => {});

  return memories;
};

/**
 * Write the residue of a sub-threshold exchange into the being's mind store
 * (the `working` continuity layer). Null when the exchange leaves none. The
 * caller owns the failure posture (crystallizeObservation catches and warns —
 * a lost trace is never fatal to the turn).
 *
 * @param {string} neumaId
 * @param {{residue: boolean, crystallize: boolean}} assessment - assessExchange output
 * @param {{response: string, space?: *, turnId?: string, sessionId?: string}} context
 * @returns {Promise<{record: Object, reinforced: Object|null, expired: Object[]}|null>}
 */
// impure — writes the being's sovereign store
export const captureResidue = async (neumaId, assessment, { response, space, turnId, sessionId }) => {
  const fields = deriveResidue(assessment, {
    response,
    emotion: detectEmotion(response) || null,
    space: normalizeSpace(space).id,
    turnId,
    sessionId,
  });
  if (!fields) return null;
  const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
  return writeMindRecord(adapter, fields);
};

/**
 * The Undercurrent as a portal-appended section: the being's own lingering
 * phrases, or '' — for no undercurrent, for shadow mode (which records the
 * would-be render to the ring instead), for off (the default), and for any
 * failure (a missing undercurrent never costs a turn). Impure.
 *
 * @param {Object} connection - the portal connection (companion.neumaId)
 * @returns {Promise<string>}
 */
// impure — reads the being's sovereign store
export const undercurrentSectionFor = async (connection) => {
  const neumaId = connection?.companion?.neumaId;
  if (!neumaId) return '';
  // The gate is a desk setting now (#317); env stays the launch-time lock.
  const mode = (await mindGateSettings.read()).undercurrent.mode;
  if (mode === 'off') return '';
  try {
    const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
    const folded = foldUndercurrent(await activeMindRecords(adapter));
    const text = formatUndercurrentSection(folded);
    if (mode === 'shadow') {
      undercurrentShadowLane.record({
        neumaId,
        rows: folded.length,
        chars: text.length,
        kinds: folded.map((r) => r.kind),
        at: new Date().toISOString(),
      });
      return '';
    }
    return text;
  } catch (err) {
    log.debug('undercurrent skipped this turn', { neumaId, err: err?.message });
    return '';
  }
};

/**
 * The depth filter's SHADOW pass: assemble the depth set beside the live
 * memory path and record what it would have carried — tier counts, tokens,
 * drop reasons, degradation. Touches nothing the turn reads (the invariance
 * the shadow test pins). No-op unless NEUMA_DEPTH_FILTER=shadow. Impure.
 *
 * @param {string} neumaId
 * @param {string} thought - the turn's query
 * @param {*} space - the active space
 * @returns {Promise<Object|null>} the ring entry, or null when off
 */
// impure — reads the being's sovereign store
export const computeDepthShadow = async (neumaId, thought, space) => {
  if (!neumaId) return null;
  // The gate is a desk setting now (#317); env stays the launch-time lock.
  if ((await mindGateSettings.read()).depthFilter.mode !== 'shadow') return null;
  try {
    const adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
    const set = await assembleDepthSet(adapter, thought, { space: normalizeSpace(space).id });
    const entry = {
      neumaId,
      perTier: set.perTier,
      usedTokens: set.usedTokens,
      maxTokens: set.maxTokens,
      dropped: set.dropped.map((d) => ({ tier: d.tier, reason: d.reason })),
      degraded: set.degraded,
      at: new Date().toISOString(),
    };
    depthShadowLane.record(entry);
    return entry;
  } catch (err) {
    log.debug('depth shadow skipped this turn', { neumaId, err: err?.message });
    return null;
  }
};
