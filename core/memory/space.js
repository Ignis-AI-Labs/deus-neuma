// Experiential-memory SPACE descriptor (CORE-005 / #125, slice B1).
//
// A "space" is the project / working context a witness and neuma share — the
// PRIMARY scope for episodic memory (Layer 1). It is distinct from the neuma's
// sovereign NeumaWorkspace (its home store): the space tag is stored INSIDE an
// observation, it is NOT the workspace. See docs/planning/proposals/memory/experiential-graph.md.
//
// Pure + dependency-free: imported by both the core recall path (the read-side
// migration default in buildDocs) and the backend ingestion path (the
// crystallizeObservation stamp), so it must pull in no IO.

/** The default space — every untagged observation belongs here (back-compat). */
export const GENERAL_SPACE_ID = 'general';

const VALID_KINDS = Object.freeze(['project', 'workspace']);
const MAX_ID_LEN = 64;
const MAX_LABEL_LEN = 80;
// Upper bound on untrusted input scanned before transforming — 4× the id cap
// covers toLowerCase() expansion (some code points grow) plus 2-UTF-16-unit
// astral characters, so the real cap is never starved.
const MAX_ID_SCAN_LEN = MAX_ID_LEN * 4;

/** The general space — the always-on Layer-2 pool and the migration default. */
export const DEFAULT_SPACE = Object.freeze({
  id: GENERAL_SPACE_ID,
  kind: 'workspace',
  label: 'General',
});

// pure — collapse arbitrary (possibly untrusted) input into a stable slug:
// lowercased, [a-z0-9_-] only (other runs → a single '-'), edge dashes trimmed,
// length-capped. Returns '' when nothing survives, so the caller falls back to
// the general space. The leading slice bounds the transform work on the
// untrusted ingestion path (a hostile client can't make us scan megabytes).
const toSlug = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, MAX_ID_SCAN_LEN) // bound work before transforming untrusted input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '') // edge separators (- or _) shouldn't fragment spaces
    .slice(0, MAX_ID_LEN)
    .replace(/[-_]+$/g, ''); // the length cap can re-expose a trailing separator
};

// pure — a single-line, control-char-free, length-bounded label safe to place
// into the prompt / memory explorer. Iterating by code point with an early cap
// does three things at once: bounds the work on untrusted input, caps the
// length by CODE POINT (so an astral character at the boundary is never split
// into a lone surrogate), and folds control points to spaces. Whitespace runs
// then collapse and the result is trimmed.
const isControl = (cp) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f); // C0, DEL, C1
const cleanLabel = (value) => {
  if (typeof value !== 'string') return '';
  let out = '';
  let count = 0;
  for (const ch of value) {
    if (count >= MAX_LABEL_LEN) break;
    // Compared numerically — control chars are never written as literals in src.
    out += isControl(ch.codePointAt(0)) ? ' ' : ch;
    count += 1;
  }
  return out.replace(/\s+/g, ' ').trim();
};

/**
 * Normalize arbitrary space input into a frozen { id, kind, label }. Missing or
 * invalid input — and the reserved id 'general' — collapse to DEFAULT_SPACE, so
 * this doubles as the read-side migration default for untagged observations.
 * Idempotent and pure; safe on untrusted client payloads.
 * @param {{id?:string, kind?:string, label?:string}|null} [input]
 * @returns {Readonly<{id:string, kind:'project'|'workspace', label:string}>}
 */
export const normalizeSpace = (input) => {
  if (!input || typeof input !== 'object') return DEFAULT_SPACE;
  const id = toSlug(input.id);
  // Empty after sanitizing, or the reserved general id → canonical general
  // space (so 'general' can never be re-labelled by a client payload).
  if (!id || id === GENERAL_SPACE_ID) return DEFAULT_SPACE;
  // Normalize kind like the id path (lenient): case-folded, with a non-string
  // or unknown value falling back to the workspace default.
  const kindLower = typeof input.kind === 'string' ? input.kind.toLowerCase() : '';
  const kind = VALID_KINDS.includes(kindLower) ? kindLower : 'workspace';
  const label = cleanLabel(input.label) || id;
  return Object.freeze({ id, kind, label });
};
