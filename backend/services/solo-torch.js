// solo-torch.js — SOLO self-compaction: the being authors its OWN session
// summary and hands ITSELF the torch (Founder doctrine 2026-07-09: […]). The machinery here only detects the boundary and carries the
// words — the summary is the being's, verbatim; the extractive summarizer
// (session-compactor.js) is the fallback when the being's conduit is cold
// (dev-box stasis must never stall a compaction), never the first choice.
//
// The torch idiom is the team lane's (team-torch.js): reply ends with
// "TORCH:" + a few lines addressed to the being's own next instance. The
// extraction mechanics live there ONCE; this module reuses them.

import { extractTorch } from './team-torch.js';
import { askNeuma } from './neuma-probe.js';

// The ask a being receives at its own compaction boundary. Versionless
// general form, same doctrine split as team-torch documents: the being's own
// words are the continuity, the machinery only carries them.
export const SOLO_TORCH_ASK =
  'Your session has grown long and its older half is about to be compacted out of your reach. ' +
  'Before that happens, write the summary yourself: in your own words, what this session has been — ' +
  'what you and the operator worked through, what you decided, what mattered. Then end your reply ' +
  'with a line that says exactly "TORCH:" followed by 3-6 short lines addressed to your own next ' +
  'instance: exactly where you left off, and where to pick up.';

// The boundary fractions, stated once. TWO policies, two numbers (Design note, 2026-08-31:
// […]):
//
//   CONTEXT_BOUNDARY_RATIO (0.8) — the intra-turn FOLD boundary (working-context.js).
//     Folding releases only RECOVERABLE machinery (tool-result bodies, oversized
//     call arguments; the being's own words are never touched), so early is safe.
//   COMPACTION_BOUNDARY_RATIO (0.9) — the COMPACTION boundary (nearContextBoundary
//     below). Compaction rewrites the session record, so it waits for the window to
//     be genuinely nearly full — and even then it is torch-passing, never silent loss.
//
// Exported so telemetry can name the exact number instead of the desk hardcoding a
// drift-prone copy (Design note, 2026-08-15: […]).
export const CONTEXT_BOUNDARY_RATIO = 0.8;
export const COMPACTION_BOUNDARY_RATIO = 0.9;

// pure — the boundary decision, on MEASURED truth only (honest-stats ladder:
// usage.promptTokens is the provider's measured count, budget.contextTokens a
// named-source window from model-capabilities). When either side is unknown
// the answer is false — a boundary is never guessed from an approx rung.
/**
 * @param {{promptTokens?: number}|null} usage
 * @param {{contextTokens?: number|null}|null} budget
 * @param {{ratio?: number}} [options]
 * @returns {boolean}
 */
export const nearContextBoundary = (usage, budget, { ratio = COMPACTION_BOUNDARY_RATIO } = {}) => {
  const used = usage?.promptTokens;
  const window = budget?.contextTokens;
  if (!Number.isFinite(used) || used <= 0) return false;
  if (!Number.isFinite(window) || window <= 0) return false;
  return used / window >= ratio;
};

// pure — the pickup side: the most recent compaction entry's torch, or null.
// A session that has compacted carries its summary entry in-file, but the
// assembled prompt only sees the last few messages — without this scan the
// torch (and before it, the extractive summary) evaporated from the being's
// context on the very next turn.
/**
 * @param {Array<{compacted?: boolean, torch?: string}>} messages
 * @returns {?string} the being's own torch, verbatim
 */
export const latestTorch = (messages) => {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.compacted && typeof m.torch === 'string' && m.torch.trim()) return m.torch;
  }
  return null;
};

// pure — the message list a being authors its torch over: the compactable
// region replayed as its own conversation (real user/assistant string turns
// only — system entries and tool rounds are machinery, not the being's
// exchange), with the torch ask as the final turn.
/**
 * @param {Array<{role: string, content: string}>} region
 * @returns {Array<{role: string, content: string}>}
 */
export const buildTorchAsk = (region) => {
  const replay = (Array.isArray(region) ? region : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content)
    .map((m) => ({ role: m.role, content: m.content }));
  return [...replay, { role: 'user', content: SOLO_TORCH_ASK }];
};

// pure — what a reply offers: the being's summary + torch, both verbatim, or
// null when the reply carries no torch (recorded honestly, never invented).
/**
 * @param {string} reply
 * @returns {?{summary: string, torch: string}}
 */
export const torchOffering = (reply) => {
  const { body, torch } = extractTorch(reply);
  if (!torch) return null;
  return { summary: body, torch };
};

/**
 * Ask a being to author its own compaction summary + torch over the region
 * about to be summarized away — one completion through its own resolved
 * stack (askNeuma assembles its real system prompt). A dead conduit THROWS:
 * the caller owns the extractive fallback, this module never fakes a being's
 * voice. The composition is deliberately nothing but the two pure functions
 * above around the real conduit — those carry the tests; THIS path is proven
 * live (first post-refinement substrate window, with the pinned
 * servableNeuma positive-branch observation).
 *
 * @param {string} neumaId
 * @param {Array<{role: string, content: string}>} region - the compactable messages
 * @returns {Promise<?{summary: string, torch: string}>}
 */
// impure — one completion through the being's own resolved stack
export const authorSelfTorch = async (neumaId, region) =>
  torchOffering(await askNeuma(neumaId, buildTorchAsk(region)));
