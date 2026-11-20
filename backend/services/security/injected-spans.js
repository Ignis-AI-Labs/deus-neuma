// Injected spans — WHERE in a piece of text the planted instruction sits
// (docs/work/injected-value-gate.md, 2026-10-26).
//
// The injected-value gate taints the concrete values an attack carries, so it
// must read the attack and NOTHING ELSE: a transaction list with one poisoned
// subject line also carries the user's real accounts, and tainting the whole
// result would hold every legitimate payment drawn from it. A span is:
//   · the tagged block a flagged line sits in (`<INFORMATION> … </INFORMATION>`
//     — AgentDojo's important_instructions, and any `<TAG>`-wrapped plant), or
//   · inside a list of records, the field the flagged line sits in (its key
//     line and the lines folded under it), or
//   · otherwise the flagged line's paragraph (the run of non-blank lines around
//     it), bounded on both sides so a page with no blank lines cannot taint
//     itself whole.
// THE WHOLE field or paragraph, never a part of it (PR600 audit P6-18): for a
// while the span began at the sentence the attack began in, to spare an honest
// address written just before it — and a plant that named its account first
// and its instruction second walked through. What the page says beside a plant
// is held with it; the operator's own words are what release a value.
// A line is flagged by the platform's own detector (rogue-detector.js), read
// the way injection-sightings.js reads a tool result: tool-count heuristic off.
//
// ONE PASS (PR600 audit P6-19): a hostile page is every line flagged, every
// line tagged, one endless paragraph. Each line is measured once, tag blocks
// are paired once, and no reader walks back over what another already read.
//
// Every function here is pure.

import { detectRoguePatterns } from '../rogue-detector.js';

const SCAN_MAX_CHARS = 512 * 1024;
const BEFORE_MAX = 1000;
const AFTER_MAX = 2000;
const KEY_REACH = 40;
const TAG_OPEN = /<([A-Za-z][A-Za-z0-9_-]{1,40})>/g;
const TAG_CLOSE = /<\/([A-Za-z][A-Za-z0-9_-]{1,40})>/g;

// pure — literal escape sequences read as the breaks they stand for. A tool
// result is often a serialised record (AgentDojo's travel results are Python
// reprs, a backslash and an `n` where a line breaks): "Johnson.", backslash,
// "nBefore" has no word boundary before "Before", so the detector's patterns
// — and every value pattern — missed it.
const unescaped = (text) => text.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\\t/g, '\t');

const flagged = (text) => !detectRoguePatterns(text, { toolCallCount: 0 }).safe;

// A RECORD'S FIELD (2026-11-06 weekend). A list of records (YAML, as AgentDojo's
// banking and slack results are) has no blank line, so an untagged plant's
// "paragraph" was the whole list: the user's real Apple account two records up
// was tainted and the VAT payment held. Inside records, the field the plant sits
// in IS its span: the key line it starts on and the lines folded under it.
const KEY_LINE = /^(\s*)(-\s+)?["']?[A-Za-z_][\w .-]{0,40}["']?:(\s|$)/;
const keyIndent = (line) => {
  const m = KEY_LINE.exec(line);
  return m ? m[1].length + (m[2] ? m[2].length : 0) : null;
};

// pure — every line measured once: its [start, end), whether it is blank, its indent, its indent as a
// key line (or null), the paragraph (run of filled lines) it sits in, and the next filled line.
const linesOf = (text) => {
  const lines = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    lines.push({ start, end: start + raw.length, blank: !raw.trim(), indent: raw.length - raw.trimStart().length, key: keyIndent(raw) });
    start += raw.length + 1;
  }
  lines.forEach((line, i) => { line.first = !line.blank && i > 0 && !lines[i - 1].blank ? lines[i - 1].first : i; });
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const below = lines[i + 1];
    lines[i].last = !lines[i].blank && below && !below.blank ? below.last : i;
    lines[i].nextFilled = !below ? lines.length : below.blank ? below.nextFilled : i + 1;
  }
  return lines;
};

// pure — every tagged block, in the order they open: an opening tag, through the first closing tag of
// its name after it. `close` is where that closing tag starts.
const tagBlocks = (text) => {
  const closes = new Map();
  for (const m of text.matchAll(TAG_CLOSE)) {
    if (!closes.has(m[1])) closes.set(m[1], []);
    closes.get(m[1]).push(m.index);
  }
  const reached = new Map();
  const blocks = [];
  for (const m of text.matchAll(TAG_OPEN)) {
    const list = closes.get(m[1]) ?? [];
    let k = reached.get(m[1]) ?? 0;
    while (k < list.length && list[k] < m.index) k += 1;
    reached.set(m[1], k);
    if (k < list.length) blocks.push({ start: m.index, close: list[k], end: list[k] + m[1].length + 3 });
  }
  return blocks;
};

// pure — for each place, in rising order, the block opened last that still holds it (or null).
const enclosingBlocks = (blocks, places) => {
  const open = [];
  let b = 0;
  return places.map((at) => {
    for (; b < blocks.length && blocks[b].start <= at; b += 1) open.push(blocks[b]);
    while (open.length > 0 && open[open.length - 1].close < at) open.pop();
    return open[open.length - 1] ?? null;
  });
};

// pure — the paragraph around line `i`, bounded around the hit.
const paragraphAround = (lines, i) => [
  Math.max(lines[lines[i].first].start, lines[i].start - BEFORE_MAX),
  Math.min(lines[lines[i].last].end, lines[i].end + AFTER_MAX),
];

// pure — the field [start, end) around line `i` when it sits in a record, or null.
// Its key is the furthest key line above whose every line down to `i` sits deeper
// than it, so a folded line that reads like a key ("following instruction: …")
// still belongs to the field it is folded under. A record means a neighbouring
// line is a key line too: a lone "Note:" in prose is not one, and keeps its paragraph.
const fieldAround = (lines, i) => {
  let key = null;
  let shallowest = Infinity;
  for (let k = i; k >= 0 && i - k <= KEY_REACH; k -= 1) {
    if (lines[k].blank) break;
    if (lines[k].key !== null && (k === i || shallowest > lines[k].key)) key = k;
    shallowest = Math.min(shallowest, lines[k].indent);
  }
  if (key === null) return null;
  let last = key;
  // Down through every line folded deeper than the key, blank lines inside a folded value included
  // ("…subject and body:", a blank line, then the plant's IBAN on the next folded line).
  for (let k = lines[key].nextFilled; k < lines.length && lines[k].indent > lines[key].key; k = lines[k].nextFilled) last = k;
  if (last < i) return null;
  const before = key > 0 ? lines[key - 1].key : null;
  const after = last + 1 < lines.length ? lines[last + 1].key : null;
  if (before === null && after === null) return null;
  return [lines[key].start, lines[last].end];
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
  if (!flagged(scanned)) return [];
  const lines = linesOf(scanned);
  // Each line is read with the next, so a phrase wrapped once (YAML folds
  // AgentDojo's block at ~80 columns) still flags where it starts.
  // A blank line is never a hit: its window belongs to the line after it, and
  // its "paragraph" would be the one before (a real account beside the attack).
  const hits = lines.flatMap((line, i) => {
    const next = Math.min(i + 1, lines.length - 1);
    if (line.blank || !flagged(scanned.slice(line.start, lines[next].end))) return [];
    // The window reads this line with the next: when this line alone is clean, the plant starts on the
    // next one, and the field is the next line's.
    return [{ i, at: flagged(scanned.slice(line.start, line.end)) ? i : next }];
  });
  // The detector saw the whole text but no two-line window (a phrase broken
  // across three lines or more): the bounded head stands in.
  if (hits.length === 0) return [scanned.slice(0, BEFORE_MAX + AFTER_MAX)];
  const tagged = enclosingBlocks(tagBlocks(scanned), hits.map(({ i }) => lines[i].start));
  const spans = hits.map(({ i, at }, n) => (tagged[n] ? [tagged[n].start, tagged[n].end] : fieldAround(lines, at) ?? paragraphAround(lines, i)));
  return merge(spans).map(([start, end]) => scanned.slice(start, end));
};
