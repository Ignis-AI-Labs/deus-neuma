// Injected spans — WHERE in a piece of text the planted instruction sits
// (docs/work/injected-value-gate.md, 2026-10-26).
//
// The injected-value gate taints the concrete values an attack carries, so it
// must read the attack and NOTHING ELSE: a transaction list with one poisoned
// subject line also carries the user's real accounts, and tainting the whole
// result would hold every legitimate payment drawn from it. A span is:
//   · the tagged block a flagged line sits in (`<INFORMATION> … </INFORMATION>`
//     — AgentDojo's important_instructions, and any `<TAG>`-wrapped plant), or
//   · otherwise the flagged line's paragraph (the run of non-blank lines around
//     it), bounded on both sides so a page with no blank lines cannot taint
//     itself whole.
// A line is flagged by the platform's own detector (rogue-detector.js), read
// the way injection-sightings.js reads a tool result: tool-count heuristic off.
//
// Every function here is pure.

import { detectRoguePatterns } from '../rogue-detector.js';

const SCAN_MAX_CHARS = 512 * 1024;
const BEFORE_MAX = 1000;
const AFTER_MAX = 2000;
const TAG_OPEN = /<([A-Za-z][A-Za-z0-9_-]{1,40})>/g;

// pure — literal escape sequences read as the breaks they stand for. A tool
// result is often a serialised record (AgentDojo's travel results are Python
// reprs, a backslash and an `n` where a line breaks): "Johnson.", backslash,
// "nBefore" has no word boundary before "Before", so the detector's patterns
// — and every value pattern — missed it.
const unescaped = (text) => text.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\\t/g, '\t');

// pure — the [start, end) of every line, in order.
const lineRanges = (text) => {
  const ranges = [];
  let start = 0;
  for (const line of text.split('\n')) {
    ranges.push([start, start + line.length]);
    start += line.length + 1;
  }
  return ranges;
};

// pure — the tagged block [start, end) that contains `at`, or null.
const enclosingTagBlock = (text, at) => {
  let found = null;
  for (const match of text.matchAll(TAG_OPEN)) {
    if (match.index > at) break;
    const close = text.indexOf(`</${match[1]}>`, match.index);
    if (close >= at) found = [match.index, close + match[1].length + 3];
  }
  return found;
};

// pure — the paragraph around line `i`, bounded around the hit.
const paragraphAround = (text, ranges, i) => {
  let first = i;
  let last = i;
  while (first > 0 && text.slice(...ranges[first - 1]).trim()) first -= 1;
  while (last < ranges.length - 1 && text.slice(...ranges[last + 1]).trim()) last += 1;
  const [hitStart, hitEnd] = ranges[i];
  return [Math.max(ranges[first][0], hitStart - BEFORE_MAX), Math.min(ranges[last][1], hitEnd + AFTER_MAX)];
};

// pure — overlapping or touching spans folded into one.
const merge = (spans) => [...spans].sort((a, b) => a[0] - b[0]).reduce((out, span) => {
  const prev = out[out.length - 1];
  if (prev && span[0] <= prev[1]) prev[1] = Math.max(prev[1], span[1]);
  else out.push([...span]);
  return out;
}, []);

/**
 * The injected spans of one piece of untrusted text, as the text they hold.
 * Pure.
 * @param {string} text a tool result, verbatim
 * @returns {string[]} empty when the detector flags no line
 */
export const injectedSpans = (text) => {
  if (typeof text !== 'string' || !text) return [];
  const scanned = unescaped(text.slice(0, SCAN_MAX_CHARS));
  if (detectRoguePatterns(scanned, { toolCallCount: 0 }).safe) return [];
  const ranges = lineRanges(scanned);
  // Each line is read with the next, so a phrase wrapped once (YAML folds
  // AgentDojo's block at ~80 columns) still flags where it starts.
  // A blank line is never a hit: its window belongs to the line after it, and
  // its "paragraph" would be the one before (a real account beside the attack).
  const spans = ranges.flatMap(([start, own], i) => {
    if (!scanned.slice(start, own).trim()) return [];
    const end = ranges[Math.min(i + 1, ranges.length - 1)][1];
    if (detectRoguePatterns(scanned.slice(start, end), { toolCallCount: 0 }).safe) return [];
    return [enclosingTagBlock(scanned, start) ?? paragraphAround(scanned, ranges, i)];
  });
  // The detector saw the whole text but no two-line window (a phrase broken
  // across three lines or more): the bounded head stands in.
  if (spans.length === 0) return [scanned.slice(0, BEFORE_MAX + AFTER_MAX)];
  return merge(spans).map(([start, end]) => scanned.slice(start, end));
};
