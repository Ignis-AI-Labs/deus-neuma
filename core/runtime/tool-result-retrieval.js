/**
 * Tool-result retrieval (CCR-lite, FR-5/FR-6) — pure chunk + BM25-scoped
 * recovery of a persisted over-cap tool result.
 *
 * With a query: the stored content is chunked (~800 chars, line-boundary
 * preferred), a BM25 index is built over THIS record's chunks only (scoping
 * by construction — no other ref's content ever enters the index), and the
 * top-k hits are assembled offset-sorted with honest per-window headers and
 * a real-numbers footer. Without a query (or with no hits): an anchored
 * front/back slice via compressToolResult — one source of truth for anchored
 * slicing and marker language, so the neuma reads the same honest cut
 * grammar whether the cut happened at compression time or retrieval time.
 *
 * Hard invariant: response.length <= cap on EVERY path, headers and footers
 * included — the response re-enters the portal as a capped <tool_response>
 * turn (FR-6), never an uncapped flood. No IO, no randomness, no clock
 * reads; double-call byte equality; frozen returns.
 *
 * Pure: everything in this module. IO (resolving the ref to a record) stays
 * with callers.
 */

import { createBM25Index, bm25Search } from '../memory/bm25-engine.js';
import { compressToolResult } from './tool-result-compressor.js';
import { pageToolResult } from './tool-result-page.js';

const DEFAULT_CHUNK_CHARS = 800;
const DEFAULT_CAP = 4000;
const DEFAULT_LIMIT = 5;

/** Longest query fragment quoted back in honesty markers. */
const QUERY_ECHO_MAX = 40;

// Character cuts must never strand half a surrogate pair — a lone surrogate
// corrupts every downstream UTF-8 boundary (same rule as the compressor).
const snapCutEnd = (text, idx) => {
  const c = text.charCodeAt(idx - 1);
  return c >= 0xd800 && c <= 0xdbff ? idx - 1 : idx;
};

const renderChunkHeader = (ref, start, end) => `[ccr:${ref} chunk @${start}-${end}]`;

const renderBm25Footer = (ref, returned, matched, total, shownChars, totalChars) =>
  `[ccr:${ref} — returned ${returned} of ${matched} matched chunks (${total} total); showing ${shownChars} of ${totalChars} chars]`;

const renderCompleteNote = (ref, chars) => `[ccr:${ref} — complete result, ${chars} chars]`;

const renderNoHitsNote = (ref, queryEcho) =>
  `[ccr:${ref} — no chunks matched "${queryEcho}"; anchored slice instead]`;

/**
 * Split content into deterministic contiguous windows.
 *
 * Chunks partition the content exactly: texts concatenate back to the
 * original byte-for-byte, and [start, end) offsets are true slice ranges.
 * Cuts prefer the position just after the last newline inside the window;
 * a window with no newline falls back to a character cut, snapped so a
 * surrogate pair is never split.
 *
 * @param {string} content - Text to chunk.
 * @param {object} [options]
 * @param {number} [options.chunkChars=800] - Target window size in chars.
 * @returns {ReadonlyArray<Readonly<{id: string, text: string, start: number, end: number}>>}
 */
export const chunkContent = (content, { chunkChars = DEFAULT_CHUNK_CHARS } = {}) => {
  const text = typeof content === 'string' ? content : String(content ?? '');
  const size = Number.isFinite(chunkChars) && chunkChars > 0
    ? Math.floor(chunkChars)
    : DEFAULT_CHUNK_CHARS;

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let cut = Math.min(start + size, text.length);
    if (cut < text.length) {
      const nl = text.lastIndexOf('\n', cut - 1);
      if (nl >= start) {
        cut = nl + 1;
      } else {
        cut = snapCutEnd(text, cut);
        // A 1-char window over a surrogate pair snaps back to zero width —
        // take the whole pair instead of stalling.
        if (cut <= start) cut = Math.min(start + 2, text.length);
      }
    }
    chunks.push(Object.freeze({
      id: `c${chunks.length}`,
      text: text.slice(start, cut),
      start,
      end: cut,
    }));
    start = cut;
  }
  return Object.freeze(chunks);
};

// Assemble accepted windows (already offset-sorted) into the response body,
// merging adjacent windows so contiguous content reads unbroken instead of
// announcing a zero-char seam between two headers.
const mergeAdjacent = (windows) => {
  const merged = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && last.end === w.start) {
      last.text += w.text;
      last.end = w.end;
    } else {
      merged.push({ text: w.text, start: w.start, end: w.end });
    }
  }
  return merged;
};

// BM25 path: greedy accept in relevance order under a budget that reserves
// worst-case footer + per-window header space up front, so the cap invariant
// holds by construction. Returns null when not even a trimmed top hit fits —
// the caller then falls back to the anchored path.
const assembleBm25 = (record, query, chunks, cap, limit) => {
  const { ref } = record;
  const totalChars = record.content.length;
  const index = createBM25Index(chunks);
  const hits = bm25Search(index, query, limit);
  if (hits.length === 0) return { hits: 0 };

  const headerMax = renderChunkHeader(ref, totalChars, totalChars).length;
  const footerMax = renderBm25Footer(ref, chunks.length, chunks.length, chunks.length, totalChars, totalChars).length + 1;
  let remaining = cap - footerMax;

  const accepted = [];
  for (const hit of hits) {
    const chunk = hit.meta;
    const cost = headerMax + 2 + chunk.text.length;
    if (cost <= remaining) {
      accepted.push({ text: chunk.text, start: chunk.start, end: chunk.end });
      remaining -= cost;
    } else if (accepted.length === 0) {
      // Best hit does not fit whole — return its head, header telling the
      // true (smaller) range shown rather than promising the full chunk.
      const avail = remaining - headerMax - 2;
      if (avail >= 1) {
        const sliceEnd = snapCutEnd(chunk.text, Math.min(avail, chunk.text.length));
        if (sliceEnd >= 1) {
          accepted.push({
            text: chunk.text.slice(0, sliceEnd),
            start: chunk.start,
            end: chunk.start + sliceEnd,
          });
          remaining -= headerMax + 2 + sliceEnd;
        }
      }
    }
  }
  if (accepted.length === 0) return null;

  const chunksReturned = accepted.length;
  accepted.sort((a, b) => a.start - b.start);
  const merged = mergeAdjacent(accepted);
  const shownChars = merged.reduce((n, w) => n + w.text.length, 0);
  const body = merged
    .map((w) => `${renderChunkHeader(ref, w.start, w.end)}\n${w.text}`)
    .join('\n');
  const response = `${body}\n${renderBm25Footer(ref, chunksReturned, hits.length, chunks.length, shownChars, totalChars)}`;
  return { hits: hits.length, response, chunksReturned };
};

// Anchored path: delegate the slice to compressToolResult — same 50/40/10
// anchor, same marker grammar, same proven cap invariant. An optional note
// line is prepended only when it fits inside the cap alongside the slice.
const assembleAnchored = (record, cap, note) => {
  const noteCost = note ? note.length + 1 : 0;
  if (note && cap - noteCost > 0) {
    const sliced = compressToolResult(record.content, { cap: cap - noteCost, ref: record.ref });
    return `${note}\n${sliced.compressed}`;
  }
  return compressToolResult(record.content, { cap, ref: record.ref }).compressed;
};

// The neuma's query is echoed back in the no-hits marker — bounded and
// newline-flattened so a hostile or giant query cannot distort the marker.
const queryEcho = (query) => {
  const flat = query.replace(/\s+/g, ' ').trim();
  if (flat.length <= QUERY_ECHO_MAX) return flat;
  return `${flat.slice(0, snapCutEnd(flat, QUERY_ECHO_MAX))}…`;
};

/**
 * Retrieve from a persisted tool-result record, capped for re-entry as a
 * <tool_response> turn.
 *
 * Modes:
 * - 'bm25' — query given and at least one chunk matched: offset-sorted top-k
 *   windows, each under an honest `[ccr:<ref> chunk @<start>-<end>]` header,
 *   with a real-numbers footer.
 * - 'anchored' — no query, no BM25 hits (honest "no chunks matched" note),
 *   or content already within cap (returned whole with a "complete result"
 *   note; the degenerate anchored case where nothing is omitted —
 *   chunksReturned equals totalChunks).
 *
 * @param {object} record - Persisted record from readToolResult:
 *   { ref, content, ... }. null/malformed throws — callers gate nulls, and a
 *   silent empty response would read as […], a lie.
 * @param {object} [options]
 * @param {string} [options.query] - BM25 query; empty/blank means no query.
 * @param {number} [options.cap=4000] - Hard response ceiling in chars (JS
 *   string length), headers and footers included.
 * @param {number} [options.limit=5] - Max BM25 chunks considered.
 * @param {number} [options.offset] - Exact stored-text cursor; selects paging instead of search.
 * @param {number} [options.pageChars=3000] - Page size, 2–maxPageChars; may be used without offset to start at 0.
 * @param {number} [options.maxPageChars=3000] - The page ceiling (raised by a caller that measured the room).
 * @returns {Readonly<{response: string, mode: 'bm25'|'anchored',
 *   chunksReturned: number, totalChunks: number}>|Readonly<{response: string,
 *   mode: 'page', start: number, end: number, nextOffset: number|null, totalChars: number}>}
 */
export const retrieveFromRecord = (record, { query, offset, pageChars, maxPageChars, cap = DEFAULT_CAP, limit = DEFAULT_LIMIT } = {}) => {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('retrieveFromRecord: record must be a stored tool-result object');
  }
  if (typeof record.content !== 'string') {
    throw new Error('retrieveFromRecord: record.content must be a string');
  }
  if (typeof record.ref !== 'string' || record.ref.length === 0) {
    throw new Error('retrieveFromRecord: record.ref must be a non-empty string');
  }

  const capChars = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_CAP;
  const limitN = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
  const q = typeof query === 'string' ? query.trim() : '';
  if (offset !== undefined || pageChars !== undefined) {
    if (q) throw new Error('Use either query search or offset paging, not both');
    return pageToolResult(record, { offset, pageChars, cap: capChars, ...(maxPageChars ? { maxPageChars } : {}) });
  }
  const chunks = chunkContent(record.content);
  const totalChunks = chunks.length;

  // Whole result fits the cap: return it verbatim — retrieval that trims
  // content which already fits would be a needless cut.
  if (record.content.length <= capChars) {
    const note = renderCompleteNote(record.ref, record.content.length);
    const withNote = `${record.content}\n${note}`;
    return Object.freeze({
      response: withNote.length <= capChars ? withNote : record.content,
      mode: 'anchored',
      chunksReturned: totalChunks,
      totalChunks,
    });
  }

  if (q.length > 0) {
    const assembled = assembleBm25(record, q, chunks, capChars, limitN);
    if (assembled && assembled.response) {
      return Object.freeze({
        response: assembled.response,
        mode: 'bm25',
        chunksReturned: assembled.chunksReturned,
        totalChunks,
      });
    }
    // No hits (or cap too small for even one trimmed window): honest
    // fallback to the anchored slice, saying so when the note fits.
    const note = assembled && assembled.hits === 0
      ? renderNoHitsNote(record.ref, queryEcho(q))
      : null;
    return Object.freeze({
      response: assembleAnchored(record, capChars, note),
      mode: 'anchored',
      chunksReturned: 0,
      totalChunks,
    });
  }

  return Object.freeze({
    response: assembleAnchored(record, capChars, null),
    mode: 'anchored',
    chunksReturned: 0,
    totalChunks,
  });
};
