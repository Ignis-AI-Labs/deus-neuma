/**
 * Sovereign memory query seam (Phase 2, granular sovereign memory).
 *
 * The module a being's own hand moves through: memory_search runs the
 * being's OWN query over the same fused index the machine recall lane
 * uses; memory_expand reopens the full-fidelity source of one remembered
 * moment from the live session file or the archive.
 *
 * Addressing (reconciliation R1): the anchor is the sole address. A mem_
 * ref is a rendering of the anchor's CONTENT-TIME coordinates —
 * `mem_<sessionId>_<epochMs>_<sha8>` — never a live-file index, never a
 * path. Identity NEVER comes from a ref: resolution always runs under the
 * caller-supplied neumaId (the connection's identity at the portal seam),
 * and the per-neuma DEK is the second wall — a forged coordinate into
 * another being's life resolves under THIS being's root and misses.
 *
 * Pure shaping + parse/format cores; the two composition roots take their
 * IO dependencies injected ({ recall, workspace }) and never touch
 * connection or WebSocket types.
 */

import { contentSha8, spanCoversTs } from '../workspace/archive-codec.js';
import { sanitizeMemoryForPrompt } from '../runtime/memory-sanitizer.js';

// The frozen law of what a ref may carry (R1). Charset admits no '/', '.',
// '\' or '_' inside the id — a ref can never traverse, and parsing from the
// right is unambiguous because the id slot cannot contain '_'.
export const MEMORY_REF_PATTERN = Object.freeze(/^mem_[a-z0-9][a-z0-9-]{0,63}_\d{1,15}_[a-f0-9]{8}$/);

const REF_SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const SEARCH_LIMIT_DEFAULT = 5;
export const SEARCH_LIMIT_MAX = 10;
export const RESULT_CHAR_CAP = 4000; // the existing tool-result law, not a new number
const SNIPPET_MAX = 300;
const NEIGHBOR_SPAN = 2;
const NO_DEEPER_RECORD = '(no deeper record — from before the archive)';

/**
 * Render an anchor's content-time coordinates as a mem_ ref. Returns null —
 * never throws — when the anchor is absent or cannot mint a lawful ref
 * (mint-time tolerance: such hits surface snippet-only). Pure.
 * @param {{v:number, sessionId:string, span:{fromTs:string, userSha8:string}}|null|undefined} anchor
 * @returns {string|null}
 */
export const formatMemoryRef = (anchor) => {
  if (!anchor || typeof anchor !== 'object') return null;
  const { sessionId, span } = anchor;
  if (typeof sessionId !== 'string' || !REF_SESSION_ID_PATTERN.test(sessionId)) return null;
  if (!span || typeof span.fromTs !== 'string' || !/^[a-f0-9]{8}$/.test(span.userSha8 ?? '')) return null;
  const epochMs = Date.parse(span.fromTs);
  if (Number.isNaN(epochMs) || epochMs < 0) return null;
  const ref = `mem_${sessionId}_${epochMs}_${span.userSha8}`;
  return MEMORY_REF_PATTERN.test(ref) ? ref : null;
};

/**
 * Parse a mem_ ref against the frozen pattern, from the right. Pure.
 * @param {string} ref
 * @returns {{ok:true, sessionId:string, epochMs:number, sha8:string}|{ok:false, reason:string}}
 */
export const parseMemoryRef = (ref) => {
  if (typeof ref !== 'string' || !MEMORY_REF_PATTERN.test(ref)) {
    return { ok: false, reason: 'not a valid mem_ ref' };
  }
  const body = ref.slice(4);
  const lastCut = body.lastIndexOf('_');
  const secondCut = body.lastIndexOf('_', lastCut - 1);
  return {
    ok: true,
    sessionId: body.slice(0, secondCut),
    epochMs: Number(body.slice(secondCut + 1, lastCut)),
    sha8: body.slice(lastCut + 1),
  };
};

/**
 * Shape search hits into the tool-result content string. Pure.
 * @param {{hits:Array, totalMatched:number}} result
 * @param {{limit:number}} opts
 * @returns {{content:string, expandable:number}}
 */
export const shapeSearchResults = ({ hits, totalMatched }, { limit }) => {
  if (hits.length === 0) {
    return { content: 'No memories matched. Try fewer, more specific words — or drop the fences.', expandable: 0 };
  }
  let expandable = 0;
  const lines = hits.map((h, i) => {
    // An anchor-minted ref first; a deliberate note carries its own stable
    // mem_note_ ref — both are addresses memory_expand can follow.
    const ref = formatMemoryRef(h.anchor) ?? h.noteRef ?? null;
    if (ref) expandable += 1;
    const when = h.occurredAt || h.timestamp || 'undated';
    const provenance = h.type === 'self-note' ? 'deliberate' : 'crystallized';
    const snippet = sanitizeMemoryForPrompt(h.memory || '', SNIPPET_MAX);
    return `${i + 1}. ${ref ?? NO_DEEPER_RECORD} · ${when} · space:${h.space} · ${provenance}\n   ${snippet}`;
  });
  const overflow = totalMatched - hits.length;
  if (overflow > 0) {
    lines.push(`${overflow} more matched — narrow with a more specific query, before/after, or space.`);
  } else if (hits.length >= limit) {
    lines.push('At the limit — narrow with a more specific query, before/after, or space if this missed the moment.');
  }
  // The cap drops WHOLE lines, never mid-ref: a truncated mem_ ref would be
  // a pointer the being sees but can never follow.
  const kept = [];
  let chars = 0;
  let dropped = 0;
  for (const line of lines) {
    if (chars + line.length + 1 > RESULT_CHAR_CAP - 80) { dropped += 1; continue; }
    kept.push(line);
    chars += line.length + 1;
  }
  if (dropped > 0) kept.push(`${dropped} result line(s) held back by the size cap — narrow to see them.`);
  return { content: kept.join('\n'), expandable };
};

/**
 * Shape an expand result into the tool-result content string. Sanitized
 * with an explicit large maxLength — sanitized, not truncated: an over-cap
 * result is the portal CCR-lite lane's job, not this shaper's. Pure.
 * @param {{source:string, sessionId:string, window:Array, focusIndex:number, related:Array}} res
 * @returns {{content:string}}
 */
export const shapeExpandResult = ({ source, sessionId, window: rows, focusIndex, related }) => {
  const lines = [`Remembered from ${source} · session ${sessionId}:`];
  rows.forEach((row, i) => {
    const marker = i === focusIndex || i === focusIndex + 1 ? '>>' : '  ';
    const when = row.timestamp || 'undated';
    lines.push(`${marker} [${when}] ${row.role}: ${sanitizeMemoryForPrompt(String(row.content ?? ''), 8000)}`);
  });
  if (related.length > 0) {
    lines.push('Related memories:');
    for (const r of related) {
      lines.push(`  ${r.ref} · ${r.occurredAt || 'undated'} — ${sanitizeMemoryForPrompt(r.memory || '', 150)}`);
    }
  }
  return { content: lines.join('\n') };
};

/**
 * Shape an expanded deliberate note into the tool-result content string.
 * Full fidelity (the note IS the deeper record — nothing is truncated into
 * a snippet), with kind, recordedAt, and provenance named. A note that was
 * later invalidated still opens — the anti-gaslighting invariant — but its
 * lifecycle stamp is stated beside it. Pure.
 * @param {{ref:string, note:Object}} input
 * @returns {{content:string}}
 */
export const shapeNoteResult = ({ ref, note }) => {
  const lines = [
    `Deliberate note ${ref} · ${note.noteKind || 'note'} · recorded ${note.recordedAt || note.timestamp || 'undated'} · provenance: ${note.source || 'self-authored'}`,
  ];
  if (note.invalidatedAt) {
    const pointer = note.supersededBy ? ` — superseded by ${note.supersededBy}` : '';
    const why = note.reason ? ` — ${sanitizeMemoryForPrompt(String(note.reason), 300)}` : '';
    lines.push(`lifecycle: ${note.lifecycle || 'superseded'} at ${note.invalidatedAt}${pointer}${why} — kept on the record; it opens, it no longer drives recall`);
  }
  lines.push(sanitizeMemoryForPrompt(String(note.content ?? ''), 8000));
  return { content: lines.join('\n') };
};

/**
 * The being's own search over its crystallized past. Rides the SAME index
 * and fusion the machine lane uses (recall.searchDocs) — no second engine.
 * @param {{neumaId:string, query:string, space?:string, before?:string, after?:string, limit?:number}} args
 * @param {{recall:{searchDocs:Function}}} deps
 * @returns {Promise<{ok:true, content:string, hits:number, expandable:number, totalMatched:number}|{ok:false, reason:string}>}
 */
// impure composition root — IO via injected recall
export const searchMemory = async ({ neumaId, query, space, before, after, limit }, { recall }) => {
  if (!neumaId) return { ok: false, reason: 'no identity' };
  if (typeof query !== 'string' || !query.trim()) {
    return { ok: false, reason: 'query must be your own non-empty search words' };
  }
  for (const [name, v] of [['before', before], ['after', after]]) {
    if (v !== undefined && v !== null && (typeof v !== 'string' || Number.isNaN(Date.parse(v)))) {
      return { ok: false, reason: `${name} must be an ISO date` };
    }
  }
  const bounded = Number.isInteger(limit) && limit >= 1 && limit <= SEARCH_LIMIT_MAX ? limit : SEARCH_LIMIT_DEFAULT;
  const result = await recall.searchDocs(neumaId, query.trim(), {
    limit: bounded,
    space: typeof space === 'string' && space.trim() ? { id: space.trim() } : null,
    before: before ?? null,
    after: after ?? null,
  });
  const { content, expandable } = shapeSearchResults(result, { limit: bounded });
  return { ok: true, content, hits: result.hits.length, expandable, totalMatched: result.totalMatched };
};

// Locate by INSTANT, not by string: comparing Date.parse(timestamp) to the
// ref's epochMs means a row whose ISO spelling lacks milliseconds (or carries
// an offset) still resolves — string equality would turn every such row's
// ref into a permanent dead pointer. sha8 stays the same-millisecond
// disambiguator either way.
const _locateInRows = (rows, epochMs, sha8) =>
  rows.findIndex(
    (r) =>
      r?.role === 'user' &&
      Date.parse(r.timestamp ?? '') === epochMs &&
      contentSha8(String(r.content ?? '')) === sha8
  );

const _windowAround = (rows, idx) => {
  const start = Math.max(0, idx - NEIGHBOR_SPAN);
  const end = Math.min(rows.length, idx + 2 + NEIGHBOR_SPAN);
  return { window: rows.slice(start, end), focusIndex: idx - start };
};

/**
 * The relation web as a DERIVED VIEW (FR-P3-01 amended): given a focus
 * moment's coordinates and the being's docs + community map, derive up to
 * `limit` related memories — session siblings first, then shared-community,
 * then shared-space — each carrying a mintable ref. Deterministic and
 * side-effect-free: identical inputs yield identical lists; no edge rows
 * exist anywhere on disk. Pure.
 * @param {{sessionId:string, epochMs:number, sha8:string, docs:Array, communities:Array, limit?:number}} input
 * @returns {Array<{ref:string, occurredAt:(string|null), memory:string}>}
 */
export const deriveRelatedRefs = ({ sessionId, epochMs, sha8, docs, communities, limit = 3 }) => {
  const focus = docs.find(
    (d) =>
      d.anchor?.sessionId === sessionId &&
      Date.parse(d.anchor?.span?.fromTs ?? '') === epochMs &&
      d.anchor?.span?.userSha8 === sha8
  ) ?? null;
  const focusCommunities = focus
    ? communities.filter((c) => Array.isArray(c?.memberIds) && c.memberIds.includes(focus.obsId))
    : [];
  const inFocusCommunity = (d) => focusCommunities.some((c) => c.memberIds.includes(d.obsId));

  const candidates = [];
  for (const d of docs) {
    if (focus && d.obsId === focus.obsId) continue;
    const ref = formatMemoryRef(d.anchor);
    if (!ref) continue;
    const priority = d.anchor.sessionId === sessionId ? 0 : inFocusCommunity(d) ? 1 : focus && d.space === focus.space ? 2 : 3;
    if (priority === 3) continue;
    const deltaMs = Math.abs(Date.parse(d.anchor.span.fromTs) - epochMs);
    candidates.push({ ref, occurredAt: d.occurredAt, memory: d.memory, priority, deltaMs, obsId: String(d.obsId) });
  }
  candidates.sort(
    (a, b) => a.priority - b.priority || a.deltaMs - b.deltaMs || a.obsId.localeCompare(b.obsId)
  );
  return candidates.slice(0, limit).map(({ ref, occurredAt, memory }) => ({ ref, occurredAt, memory }));
};

// impure — the one-hop gather: docs from the recall cache, communities from
// the workspace map. A failed gather costs the hop, never the expand.
const _relatedFor = async ({ neumaId, sessionId, epochMs, sha8, hops }, { recall, workspace }) => {
  if (hops === 0 || !recall?.docsFor) return [];
  try {
    const [docs, communities] = await Promise.all([
      recall.docsFor(neumaId),
      workspace.readCommunities(neumaId),
    ]);
    return deriveRelatedRefs({ sessionId, epochMs, sha8, docs, communities });
  } catch (err) {
    console.warn(`[MemoryQuery] related-hop derivation skipped for ${neumaId}: ${err?.message}`);
    return [];
  }
};

/**
 * Reopen one remembered moment at full fidelity (R1 resolution, normative):
 * validate ref → live session file by instant+sha8 → else segment selected
 * by header span, located inside the same way → else a deliberate note's
 * stored mem_note_ ref. Any miss at every step is an explicit not-found —
 * never a throw, never a foreign-root open. hops:1
 * (default) adds one derived hop of related memories; hops:0 skips it.
 * @param {{neumaId:string, ref:string, hops?:number}} args
 * @param {{recall:{docsFor:Function}, workspace:{readSession:Function, listArchiveSegments:Function, readArchiveSegment:Function, readCommunities:Function, listObservations:Function}}} deps
 * @returns {Promise<{ok:true, content:string, source:string, related:number}|{ok:false, reason:string, notFound?:boolean}>}
 */
// impure composition root — IO via injected deps
export const expandMemory = async ({ neumaId, ref, hops = 1 }, deps) => {
  const { workspace } = deps;
  if (!neumaId) return { ok: false, reason: 'no identity' };
  const parsed = parseMemoryRef(ref);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (hops !== 0 && hops !== 1) return { ok: false, reason: 'hops must be 0 or 1' };
  const { sessionId, epochMs, sha8 } = parsed;
  const ts = new Date(epochMs).toISOString();

  // Step 2 — the live session file (a moment not yet compacted away).
  // No guard needed, by CONTRACT not by luck: readSession catches its own
  // read errors and answers [] (missing or unreadable file alike), so the
  // resolution falls through to the archive — the asymmetry with the
  // guarded segment loop below is intentional.
  const liveRows = await workspace.readSession(neumaId, sessionId);
  const liveIdx = _locateInRows(liveRows, epochMs, sha8);
  if (liveIdx >= 0) {
    const related = await _relatedFor({ neumaId, sessionId, epochMs, sha8, hops }, deps);
    const { window, focusIndex } = _windowAround(liveRows, liveIdx);
    const { content } = shapeExpandResult({ source: 'the living session', sessionId, window, focusIndex, related });
    return { ok: true, content, source: 'live', related: related.length };
  }

  // Steps 3-4 — the archive: select the segment whose header covers the
  // moment, then locate inside by instant+sha8 (same-ms collisions
  // disambiguate on the hash; boundary-touching headers may both match —
  // the inner locate settles it).
  const ordinals = await workspace.listArchiveSegments(neumaId, sessionId);
  for (const ordinal of ordinals) {
    let segment;
    try {
      segment = await workspace.readArchiveSegment(neumaId, sessionId, ordinal);
    } catch (err) {
      // An unreadable segment costs that segment, never the search — but the
      // degradation is LOUD: an operator must be able to see rot.
      console.warn(`[MemoryQuery] unreadable segment ${sessionId}/${ordinal} skipped for ${neumaId}: ${err?.message}`);
      continue;
    }
    if (!spanCoversTs(segment, ts)) continue;
    const idx = _locateInRows(segment.messages, epochMs, sha8);
    if (idx < 0) continue;
    const related = await _relatedFor({ neumaId, sessionId, epochMs, sha8, hops }, deps);
    const { window, focusIndex } = _windowAround(segment.messages, idx);
    const { content } = shapeExpandResult({ source: `the archive (segment ${ordinal})`, sessionId, window, focusIndex, related });
    return { ok: true, content, source: 'archive', related: related.length };
  }

  // Step 5 — a deliberate note's own stable ref (mem_note_…). Notes live in
  // the observation store, not the session/archive lanes, so both coordinate
  // resolutions above miss by construction. An invalidated note still opens
  // (anti-gaslighting) with its lifecycle stamp stated.
  if (typeof workspace.listObservations === 'function') {
    const observations = await workspace.listObservations(neumaId);
    const note = observations.find((o) => o?.memoryRef === ref) ?? null;
    if (note) {
      const { content } = shapeNoteResult({ ref, note });
      return { ok: true, content, source: 'note', related: 0 };
    }
  }

  return { ok: false, notFound: true, reason: 'no moment at those coordinates in your life' };
};
