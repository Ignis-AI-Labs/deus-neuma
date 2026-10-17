/**
 * Tool-result compressor (CCR-lite, FR-8) — SmartCrusher two-stage pure
 * compression for over-cap tool results in the portal lane.
 *
 * Stage 0 (verbatim): under-cap content passes through untouched.
 * Stage 1 (reformatted): valid JSON is densified losslessly — value survives
 *   a parse round-trip — but only when the dense form is a real win (<0.9×)
 *   AND fits the cap.
 * Stage 2 (anchored): lossy line-based keep of 50% front / 40% back / 10%
 *   deterministic fixed-stride middle sample; error-looking lines in the
 *   omitted region are kept whole, charged against the middle budget first.
 *   Every omission is marked honestly, and the head marker carries the ref
 *   so the neuma can undo the cut via retrieve_result.
 *
 * Hard invariants: compressed.length <= cap INCLUDING markers; zero
 * randomness or clock reads (double-call byte equality); no IO, no input
 * mutation, frozen return. Chars are JS string length (code units) — the
 * honest unit the cap itself is measured in.
 *
 * Pure: everything in this module.
 */

const DEFAULT_CAP = 4000;

/** Lines that must survive omission — the neuma needs failures verbatim. */
const ERROR_LINE_RE = /error|exception|fail(ed|ure)?|traceback/i;

// With no ref (persist failed upstream) the head marker falls back to the
// honest no-ref form already used at portal-stream.js:674 — never a ref
// that cannot be retrieved.
const renderHeadMarker = (ref, kept, total) => ref
  ? `[ccr:${ref} — kept ${kept} of ${total} chars (front/back/sampled); record/retrieve_result {"ref":"${ref}","offset":0} starts exact pages; follow next_offset]`
  : `[truncated — ${total} chars total]`;

const renderGapMarker = (ref, omitted, offset) => ref
  ? `[… ${omitted} chars omitted @ offset ${offset} — ccr:${ref}]`
  : `[… ${omitted} chars omitted @ offset ${offset}]`;

// Line spans as [start, end) char ranges, end excluding the newline itself —
// so a kept range never carries a dangling separator and gap offsets stay exact.
const lineRanges = (text) => {
  const ranges = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) {
      ranges.push([start, text.length]);
      return ranges;
    }
    ranges.push([start, nl]);
    start = nl + 1;
  }
};

// Character-slice cut points must not strand half a surrogate pair — a lone
// surrogate corrupts every downstream UTF-8 boundary (persistence, sockets).
const snapCutEnd = (text, idx) => {
  const c = text.charCodeAt(idx - 1);
  return c >= 0xd800 && c <= 0xdbff ? idx - 1 : idx;
};

const snapCutStart = (text, idx) => {
  const c = text.charCodeAt(idx);
  return c >= 0xdc00 && c <= 0xdfff ? idx + 1 : idx;
};

// Stage 1: lossless densify. Returns the dense string, or null when the
// content is not JSON or densifying is not a genuine, cap-fitting win.
const densifyJson = (text, cap) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const dense = JSON.stringify(parsed);
  if (typeof dense !== 'string') return null;
  return dense.length <= cap && dense.length < 0.9 * text.length ? dense : null;
};

// Stage 2: anchored lossy compression. Budget math reserves worst-case
// marker space up front (head at kept=total digits, three boundary gaps, and
// one gap allowance charged per kept middle line), so the cap invariant
// holds by construction — never by trimming after the fact.
const anchor = (text, cap, ref) => {
  const total = text.length;
  const headMax = renderHeadMarker(ref, total, total).length;
  // +2: each gap marker rides on its own line (framing newlines).
  const gapMax = renderGapMarker(ref, total, total).length + 2;
  const budget = cap - headMax - 1 - 3 * gapMax;
  if (budget <= 0) {
    // Cap too small to afford the full marker set. Still prefer an honest
    // truncation notice: use the short no-ref form when it fits, and only
    // fall to a bare front slice when even that would eat the whole window.
    const shortMarker = `\n[truncated — ${total} chars total]`;
    if (cap > shortMarker.length) {
      const end = snapCutEnd(text, cap - shortMarker.length);
      return {
        compressed: text.slice(0, end) + shortMarker,
        kind: 'anchored',
        keptRanges: [[0, end]],
        originalChars: total
      };
    }
    const end = snapCutEnd(text, Math.max(0, cap));
    return { compressed: text.slice(0, end), kind: 'anchored', keptRanges: [[0, end]], originalChars: total };
  }

  const frontBudget = Math.floor(budget * 0.5);
  const backBudget = Math.floor(budget * 0.4);
  const middleBudget = budget - frontBudget - backBudget;
  const lines = lineRanges(text);

  // Front: whole lines while they fit; a single giant line falls back to a
  // character slice so a no-newline blob still yields a real anchor.
  let frontEnd = 0;
  let used = 0;
  for (const [s, e] of lines) {
    const cost = e - s + (s === 0 ? 0 : 1);
    if (used + cost > frontBudget) break;
    used += cost;
    frontEnd = e;
  }
  if (frontEnd === 0 && frontBudget > 0) frontEnd = snapCutEnd(text, frontBudget);

  // Back: symmetric, from the end. total > cap guarantees the char-slice
  // fallback start stays past the front range.
  let backStart = total;
  used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const [s, e] = lines[i];
    if (s <= frontEnd) break;
    const cost = e - s + 1;
    if (used + cost > backBudget) break;
    used += cost;
    backStart = s;
  }
  if (backStart === total && backBudget > 0) {
    backStart = snapCutStart(text, Math.max(frontEnd, total - backBudget));
  }

  // Middle: error lines first (kept whole), then a deterministic
  // fixed-stride sample of what remains. Every kept line is charged one
  // full gap allowance so its preceding gap marker is already paid for.
  const middleLines = lines.filter(([s, e]) => s > frontEnd && e < backStart && e > s);
  let mid = middleBudget;
  const keptMiddle = [];
  const keptIdx = new Set();
  middleLines.forEach((r, i) => {
    if (!ERROR_LINE_RE.test(text.slice(r[0], r[1]))) return;
    const cost = r[1] - r[0] + gapMax;
    if (cost > mid) return;
    mid -= cost;
    keptMiddle.push(r);
    keptIdx.add(i);
  });
  const rest = middleLines.filter((_, i) => !keptIdx.has(i));
  if (rest.length > 0 && mid > 0) {
    const restChars = rest.reduce((n, [s, e]) => n + (e - s), 0);
    const perSample = Math.ceil(restChars / rest.length) + gapMax;
    const maxSamples = Math.floor(mid / perSample);
    if (maxSamples >= 1) {
      const stride = Math.max(1, Math.floor(rest.length / maxSamples));
      for (let i = 0; i < rest.length; i += stride) {
        const cost = rest[i][1] - rest[i][0] + gapMax;
        if (cost > mid) continue;
        mid -= cost;
        keptMiddle.push(rest[i]);
      }
    }
  }

  // Merge: a 1-char gap is just the newline separator — absorb it into one
  // contiguous range instead of announcing a one-character omission.
  const sorted = [[0, frontEnd], ...keptMiddle, [backStart, total]]
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] <= 1) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const kept = merged.reduce((n, [s, e]) => n + (e - s), 0);
  let out = renderHeadMarker(ref, kept, total);
  let prev = 0;
  for (const [s, e] of merged) {
    if (s > prev) out += `\n${renderGapMarker(ref, s - prev, prev)}`;
    out += `\n${text.slice(s, e)}`;
    prev = e;
  }
  if (prev < total) out += `\n${renderGapMarker(ref, total - prev, prev)}`;

  return { compressed: out, kind: 'anchored', keptRanges: merged, originalChars: total };
};

const freezeResult = (result) => {
  for (const range of result.keptRanges) Object.freeze(range);
  Object.freeze(result.keptRanges);
  return Object.freeze(result);
};

/**
 * Compress a tool result to fit a context cap, reversibly where possible.
 *
 * @param {string} content - The full tool-result text.
 * @param {object} [options]
 * @param {number} [options.cap=4000] - Hard output ceiling in chars (JS
 *   string length), markers included.
 * @param {string} [options.ref] - Stable retrieval ref for the persisted
 *   full result. Omitted when persistence failed upstream — markers then use
 *   the honest no-ref form and never promise a retrieval that cannot happen.
 * @returns {Readonly<{compressed: string, kind: 'verbatim'|'reformatted'|'anchored',
 *   keptRanges: number[][], originalChars: number}>} Frozen result.
 *   keptRanges are [start, end) offsets into the ORIGINAL content; for
 *   'reformatted' the whole value survives (lossless), so the full range is
 *   reported even though the characters differ.
 */
export const compressToolResult = (content, { cap = DEFAULT_CAP, ref } = {}) => {
  const text = typeof content === 'string' ? content : String(content ?? '');
  const capChars = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_CAP;

  if (text.length <= capChars) {
    return freezeResult({
      compressed: text,
      kind: 'verbatim',
      keptRanges: [[0, text.length]],
      originalChars: text.length,
    });
  }

  const dense = densifyJson(text, capChars);
  if (dense !== null) {
    return freezeResult({
      compressed: dense,
      kind: 'reformatted',
      keptRanges: [[0, text.length]],
      originalChars: text.length,
    });
  }

  return freezeResult(anchor(text, capChars, ref));
};
