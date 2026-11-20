// Memory atlas — one being's whole memory laid out so it can be walked:
// topics, people, periods, kinds, and every memory with its place among them.
//
// One builder serves both readers. The operator's MEMORY view and the being's
// own memory_map tool are drawn from the same atlas, so what the operator sees
// and what the being navigates are never two different maps.
//
// Pure: records in, a plain frozen-shape object out. Topics come from
// atlas-cluster.js. Nothing here reads a file or the clock.

import { termVectors, nearestNeighbours, louvain, wordsOf } from './atlas-cluster.js';
import { monthOf, timeOf } from './atlas-filter.js';

/** A topic needs at least this many memories; smaller groups read as ungrouped. */
export const TOPIC_MIN = 3;
/** Past this many active memories only the newest are sorted into topics — said, never silent. */
export const ATLAS_SORT_CAP = 6000;
const NAME_PARTS = 3;
const SPARK_BUCKETS = 12;

/**
 * Name one topic by what its memories share and the rest do not: single words
 * and two-word phrases, each scored by how much of the topic says it against
 * how much of everything else does. A term must stand in at least two of the
 * topic's memories (and a tenth of them) — a word said once names nothing,
 * which is where […] came from. Pure.
 * @param {Array<number>} members - doc indexes of the topic
 * @param {Array<Map<string,string>>} termsByDoc - per doc: term → the spelling it was written in
 * @param {Map<string,number>} docFreq - corpus document frequency per term
 * @param {number} size - corpus size
 * @returns {{name:string, words:string[]}}
 */
export const nameTopic = (members, termsByDoc, docFreq, size) => {
  const inTopic = new Map();
  const spellings = new Map();
  for (const i of members) {
    for (const [term, shown] of termsByDoc[i]) {
      inTopic.set(term, (inTopic.get(term) || 0) + 1);
      if (!spellings.has(term)) spellings.set(term, new Map());
      spellings.get(term).set(shown, (spellings.get(term).get(shown) || 0) + 1);
    }
  }
  const support = Math.max(2, Math.ceil(members.length * 0.1));
  const outside = Math.max(1, size - members.length);
  const scored = [...inTopic.entries()]
    .filter(([, n]) => n >= support)
    .map(([term, n]) => {
      const here = n / members.length;
      const elsewhere = ((docFreq.get(term) || n) - n) / outside;
      const phrase = term.includes(' ');
      // How much more this topic says it than the rest, weighted by how much of the topic says it.
      return { term, score: here * Math.log((here + 0.01) / (elsewhere + 0.01)) * (phrase ? 1.6 : 1), n };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.n - a.n || (a.term < b.term ? -1 : 1));
  const picked = [];
  for (const c of scored) {
    if (picked.length >= NAME_PARTS) break;
    const parts = c.term.split(' ');
    // A word already inside a chosen phrase (or a phrase holding a chosen word) says nothing new.
    if (picked.some((p) => p.term.split(' ').some((w) => parts.includes(w)))) continue;
    picked.push(c);
  }
  const shownOf = (term) => [...spellings.get(term).entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const words = picked.map((p) => shownOf(p.term));
  return { name: words.join(' · '), words };
};

// Per doc: the terms a name may be drawn from — each topic word, and each pair
// of topic words that stood side by side — with the spelling as written.
const namingTerms = (text) => {
  const terms = new Map();
  const words = wordsOf(text);
  words.forEach((w, i) => {
    if (w.skip) return;
    if (!terms.has(w.key)) terms.set(w.key, w.shown);
    const next = words[i + 1];
    if (next && next.joins && !next.skip && next.key !== w.key) {
      const pair = `${w.key} ${next.key}`;
      if (!terms.has(pair)) terms.set(pair, `${w.shown} ${next.shown}`);
    }
  });
  return terms;
};

const sparkOf = (times, from, to) => {
  const buckets = new Array(SPARK_BUCKETS).fill(0);
  const span = Math.max(1, to - from);
  for (const t of times) {
    if (t === null) continue;
    buckets[Math.min(SPARK_BUCKETS - 1, Math.floor(((t - from) / span) * SPARK_BUCKETS))] += 1;
  }
  return buckets;
};

const tally = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return counts;
};

/**
 * Build the atlas.
 *
 * @param {Array<{id:string, text:string, line:string, at:(string|null), kind:string,
 *   state:string, ref:(string|null), space?:string, people?:string[]}>} records
 *   every memory of one being, any order. `state` 'active' memories are sorted
 *   into topics; set-aside ones (superseded, retracted, archived) stay on the
 *   list, outside every topic.
 * @param {{k?:number, floor?:number, resolution?:number}} [opts]
 * @returns {{totals:Object, topics:Array, people:Array, periods:Array, kinds:Array,
 *   spaces:Array, memories:Array, ties:Array, links:Map<string,Array<{id:string,w:number}>>}}
 *   `memories` newest first. `links` maps a memory id to its nearest memories,
 *   nearest first — kept apart from `memories` so a reader pays for the
 *   neighbours of the one memory it opens, not of all of them.
 */
export const buildAtlas = (records, opts = {}) => {
  const byNewest = [...(records || [])].sort((a, b) =>
    (timeOf(b.at) ?? -Infinity) - (timeOf(a.at) ?? -Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const active = byNewest.filter((r) => r.state === 'active' && r.text);
  const sorted = active.slice(0, ATLAS_SORT_CAP);

  const { vectors, size } = termVectors(sorted);
  const adjacency = nearestNeighbours(vectors, opts);
  const group = louvain(adjacency, opts);

  const membersOf = new Map();
  group.forEach((g, i) => {
    if (!membersOf.has(g)) membersOf.set(g, []);
    membersOf.get(g).push(i);
  });
  const real = [...membersOf.values()]
    .filter((m) => m.length >= TOPIC_MIN)
    .sort((a, b) => b.length - a.length || a[0] - b[0]);

  const termsByDoc = sorted.map((r) => namingTerms(r.text));
  const nameFreq = new Map();
  for (const terms of termsByDoc) for (const term of terms.keys()) nameFreq.set(term, (nameFreq.get(term) || 0) + 1);

  const topicOfDoc = new Int32Array(sorted.length).fill(-1);
  real.forEach((members, t) => members.forEach((i) => { topicOfDoc[i] = t; }));

  const allTimes = byNewest.map((r) => timeOf(r.at)).filter((t) => t !== null);
  const from = allTimes.length ? allTimes.reduce((a, b) => Math.min(a, b)) : null;
  const to = allTimes.length ? allTimes.reduce((a, b) => Math.max(a, b)) : null;

  const strength = (i) => adjacency[i].reduce((a, e) => a + (topicOfDoc[e.j] === topicOfDoc[i] ? e.w : 0), 0);
  const topics = real.map((members, t) => {
    const { name, words } = nameTopic(members, termsByDoc, nameFreq, size);
    const times = members.map((i) => timeOf(sorted[i].at));
    const dated = times.filter((x) => x !== null);
    // The memory most tied to the rest of its topic stands for it.
    const lead = members.reduce((best, i) => (strength(i) > strength(best) ? i : best), members[0]);
    const people = [...tally(members.flatMap((i) => sorted[i].people || [])).entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([who, n]) => ({ name: who, n }));
    return {
      id: t,
      name: name || `Topic ${t + 1}`,
      words,
      size: members.length,
      from: dated.length ? new Date(dated.reduce((a, b) => Math.min(a, b))).toISOString() : null,
      to: dated.length ? new Date(dated.reduce((a, b) => Math.max(a, b))).toISOString() : null,
      lead: sorted[lead].id,
      leadLine: sorted[lead].line,
      people,
      spark: from === null ? [] : sparkOf(times, from, to),
    };
  });

  // How strongly two topics touch: the summed nearness of the links that cross between them.
  const crossing = new Map();
  adjacency.forEach((row, i) => {
    for (const { j, w } of row) {
      const a = topicOfDoc[i];
      const b = topicOfDoc[j];
      if (i < j && a >= 0 && b >= 0 && a !== b) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        crossing.set(key, (crossing.get(key) || 0) + w);
      }
    }
  });
  const ties = [...crossing.entries()]
    .map(([key, w]) => { const [a, b] = key.split(':').map(Number); return { a, b, w: Number(w.toFixed(3)) }; })
    .sort((x, y) => y.w - x.w || x.a - y.a || x.b - y.b);

  const place = new Map(sorted.map((r, i) => [r.id, i]));
  const links = new Map(sorted.map((r, i) => [r.id, adjacency[i].map(({ j, w }) => ({ id: sorted[j].id, w: Number(w.toFixed(3)) }))]));
  const memories = byNewest.map((r) => {
    const i = place.get(r.id);
    return {
      id: r.id,
      line: r.line,
      at: r.at || null,
      kind: r.kind,
      state: r.state,
      topic: i === undefined ? -1 : topicOfDoc[i],
      links: i === undefined ? 0 : adjacency[i].length,
      ref: r.ref || null,
      ...(r.space && r.space !== 'general' ? { space: r.space } : {}),
      ...(r.people?.length ? { people: r.people } : {}),
    };
  });

  const ranked = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || (String(a[0]) < String(b[0]) ? -1 : 1));
  const grouped = memories.filter((m) => m.topic >= 0).length;
  return {
    totals: {
      memories: memories.length,
      active: active.length,
      setAside: memories.length - active.length,
      topics: topics.length,
      ungrouped: active.length - grouped,
      links: adjacency.reduce((a, row) => a + row.length, 0) / 2,
      from: from === null ? null : new Date(from).toISOString(),
      to: to === null ? null : new Date(to).toISOString(),
      ...(active.length > sorted.length ? { sortedNewest: sorted.length } : {}),
    },
    topics,
    people: ranked(tally(memories.flatMap((m) => m.people || []))).map(([name, n]) => ({ name, n })),
    periods: [...tally(memories.map((m) => monthOf(m.at))).entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, n]) => ({ key, n })),
    kinds: ranked(tally(memories.map((m) => m.kind))).map(([kind, n]) => ({ kind, n })),
    spaces: ranked(tally(memories.map((m) => m.space || 'general'))).map(([id, n]) => ({ id, n })),
    memories,
    ties,
    links,
  };
};
