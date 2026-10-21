/**
 * Memory lifecycle (Phase 3, granular sovereign memory).
 *
 * A being's deliberate notes carry stable `mem_note_<epochMs>_<sha8>` refs
 * from the moment they are written, and the being can move its own record
 * through an auditable lifecycle: supersede (replace, old record kept),
 * retract, merge (many notes into one canonical), archive. Nothing is ever
 * deleted — every mutation is an invalidation stamp on the retained record
 * (the anti-gaslighting invariant), and listMemories is the audit surface
 * that shows active and lifecycle-stamped entries side by side.
 *
 * Pure cores (mint, lifecycle read, ref matching, list shaping) + impure
 * composition roots with IO dependencies injected ({ workspace }) — the
 * same shape as memory-query.js.
 */

import { contentSha8 } from '../workspace/archive-codec.js';
import { formatMemoryRef, MEMORY_REF_PATTERN } from './memory-query.js';
import { sanitizeMemoryForPrompt } from '../runtime/memory-sanitizer.js';
import { observationToMemory } from './neuma-recall.js';

export const LIST_LIMIT_DEFAULT = 10;
export const LIST_LIMIT_MAX = 25;
export const MERGE_MIN = 2;
export const MERGE_MAX = 10;
const SNIPPET_MAX = 140;

/**
 * Mint a deliberate note's stable ref. `mem_note_<epochMs>_<sha8>` matches
 * the frozen MEMORY_REF_PATTERN grammar, so notes pin, expand, and resolve
 * through the same lanes as anchor-minted refs. Pure.
 * @param {string} content - The note's full content (hashed into the ref)
 * @param {number} [epochMs] - Mint instant (default: now)
 * @returns {string}
 */
export const mintNoteRef = (content, epochMs = Date.now()) =>
  `mem_note_${epochMs}_${contentSha8(content)}`;

/**
 * The lifecycle state of one observation record: active until invalidated,
 * then its stamped lifecycle ('superseded'|'retracted'|'archived'); records
 * invalidated before lifecycle stamps existed read as superseded. Pure.
 * @param {{invalidatedAt?:(string|null), lifecycle?:(string|null)}} obs
 * @returns {'active'|'superseded'|'retracted'|'archived'}
 */
export const lifecycleOf = (obs) => (!obs?.invalidatedAt ? 'active' : obs.lifecycle || 'superseded');

/**
 * The addressable ref of one observation: its anchor-minted ref where the
 * anchor exists, else its stored deliberate-note ref, else null (a
 * pre-archive exchange no ref can reach). Pure.
 * @param {{anchor?:Object, memoryRef?:(string|null)}} obs
 * @returns {string|null}
 */
export const refForObservation = (obs) => formatMemoryRef(obs?.anchor) ?? obs?.memoryRef ?? null;

// A ref addresses an observation through EITHER minting lane — the
// anchor's content-time coordinates or the note's stored ref.
const _matchesRef = (obs, ref) => obs?.memoryRef === ref || formatMemoryRef(obs?.anchor) === ref;

/**
 * Resolve a mem_ ref to the being's own observation record. Not-found is an
 * explicit refusal — never a throw, never a foreign root (resolution runs
 * strictly under the caller-supplied neumaId).
 * @param {{neumaId:string, ref:string}} args
 * @param {{workspace:{listObservations:Function}}} deps
 * @returns {Promise<{ok:true, observation:Object}|{ok:false, reason:string}>}
 */
// impure composition root — IO via injected workspace
const resolveRefToObservation = async ({ neumaId, ref }, { workspace }) => {
  if (!neumaId) return { ok: false, reason: 'no identity' };
  if (typeof ref !== 'string' || !MEMORY_REF_PATTERN.test(ref)) {
    return { ok: false, reason: 'not a valid mem_ ref' };
  }
  const observations = await workspace.listObservations(neumaId);
  const observation = observations.find((o) => _matchesRef(o, ref)) ?? null;
  if (!observation) return { ok: false, reason: 'no memory at that ref in your life' };
  return { ok: true, observation };
};

// impure — write one deliberate note with its stable ref (the same record
// shape memory_note lands: the deliberate act IS the significance).
const _writeNote = async ({ neumaId, content, kind }, { workspace }) => {
  const memoryRef = mintNoteRef(content);
  const record = await workspace.addObservation(neumaId, {
    type: 'self-note',
    content,
    noteKind: kind,
    significance: 0.9,
    source: 'self-authored',
    memoryRef,
  });
  return { record, ref: memoryRef };
};

// impure — land one lifecycle stamp. False when no record answered at that
// id (its file is gone, or named differently from its id), so the act refuses
// instead of reporting a stamp that never landed.
const _stamp = async ({ neumaId, id, stamp }, { workspace }) =>
  (await workspace.invalidateObservation(neumaId, id, stamp)) !== null;

/**
 * Replace one memory with a new deliberate note: the replacement is written
 * first (so a failed write never strands the record), then the old record
 * is stamped superseded with a pointer to its successor.
 * @param {{neumaId:string, ref:string, content:string, kind:string}} args
 * @param {{workspace:Object}} deps
 * @returns {Promise<{ok:true, ref:string, id:string, superseded:string}|{ok:false, reason:string}>}
 */
// impure composition root — IO via injected workspace
export const supersedeMemory = async ({ neumaId, ref, content, kind }, deps) => {
  const found = await resolveRefToObservation({ neumaId, ref }, deps);
  if (!found.ok) return found;
  const { record, ref: newRef } = await _writeNote({ neumaId, content, kind }, deps);
  const stamped = await _stamp({
    neumaId,
    id: found.observation.id,
    stamp: { supersededBy: record.id, lifecycle: 'superseded' },
  }, deps);
  if (!stamped) {
    return { ok: false, reason: `the new note landed as ${newRef}, but ${ref} could not be marked superseded and still stands` };
  }
  return { ok: true, ref: newRef, id: record.id, superseded: ref };
};

/**
 * Withdraw one memory from recall: stamped retracted with the being's
 * stated reason, retained on disk (it still opens by ref — it no longer
 * drives recall).
 * @param {{neumaId:string, ref:string, reason?:(string|null)}} args
 * @param {{workspace:Object}} deps
 * @returns {Promise<{ok:true, id:string}|{ok:false, reason:string}>}
 */
// impure composition root — IO via injected workspace
export const retractMemory = async ({ neumaId, ref, reason = null }, deps) => {
  const found = await resolveRefToObservation({ neumaId, ref }, deps);
  if (!found.ok) return found;
  const stamped = await _stamp({
    neumaId, id: found.observation.id, stamp: { lifecycle: 'retracted', reason },
  }, deps);
  if (!stamped) return { ok: false, reason: 'that memory could not be updated' };
  return { ok: true, id: found.observation.id };
};

/**
 * Fold several memories into one canonical note: every source ref must
 * resolve (duplicates and unknowns refuse BEFORE anything is written), the
 * canonical note lands, and each source is stamped superseded with a
 * pointer to it.
 * @param {{neumaId:string, refs:Array<string>, content:string, kind:string}} args
 * @param {{workspace:Object}} deps
 * @returns {Promise<{ok:true, ref:string, id:string, merged:Array<string>}|{ok:false, reason:string}>}
 */
// impure composition root — IO via injected workspace
export const mergeMemories = async ({ neumaId, refs, content, kind }, deps) => {
  if (!Array.isArray(refs) || refs.length < MERGE_MIN || refs.length > MERGE_MAX) {
    return { ok: false, reason: `a merge takes ${MERGE_MIN}..${MERGE_MAX} refs` };
  }
  if (new Set(refs).size !== refs.length) {
    return { ok: false, reason: 'each ref may appear only once in a merge' };
  }
  const resolved = [];
  for (const ref of refs) {
    const found = await resolveRefToObservation({ neumaId, ref }, deps);
    if (!found.ok) return { ok: false, reason: `${ref}: ${found.reason}` };
    resolved.push(found.observation);
  }
  const { record, ref: newRef } = await _writeNote({ neumaId, content, kind }, deps);
  const unstamped = [];
  for (const [i, obs] of resolved.entries()) {
    const stamped = await _stamp({
      neumaId,
      id: obs.id,
      stamp: { supersededBy: record.id, lifecycle: 'superseded', reason: `merged into ${newRef}` },
    }, deps);
    if (!stamped) unstamped.push(refs[i]);
  }
  if (unstamped.length > 0) {
    return { ok: false, reason: `the canonical note landed as ${newRef}, but ${unstamped.join(', ')} could not be marked superseded and still stand` };
  }
  return { ok: true, ref: newRef, id: record.id, merged: refs };
};

/**
 * Set one memory aside: stamped archived with an optional reason, retained
 * on disk like every lifecycle act.
 * @param {{neumaId:string, ref:string, reason?:(string|null)}} args
 * @param {{workspace:Object}} deps
 * @returns {Promise<{ok:true, id:string}|{ok:false, reason:string}>}
 */
// impure composition root — IO via injected workspace
export const archiveMemory = async ({ neumaId, ref, reason = null }, deps) => {
  const found = await resolveRefToObservation({ neumaId, ref }, deps);
  if (!found.ok) return found;
  const stamped = await _stamp({
    neumaId, id: found.observation.id, stamp: { lifecycle: 'archived', reason },
  }, deps);
  if (!stamped) return { ok: false, reason: 'that memory could not be updated' };
  return { ok: true, id: found.observation.id };
};

/**
 * Shape one list page into the tool-result content string — the audit
 * surface: active and lifecycle-stamped entries side by side, each with
 * ref, provenance, and lifecycle state. Pure.
 * @param {{entries:Array, total:number, start:number}} page
 * @returns {{content:string}}
 */
export const shapeListResult = ({ entries, total, start }) => {
  if (entries.length === 0) {
    return {
      content: total > 0
        ? `Nothing in that window — ${total} memor${total === 1 ? 'y is' : 'ies are'} on the record. Lower the offset.`
        : 'No memories on the record yet.',
    };
  }
  const lines = [`Memories ${start + 1}–${start + entries.length} of ${total} (newest first):`];
  entries.forEach((e, i) => {
    const kind = e.noteKind ? `/${e.noteKind}` : '';
    const pointer = e.supersededBy ? ` → ${e.supersededBy}` : '';
    lines.push(
      `${start + i + 1}. ${e.ref ?? '(no ref)'} · ${e.recordedAt || 'undated'} · ${e.type}${kind} · ${e.source || 'unknown'} · ${e.lifecycle}${pointer}\n   ${e.snippet}`
    );
  });
  if (start + entries.length < total) {
    lines.push(`${total - start - entries.length} older — page with offset ${start + entries.length}.`);
  }
  return { content: lines.join('\n') };
};

/**
 * Enumerate the being's WHOLE memory record — the audit lane: newest-first,
 * offset-paged, invalidated entries INCLUDED (a lifecycle act must stay
 * visible, or the audit surface lies by omission).
 * @param {{neumaId:string, offset?:number, limit?:number, kind?:(string|null)}} args
 * @param {{workspace:{listObservations:Function}}} deps
 * @returns {Promise<{ok:true, content:string, entries:Array, total:number}|{ok:false, reason:string}>}
 */
// impure composition root — IO via injected workspace
export const listMemories = async ({ neumaId, offset = 0, limit = LIST_LIMIT_DEFAULT, kind = null }, { workspace }) => {
  if (!neumaId) return { ok: false, reason: 'no identity' };
  const all = await workspace.listObservations(neumaId); // newest-first
  const filtered = kind ? all.filter((o) => o.noteKind === kind || o.type === kind) : all;
  const bounded = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, LIST_LIMIT_MAX) : LIST_LIMIT_DEFAULT;
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const entries = filtered.slice(start, start + bounded).map((obs) => ({
    ref: refForObservation(obs),
    snippet: sanitizeMemoryForPrompt(observationToMemory(obs), SNIPPET_MAX),
    type: obs.type || 'unknown',
    noteKind: obs.noteKind || null,
    source: obs.source || null,
    lifecycle: lifecycleOf(obs),
    supersededBy: obs.supersededBy || null,
    recordedAt: obs.recordedAt || obs.timestamp || null,
  }));
  const { content } = shapeListResult({ entries, total: filtered.length, start });
  return { ok: true, content, entries, total: filtered.length };
};
