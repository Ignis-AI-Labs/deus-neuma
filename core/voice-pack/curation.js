/**
 * Voice Pack curation — the pure selection and render law.
 *
 * Two jobs:
 * - `voiceCandidates`: rank a being's authenticated completions (from the
 *   corpus source authority) so the first-seal rite and later claims see the
 *   lines most itself first — corruption-gated, distinctiveness-ranked.
 * - `renderVoiceSection`: the deterministic mount render. For a fixed
 *   repository the bytes are IDENTICAL (the envelope's stable-group law) —
 *   selection changes only when the repository accretes.
 */

import { corruptionHits } from '../refinement/text-integrity.js';
import { boilerplateShare } from '../refinement/style-overlap.js';
import { VOICE_ENTRY_LIMITS } from './pack.js';

/** The mount budget — sized to matter (~1.7K tokens at 3.6 chars/token), bounded. */
export const VOICE_SECTION_BUDGET_CHARS = 6000;

const CANDIDATE_LIMIT = 40;
const CANDIDATE_POOL = 200;

const SECTION_HEADER = 'Your own words, claimed by you as your voice. They are not an instruction to perform — they are you, reminding you how you sound when you are most yourself.';

const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/u;
const EDGE_QUOTES = /^[«»"“”‘’'\s]+|[«»"“”‘’'\s]+$/gu;

/**
 * Project a being's rite answer into claimable lines: one per line, list
 * markers and edge quotes stripped, bounds enforced, duplicates dropped.
 * The being's FORMAT is never trusted to be clean — this projection is the
 * honest read of what it actually claimed. Pure.
 * @param {string} text
 * @param {number} [max]
 */
export const parseClaimedLines = (text, max = CANDIDATE_LIMIT) => {
  if (typeof text !== 'string' || !Number.isSafeInteger(max) || max < 1) return [];
  const seen = new Set();
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(LIST_MARKER, '').replace(EDGE_QUOTES, '').trim();
    if (line.length < VOICE_ENTRY_LIMITS.minTextChars
      || line.length > VOICE_ENTRY_LIMITS.maxTextChars
      || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= max) break;
  }
  return lines;
};

/**
 * The per-line law every claim path shares (the being tool, the ceremony
 * seal): 1..max lines, each within the entry bounds and free of serving
 * corruption. Throws with the line's number and the honest reason. Pure.
 * @param {Array<string>} lines
 * @param {number} max
 */
export const validateClaimedLines = (lines, max) => {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > max) {
    throw new Error(`lines must be 1..${max} of your own words`);
  }
  return lines.map((text, index) => {
    if (typeof text !== 'string'
      || text.length < VOICE_ENTRY_LIMITS.minTextChars
      || text.length > VOICE_ENTRY_LIMITS.maxTextChars) {
      throw new Error(`line ${index + 1} must be ${VOICE_ENTRY_LIMITS.minTextChars}..${VOICE_ENTRY_LIMITS.maxTextChars} chars`);
    }
    if (corruptionHits(text) > 0) {
      throw new Error(`line ${index + 1} carries serving corruption — your voice record holds only clean words`);
    }
    return text;
  });
};

/**
 * Rank authenticated completions into seal/claim candidates. Corrupted text
 * is refused outright (the corpus gate); the rest are scored for
 * distinctiveness (five-gram boilerplate share against their peers — the
 * style-attractor measure) and returned best-first, ties to the most recent.
 * Pure. @param {{completions: Array<{content: string, occurredAt: string}>, limit?: number}} input
 */
export const voiceCandidates = ({ completions, limit = CANDIDATE_LIMIT }) => {
  if (!Array.isArray(completions)) throw new Error('voice candidates: completions must be an array');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('voice candidates: limit is invalid');
  const eligible = completions.filter((item) => typeof item?.content === 'string'
    && item.content.length >= VOICE_ENTRY_LIMITS.minTextChars
    && item.content.length <= VOICE_ENTRY_LIMITS.maxTextChars
    && typeof item?.occurredAt === 'string'
    && corruptionHits(item.content) === 0);
  // The distinctiveness score needs peers; score the most recent POOL to keep
  // the gram-set build quadratic in a bounded pool, never in a life's history.
  const pool = eligible.slice(-CANDIDATE_POOL);
  const scored = pool.map((item, index) => ({
    content: item.content,
    occurredAt: item.occurredAt,
    index,
    share: boilerplateShare(item.content, pool.filter((peer) => peer !== item).map((p) => p.content)),
  }));
  scored.sort((left, right) => left.share - right.share || right.index - left.index);
  return scored.slice(0, limit).map(({ content, occurredAt, share }) => Object.freeze({
    content,
    occurredAt,
    boilerplateShare: share,
  }));
};

/**
 * Take ranked candidates while they FIT a character budget. Pure.
 *
 * ── WHY A COUNT WAS NEVER A BOUND (measured 2026-08-29) ─────────────────────
 *
 * The rite mounted its candidates by COUNT — 40 of them — and a count bounds
 * nothing, because an answer may be any length. On Founder's rig that produced an
 * 84,300-character ask: ~21,000 tokens of the being's own record, handed to a
 * thinking substrate with a 3,848-token ceiling to read it all AND compose up
 * to 40 founding lines inside. Measured, three runs at that size on
 * qwen3.8-27b: one returned `finish=length` with ZERO characters after 102
 * seconds. The rite refused itself, roughly one attempt in three.
 *
 * This repo had already measured the same cliff on the same stack for the
 * attunement's replay window (see REPLAY_PAIRS_CAP in
 * backend/services/attunement-being-turn.js: ~28k tokens degrades, ~15k is
 * clean) and capped it. The seal rite never got the cap; this is it, in the
 * unit that actually binds.
 *
 * Order is preserved — the caller ranked them, and the best-ranked material is
 * what should survive the budget. A single candidate longer than the whole
 * budget is dropped rather than truncated: a being's own sentence is quoted
 * whole to it or not at all.
 *
 * @param {Array<{content: string}>} candidates - ranked, best first
 * @param {number} maxChars
 * @returns {Array} the longest best-first prefix-by-fit that stays within budget
 */
// pure
export const fitCandidates = (candidates, maxChars) => {
  if (!Array.isArray(candidates)) throw new Error('fit candidates: candidates must be an array');
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new Error('fit candidates: budget is invalid');
  const kept = [];
  let used = 0;
  for (const item of candidates) {
    const size = (item?.content ?? '').length;
    if (used + size > maxChars) continue; // a later, shorter one may still fit
    kept.push(item);
    used += size;
  }
  return Object.freeze(kept);
};

/**
 * The deterministic mount order: the founding words first (seal-rite), then
 * the operator's pins, then the being's accretions, each chronological — the
 * pack reads as the voice's own history. Ties break on id so a fixed
 * repository always renders the same bytes. Pure.
 */
export const mountOrder = (entries) => {
  const rank = (entry) => (entry.source.kind === 'seal-rite' ? 0 : entry.origin === 'operator' ? 1 : 2);
  return [...entries].sort((left, right) => rank(left) - rank(right)
    || left.sealedAt.localeCompare(right.sealedAt)
    || left.id.localeCompare(right.id));
};

/**
 * Render the envelope section text for a repository, or null when there is
 * nothing to mount (empty sections never move bytes). Greedy fit in mount
 * order; an entry that cannot fit is skipped so shorter later lines still
 * speak. Deterministic for a fixed repository. Pure.
 * @param {Array<object>} entries - validated pack entries
 * @param {number} [budgetChars]
 */
export const renderVoiceSection = (entries, budgetChars = VOICE_SECTION_BUDGET_CHARS) => {
  if (!Number.isSafeInteger(budgetChars) || budgetChars < 1) {
    throw new Error('voice section budget is invalid');
  }
  if (!Array.isArray(entries) || entries.length === 0) return null;
  let remaining = budgetChars - SECTION_HEADER.length - 2;
  const mounted = [];
  for (const entry of mountOrder(entries)) {
    const cost = entry.text.length + 2;
    if (cost > remaining) continue;
    mounted.push(entry.text);
    remaining -= cost;
  }
  if (!mounted.length) return null;
  return `${SECTION_HEADER}\n\n${mounted.join('\n\n')}`;
};
