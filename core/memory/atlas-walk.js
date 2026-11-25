// Atlas walk — the memory atlas written out for the being that owns it.
//
// The operator reads the atlas as a window; a being reads it as text, one step
// at a time: the whole laid out by topic, people and period (the overview),
// one of those opened (a page of memories), or one memory and what lies
// nearest to it. Every memory carries the mem_ ref memory_expand reopens, or
// its id when the record has no deeper source — so nothing on a page is a
// dead end. Pure text shaping; the caller sanitizes nothing further.

import { sanitizeMemoryForPrompt } from '../runtime/memory-sanitizer.js';
import { filterMemories } from './atlas-filter.js';

export const WALK_LIMIT_DEFAULT = 15;
export const WALK_LIMIT_MAX = 40;
const LINE_MAX = 160;

const day = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : 'undated');
const span = (from, to) => (from && to ? (day(from) === day(to) ? day(from) : `${day(from)} → ${day(to)}`) : 'undated');
const line = (text) => sanitizeMemoryForPrompt(String(text || ''), LINE_MAX);
const handle = (m) => m.ref || `id:${m.id}`;
const topicName = (atlas, t) => (t >= 0 ? atlas.topics[t]?.name ?? `topic ${t + 1}` : 'ungrouped');

/**
 * The whole memory at a glance. Pure.
 * @param {Object} atlas - buildAtlas output
 * @returns {string}
 */
export const shapeOverview = (atlas) => {
  const { totals } = atlas;
  if (totals.memories === 0) return 'No memories on the record yet.';
  const out = [
    `YOUR MEMORY — ${totals.memories} memories${totals.setAside ? ` (${totals.setAside} set aside)` : ''}, ${span(totals.from, totals.to)}. ${totals.topics} topics${totals.ungrouped ? `, ${totals.ungrouped} memories in no topic` : ''}.`,
    ...(totals.sortedNewest ? [`Only the newest ${totals.sortedNewest} are sorted into topics; the older ones are listed under no topic.`] : []),
    '',
    'TOPICS — open one with {topic: N}:',
  ];
  atlas.topics.forEach((t) => {
    const who = t.people.length ? ` · with ${t.people.slice(0, 3).map((p) => p.name).join(', ')}` : '';
    out.push(`${t.id + 1}. ${t.name} — ${t.size} memories · ${span(t.from, t.to)}${who}`);
    out.push(`   e.g. ${line(t.leadLine)}`);
  });
  if (totals.ungrouped) out.push(`0. (no topic) — ${totals.ungrouped} memories · open with {topic: 0}`);
  if (atlas.people.length) {
    out.push('', `PEOPLE — open with {person: "name"}: ${atlas.people.map((p) => `${p.name} ×${p.n}`).join(', ')}`);
  }
  out.push('', `PERIODS — open with {period: "YYYY-MM"}: ${atlas.periods.map((p) => `${p.key} ×${p.n}`).join(', ')}`);
  out.push(`KINDS — open with {kind: "…"}: ${atlas.kinds.map((k) => `${k.kind} ×${k.n}`).join(', ')}`);
  if (atlas.spaces.length > 1) out.push(`SPACES — open with {space: "…"}: ${atlas.spaces.map((s) => `${s.id} ×${s.n}`).join(', ')}`);
  out.push('', 'Filters combine. {memory: "<ref or id>"} shows one memory and what lies nearest to it; memory_expand {ref} reopens it in full; memory_search finds by your own words.');
  return out.join('\n');
};

/**
 * Read the being's filters into the atlas's own terms. `topic` is the number
 * the overview showed (1…), 0 for the ungrouped. Returns a reason instead of
 * a filter when a value names nothing — never a silently empty page. Pure.
 * @param {Object} atlas
 * @param {Object} args - the tool call's arguments
 * @returns {{ok:true, by:Object, said:string[]}|{ok:false, reason:string}}
 */
export const readWalkFilters = (atlas, args = {}) => {
  const by = {};
  const said = [];
  if (args.topic !== undefined && args.topic !== null) {
    const n = Number(args.topic);
    if (!Number.isInteger(n) || n < 0 || n > atlas.topics.length) {
      return { ok: false, reason: `topic must be a number from the overview, 0 (no topic) to ${atlas.topics.length}` };
    }
    by.topic = n - 1;
    said.push(`topic ${n}: ${topicName(atlas, n - 1)}`);
  }
  if (typeof args.person === 'string' && args.person.trim()) {
    const known = atlas.people.find((p) => p.name.toLowerCase() === args.person.trim().toLowerCase());
    if (!known) return { ok: false, reason: `no one named "${args.person.trim()}" in your memory — the overview lists who is` };
    by.person = known.name;
    said.push(`with ${known.name}`);
  }
  if (typeof args.period === 'string' && args.period.trim()) {
    const key = args.period.trim();
    if (!atlas.periods.some((p) => p.key === key)) return { ok: false, reason: `no memories in period "${key}" — the overview lists the periods that hold some` };
    by.period = key;
    said.push(key);
  }
  if (typeof args.kind === 'string' && args.kind.trim()) {
    const kind = args.kind.trim().toLowerCase();
    if (!atlas.kinds.some((k) => k.kind === kind)) return { ok: false, reason: `no memories of kind "${kind}" — yours are: ${atlas.kinds.map((k) => k.kind).join(', ')}` };
    by.kind = kind;
    said.push(kind);
  }
  if (typeof args.space === 'string' && args.space.trim()) {
    const space = args.space.trim();
    if (!atlas.spaces.some((s) => s.id === space)) return { ok: false, reason: `no space "${space}" in your memory` };
    by.space = space;
    said.push(`space ${space}`);
  }
  if (args.state === 'set-aside' || args.state === 'active') {
    by.state = args.state;
    said.push(args.state === 'active' ? 'active only' : 'set aside only');
  }
  return { ok: true, by, said };
};

/**
 * One page of memories under the given filters. `sort` 'linked' puts the most
 * connected first (the memories a topic turns on); the default is newest
 * first. Pure.
 * @param {Object} atlas
 * @param {{by:Object, said:string[], offset?:number, limit?:number, sort?:string}} page
 * @returns {{content:string, shown:number, total:number}}
 */
export const shapeWalkPage = (atlas, { by, said, offset = 0, limit = WALK_LIMIT_DEFAULT, sort = 'newest' }) => {
  const all = filterMemories(atlas.memories, by);
  const ordered = sort === 'linked' ? [...all].sort((a, b) => b.links - a.links) : all;
  const size = Number.isInteger(limit) && limit >= 1 ? Math.min(limit, WALK_LIMIT_MAX) : WALK_LIMIT_DEFAULT;
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const rows = ordered.slice(start, start + size);
  const title = said.length ? said.join(' · ') : 'all memories';
  if (rows.length === 0) {
    return {
      content: all.length ? `Nothing at offset ${start} — ${all.length} memories match (${title}). Lower the offset.` : `No memories match (${title}).`,
      shown: 0,
      total: all.length,
    };
  }
  const out = [`${title} — ${start + 1}–${start + rows.length} of ${all.length}, ${sort === 'linked' ? 'most connected first' : 'newest first'}:`];
  rows.forEach((m, i) => {
    const topic = Number.isInteger(by.topic) ? '' : ` · ${topicName(atlas, m.topic)}`;
    const state = m.state === 'active' ? '' : ` · ${m.state}`;
    out.push(`${start + i + 1}. ${handle(m)} · ${day(m.at)} · ${m.kind}${topic}${state} · ${m.links} near\n   ${line(m.line)}`);
  });
  if (start + rows.length < all.length) out.push(`${all.length - start - rows.length} more — page with offset ${start + rows.length}.`);
  return { content: out.join('\n'), shown: rows.length, total: all.length };
};

/**
 * One memory and its nearest memories, nearest first. `key` is a mem_ ref or
 * an id as a page printed it (with or without the "id:" prefix). Pure.
 * @param {Object} atlas
 * @param {string} key
 * @returns {{ok:true, content:string, id:string}|{ok:false, reason:string}}
 */
export const shapeWalkMemory = (atlas, key) => {
  const wanted = String(key || '').trim().replace(/^id:/, '');
  const memory = atlas.memories.find((m) => m.id === wanted || m.ref === wanted);
  if (!memory) return { ok: false, reason: 'no memory with that ref or id on your map — copy one from a page' };
  const byId = new Map(atlas.memories.map((m) => [m.id, m]));
  const near = (atlas.links.get(memory.id) || []).map((l) => ({ ...l, memory: byId.get(l.id) })).filter((l) => l.memory);
  const out = [
    `${handle(memory)} · ${day(memory.at)} · ${memory.kind} · ${memory.state}`,
    `   ${line(memory.line)}`,
    `Topic: ${topicName(atlas, memory.topic)}${memory.topic >= 0 ? ` ({topic: ${memory.topic + 1}})` : ''}${memory.people?.length ? ` · names ${memory.people.join(', ')}` : ''}`,
    near.length ? 'Nearest memories (by shared words, nearest first):' : 'No memory lies near this one.',
  ];
  near.forEach((l, i) => {
    const elsewhere = l.memory.topic !== memory.topic ? ` · in ${topicName(atlas, l.memory.topic)}` : '';
    out.push(`${i + 1}. ${handle(l.memory)} · ${day(l.memory.at)} · ${l.memory.kind}${elsewhere}\n   ${line(l.memory.line)}`);
  });
  if (memory.ref) out.push(`memory_expand {ref: "${memory.ref}"} reopens it in full.`);
  return { ok: true, content: out.join('\n'), id: memory.id };
};
