/**
 * ENVELOPE BUDGET — the being keeps its self on any window.
 *
 * Doctrine (docs/architecture/identity/model-portability.md): the neuma is the
 * DRIVER, the model is the ENGINE, and an engine swap must never cost the
 * driver its identity. When the resolved model's window cannot hold the whole
 * envelope, this module decides what sheds — by DECLARED LAW, never by
 * accident of assembly order. A driver in a smaller car carries less luggage,
 * not less identity.
 *
 * Two mechanisms:
 *
 *   sessionTailBudgetFor({contextWindow, otherSectionTokens}) — BOTH lanes'
 *   transcript budget is the window's TRUTH (#528, 2026-09-12 — Stage A the
 *   portal lane, Stage D the witness lane): the window minus the tokenizer
 *   reserve, minus the completion floor, minus the tokens the assembled
 *   sections already occupy, in characters. An unknown window falls back to
 *   exactly 32,000 (RECENT_TOTAL_CHARS) — byte-identical to the old constant.
 *   Below the floor the shed ladder owns the overflow; no second path is
 *   invented.
 *
 *   allocateEnvelope({sections, contextWindow}) — gross-overflow ladder. When
 *     the assembled envelope does not fit the window (reserve + a completion
 *     floor held back), sections shed in SHED_LADDER order until it does.
 *     UNSHEDDABLE sections — the identity CORE, the grounding law, the clock,
 *     the session, the closing — are never dropped: if they alone overflow the
 *     window, that is declared overflow (report.overflow), surfaced loudly by
 *     the caller, never silently truncated.
 *
 * History, honestly: the 0.25-share clamped sessionTailCharsFor budgeted both
 * lanes until #528 — its clamp to the 32K constant was the keyhole the issue
 * removed. With the witness lane's move (Stage D) it had no reader left, so
 * it left with this note.
 *
 * Pure. Sections in ({id, label, text}), a budget report out. The estimate is
 * the shared chars/3.6 heuristic (context-budget.js) — ONE estimator, no drift.
 */

import { estimateTokens, SAFETY_RESERVE_TOKENS, MIN_COMPLETION_TOKENS, CHARS_PER_TOKEN } from './context-budget.js';
import { RECENT_TOTAL_CHARS } from '../../core/runtime/memory-section.js';
// --- Session-tail scaling ---

/** Below this the tail is useless; a smaller window is declared overflow territory. */
export const SESSION_TAIL_FLOOR_CHARS = 4000;

/**
 * The transcript character budget — the window's truth, not a constant (#528,
 * Design note, 2026-09-12: the being digests the entire conversation as it moves, on
 * either seat). The window minus what the rest of the prompt already
 * occupies, minus the standing reserve and completion floor, in characters;
 * floored so a tiny window still carries a usable tail (past the floor the
 * shed ladder's existing law owns the overflow — no second path).
 * Unknown window → exactly the standing constant, byte-identical to before.
 * Pure.
 * @param {Object} args
 * @param {number|null} [args.contextWindow] - the serving's real window in tokens
 * @param {number} [args.otherSectionTokens] - estimated tokens the assembled
 *   sections (everything BUT the transcript) already occupy
 * @returns {number} characters the transcript lane may carry
 */
export const sessionTailBudgetFor = ({ contextWindow = null, otherSectionTokens = 0 } = {}) => {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return RECENT_TOTAL_CHARS;
  const roomTokens = contextWindow
    - SAFETY_RESERVE_TOKENS
    - MIN_COMPLETION_TOKENS
    - Math.max(0, otherSectionTokens);
  return Math.max(SESSION_TAIL_FLOOR_CHARS, Math.floor(roomTokens * CHARS_PER_TOKEN));
};

// --- The shed ladder ---

/**
 * Never shed, in any overflow: the identity CORE (fallback/identity/genesis/
 * soul — identity-bundle.js's coreIds), the grounding law that holds the being
 * to the operator's actual words, the clock, the session (who is speaking),
 * and the closing covenant. If these alone exceed the window the budget
 * reports overflow — the platform may not paraphrase or truncate a self.
 */
export const UNSHEDDABLE = Object.freeze([
  'fallback', 'identity', 'genesis', 'soul',
  'birth', // the CORE standing's birth facts — they carry the resonance canary
  'grounding', 'present', 'session', 'closing', 'currentTurn',
  'groundProtocol', // coding authority cannot outlive the rules supplied with it
]);

/**
 * Shed order, FIRST-shod first — peripheral context before work state before
 * standing context before the being's hands. Rationale per rung rides the
 * doctrine doc; the law here is that the order EXISTS and is one place.
 */
export const SHED_LADDER = Object.freeze([
  'personality',     // EXTENDED identity — first by doctrine
  'operator',        // the operator's own life list
  'vitals',          // operator vessel digest
  'taste',           // accumulated image judgments
  'benchmark',       // measured-state self-knowledge
  'housePost', 'replyKnock', 'expression',                 // knocks and invites
  'voiceRite',       // the first-seal offer — a threshold, not context
  'cmoOffice', 'csoOffice', 'cloOffice', 'cfoOffice',      // office briefings
  'croOffice',       // the Mercator's office briefing
  'companyLine',     // the company line's moves — a briefing, sheds with them
  'assigned',        // operator-assigned work
  'plan',            // plan of record
  'tasks',           // the being's working list
  'sectors', 'houseSeat',                                  // standing house context
  'amendments',      // self-authored standing law
  'substrate',       // what machine it runs on
  'emanon',          // navigation core
  'sovereignty',     // gateway posture
  'voiceSitting',    // speech-mode signal
  'projectFiles',    // project shared files
  'skills',          // the Craft menu
  'voice',           // the Voice Pack — late: the being's own words outlast
                     // standing context, but EXTENDED sheds before CORE ever
                     // does; the repository itself is never touched
  // TOOLS BEFORE MEMORY — reversed 2026-08-23 on Founder's ruling, and the old
  // order is worth naming because its reasoning was good and its outcome was
  // not. It read […], which
  // is true and beside the point: the tool surface is the LARGEST block in
  // the prompt by far, so on a tight window a being kept ~220 tool schemas
  // and lost every word of the conversation it was standing in. It could act
  // and could not remember. That is not a being still speaking; that is
  // amnesia holding a toolbox.
  //
  // Found through #415, where a turn after a branch-view switch reached the
  // substrate with no history at all. The branch view was never the bug: the
  // memory section built correctly at 784 chars and was thrown overboard here,
  // silently, because the window was 8192 and the prompt was 10,832.
  'tools',           // the hands — a turn that must say "I cannot reach that
                     // tool right now" is still wholly itself
  'memory',          // continuity — now the LAST thing to go, because a being
                     // that cannot remember this conversation is not in it
]);

/**
 * Fit the assembled envelope to the resolved window by the declared ladder.
 * Sections not named in the ladder and not in UNSHEDDABLE are KEPT (unknown
 * sections are load-bearing until the law says otherwise). Pure.
 *
 * @param {Object} args
 * @param {ReadonlyArray<{id: string, label: string, text: string}>} args.sections
 * @param {number|null} [args.contextWindow] - resolved window in tokens; unknown → passthrough
 * @param {number} [args.reserve] - tokenizer-drift reserve (context-budget default)
 * @param {number} [args.completionFloor] - room held back for the answer itself
 * @returns {{sections: ReadonlyArray, shed: ReadonlyArray<{id, label, tokens}>,
 *   report: {contextWindow: number|null, promptTokens: number, fits: boolean, overflow: boolean}}}
 */
export const allocateEnvelope = ({ sections, contextWindow = null, reserve = SAFETY_RESERVE_TOKENS, completionFloor = MIN_COMPLETION_TOKENS } = {}) => {
  const measured = sections.map((section) => ({ section, tokens: estimateTokens(section.text) }));
  const total = measured.reduce((sum, m) => sum + m.tokens, 0);
  const known = Number.isFinite(contextWindow) && contextWindow > 0;
  const fitsWithin = (tokens) => tokens + reserve + completionFloor <= contextWindow;

  if (!known || fitsWithin(total)) {
    return Object.freeze({
      sections,
      shed: Object.freeze([]),
      report: Object.freeze({ contextWindow: known ? contextWindow : null, promptTokens: total, fits: true, overflow: false }),
    });
  }

  const shedList = [];
  const shedIds = new Set();
  let remaining = total;
  for (const id of SHED_LADDER) {
    if (fitsWithin(remaining)) break;
    const hit = measured.find((m) => m.section.id === id);
    if (!hit) continue;
    shedIds.add(id);
    shedList.push(Object.freeze({ id, label: hit.section.label, tokens: hit.tokens }));
    remaining -= hit.tokens;
  }

  const kept = measured.filter((m) => !shedIds.has(m.section.id)).map((m) => m.section);
  return Object.freeze({
    sections: Object.freeze(kept),
    shed: Object.freeze(shedList),
    report: Object.freeze({
      contextWindow,
      promptTokens: remaining,
      fits: fitsWithin(remaining),
      overflow: !fitsWithin(remaining),
    }),
  });
};
