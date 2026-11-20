// Memory atlas service — reads one being's memory and lays it out as the atlas
// (core/memory/memory-atlas.js). The one read behind both doors: the
// operator's MEMORY view (REST) and the being's own memory_map tool.
//
// Authorization belongs to the caller: REST applies workspace ownership; the
// tool takes the lane from the connection, never from an argument.

import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { buildAtlas } from '../../core/memory/memory-atlas.js';
import { observationToText } from '../../core/memory/recall-docs.js';
import { knownPresencesFor, mentionsIn } from '../../core/memory/mind-graph.js';
import { normalizeSpace } from '../../core/memory/space.js';
import {
  nodeObservationRef, observationLifecycle, observationProvenance, readNodeSource,
} from './context-map.js';

const LINE_MAX = 200;
export const ATLAS_SEARCH_MAX_WORDS = 12;

// Who spoke an exchange's first words (the row's origin): the operator unless
// another chat or the platform did — the same reading recall-docs.js gives.
const VOICE_BY_ORIGIN = Object.freeze({
  link: 'housemate', resume: 'platform', unacted: 'platform', watch: 'platform', wake: 'platform', hold: 'platform',
});

/**
 * What kind of memory a record is, in the words the map shows. Pure.
 * @param {Object} obs
 * @returns {string} conversation | housemate | platform | note | fact | identity | <type>
 */
export const kindOf = (obs) => {
  if (obs?.type === 'exchange') return VOICE_BY_ORIGIN[obs.origin] || 'conversation';
  if (obs?.type === 'self-note') return typeof obs.noteKind === 'string' && obs.noteKind ? obs.noteKind : 'note';
  return typeof obs?.type === 'string' && obs.type ? obs.type : 'other';
};

/**
 * The one line a memory is listed by: what was said to the being when it was
 * an exchange, else the start of its own words. Whitespace folded, bounded. Pure.
 * @param {Object} obs
 * @returns {string}
 */
export const lineOf = (obs) => {
  const first = obs?.type === 'exchange' && typeof obs.userMessage === 'string' && obs.userMessage.trim()
    ? obs.userMessage
    : observationToText(obs);
  return Array.from(String(first || '').replace(/\s+/g, ' ').trim()).slice(0, LINE_MAX).join('');
};

// One atlas per lane, kept until the record changes. The stamp is the whole
// record's shape — how many memories, the newest one, how many are set aside —
// so a new memory, or one superseded, rebuilds it.
const held = new Map();
const stampOf = (observations) =>
  `${observations.length}:${observations[0]?.id ?? ''}:${observations.reduce((n, o) => n + (o?.invalidatedAt ? 1 : 0), 0)}`;

// impure — reads the lane's observations and its known presences.
const _load = async (laneId) => {
  const observations = (await neumaWorkspace.listObservations(laneId)).filter((o) => o && typeof o === 'object' && o.id);
  const stamp = stampOf(observations);
  const kept = held.get(laneId);
  if (kept?.stamp === stamp) return kept;
  const known = await knownPresencesFor(laneId).catch(() => []);
  const texts = new Map();
  const byId = new Map();
  const records = observations.map((obs) => {
    const text = observationToText(obs);
    texts.set(obs.id, text.toLowerCase());
    byId.set(obs.id, obs);
    return {
      id: obs.id,
      text,
      line: lineOf(obs),
      at: obs.occurredAt || obs.recordedAt || obs.timestamp || null,
      kind: kindOf(obs),
      state: observationLifecycle(obs).state,
      ref: nodeObservationRef(obs),
      space: normalizeSpace(obs.space).id,
      people: mentionsIn(text, known).map((presence) => presence.name),
    };
  });
  const entry = {
    stamp, atlas: buildAtlas(records), texts, byId, known, computedAt: new Date().toISOString(),
  };
  held.set(laneId, entry);
  return entry;
};

/**
 * The atlas as the being's tool walks it — the full object, links included. impure.
 * @param {string} laneId
 * @returns {Promise<Object>}
 */
export const readMemoryAtlas = async (laneId) => (await _load(laneId)).atlas;

/**
 * The atlas as it crosses the wire to the operator's view: everything but the
 * per-memory neighbour lists (those ride with the one memory that is opened). impure.
 * @param {string} laneId
 * @returns {Promise<Object>}
 */
export const readMemoryAtlasPage = async (laneId) => {
  const { atlas, known, computedAt } = await _load(laneId);
  const kinds = new Map(known.map((presence) => [presence.name.toLowerCase(), presence.kind]));
  return {
    totals: atlas.totals,
    topics: atlas.topics,
    people: atlas.people.map((p) => ({ ...p, kind: kinds.get(p.name.toLowerCase()) || 'contact' })),
    periods: atlas.periods,
    kinds: atlas.kinds,
    spaces: atlas.spaces,
    memories: atlas.memories,
    ties: atlas.ties,
    computedAt,
  };
};

/**
 * Which memories hold every one of the given words (anywhere in their text,
 * set-aside ones included), as ids. A plain, complete match — the operator's
 * search must never rank a memory out of sight. impure.
 * @param {string} laneId
 * @param {string} query
 * @returns {Promise<{ok:true, ids:string[], words:string[]}|{ok:false, reason:string}>}
 */
export const searchMemoryAtlas = async (laneId, query) => {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { ok: false, reason: 'search needs at least one word' };
  if (words.length > ATLAS_SEARCH_MAX_WORDS) return { ok: false, reason: `search takes at most ${ATLAS_SEARCH_MAX_WORDS} words` };
  const { atlas, texts } = await _load(laneId);
  const ids = atlas.memories
    .filter((m) => { const text = texts.get(m.id) || ''; return words.every((w) => text.includes(w)); })
    .map((m) => m.id);
  return { ok: true, ids, words };
};

/**
 * One memory opened: its place on the atlas, where it came from, its nearest
 * memories, and its source at full fidelity where one honestly exists. impure.
 * @param {string} laneId
 * @param {string} memoryId
 * @returns {Promise<{ok:true, memory:Object, topic:(Object|null), provenance:Object, recordedAt:(string|null),
 *   lifecycle:Object, near:Array, source:Object}|{ok:false, reason:string}>}
 */
export const readAtlasMemory = async (laneId, memoryId) => {
  const { atlas, byId } = await _load(laneId);
  const memory = atlas.memories.find((m) => m.id === memoryId);
  const obs = byId.get(memoryId);
  if (!memory || !obs) return { ok: false, reason: 'no memory with that id' };
  const listed = new Map(atlas.memories.map((m) => [m.id, m]));
  const near = (atlas.links.get(memoryId) || [])
    .map((link) => ({ ...listed.get(link.id), w: link.w }))
    .filter((m) => m.id);
  const topic = memory.topic >= 0 ? atlas.topics[memory.topic] : null;
  return {
    ok: true,
    memory,
    topic: topic ? { id: topic.id, name: topic.name } : null,
    provenance: observationProvenance(obs),
    recordedAt: obs.recordedAt ?? obs.timestamp ?? null,
    lifecycle: observationLifecycle(obs),
    near,
    source: await readNodeSource(laneId, obs, memory.ref),
  };
};
