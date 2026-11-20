// Atlas clustering — how the memory map sorts a life into topics.
//
// The older community pass (community-detection.js) links any two memories
// that share a tenth of their words and lets labels spread: on a real lane
// that made 6,870 links over 317 memories, one topic holding nearly all of
// them, and a handful of one-memory topics named by four words in alphabetical
// order (Design note, 2026-11-20: […]). Recall and the measured campaigns still stand on that
// pass, so it is left exactly as it is. The map sorts with this one instead:
//
//   1. each memory becomes a weighted word vector (rare words weigh more),
//   2. each memory keeps only its few NEAREST neighbours (a sparse graph),
//   3. topics are the groups that graph falls into (Louvain modularity).
//
// Pure throughout: the same memories give the same topics, in the same order.
// No Math.random, no Date.now, no library.

import { STOP } from './community-detection.js';

// Words a conversation is full of and a topic is never about. Rare-word
// weighting already pushes these down; listing them keeps them out of names.
const TALK = new Set([
  'yeah', 'yes', 'okay', 'well', 'really', 'actually', 'basically', 'maybe', 'please', 'thanks', 'thank',
  'want', 'wants', 'wanted', 'need', 'needs', 'needed', 'going', 'gonna', 'think', 'thought', 'know', 'known',
  'get', 'gets', 'got', 'getting', 'let', 'lets', 'see', 'seen', 'say', 'says', 'look', 'looks', 'looking',
  'thing', 'things', 'something', 'anything', 'everything', 'nothing', 'someone', 'way', 'ways', 'lot', 'kind',
  'sure', 'right', 'good', 'great', 'new', 'also', 'able', 'being', 'done', 'doing', 'does', 'don', 'didn', 'doesn',
  'isn', 'aren', 'wasn', 'won', 'can', 'that', 'them', 'then', 'there', 'here', 'both', 'between', 'again',
  'take', 'takes', 'took', 'give', 'gives', 'gave', 'put', 'keep', 'keeps', 'kept', 'come', 'comes', 'came',
  'tell', 'told', 'ask', 'asked', 'asks', 'using', 'uses', 'work', 'works', 'worked', 'working', 'time', 'times',
  'two', 'three', 'many', 'few', 'next', 'last', 'back', 'down', 'off', 'per', 'via', 'with', 'within',
  'operator', 'reflected', 'said', 'you', 'your', 'yours', 'its', 'it', 'are', 'was', 'were', 'been', 'why',
]);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/**
 * The words of one text, in order, each with the spelling it was written in.
 * `skip` marks a word that carries no topic (a function word, a bare number,
 * one or two letters) — kept in the list so a two-word phrase is only ever
 * made of words that really stood side by side. Pure.
 * @param {string} text
 * `joins` says the word followed the one before it with only blank space
 * between — a phrase never reaches across a comma or a full stop.
 * @returns {Array<{key:string, shown:string, joins:boolean, skip:boolean}>}
 */
export const wordsOf = (text) => {
  const whole = String(text || '');
  const out = [];
  let end = 0;
  for (const match of whole.matchAll(WORD)) {
    const shown = match[0].replace(/['’-]+$/, '');
    const key = shown.toLowerCase().replace(/['’]s$/, '');
    // Anything but blank space since the last word (a comma, a full stop, a bracket) parts the two.
    const joins = out.length > 0 && /^\s+$/.test(whole.slice(end, match.index));
    out.push({ key, shown, joins, skip: key.length < 3 || STOP.has(key) || TALK.has(key) || /^\d+$/.test(key) });
    end = match.index + match[0].length;
  }
  return out;
};

/**
 * Every memory as a weighted, unit-length word vector, with the corpus counts
 * the names are later drawn from. A word in one memory only joins nothing and
 * a word in a quarter of all memories tells nothing apart, so neither is used
 * to measure nearness (both still count toward names). Pure.
 * @param {Array<{text:string}>} docs
 * @returns {{vectors:Array<Map<string,number>>, docFreq:Map<string,number>, size:number}}
 */
export const termVectors = (docs) => {
  const bags = docs.map((d) => {
    const counts = new Map();
    for (const w of wordsOf(d.text)) if (!w.skip) counts.set(w.key, (counts.get(w.key) || 0) + 1);
    return counts;
  });
  const docFreq = new Map();
  for (const bag of bags) for (const key of bag.keys()) docFreq.set(key, (docFreq.get(key) || 0) + 1);
  const size = docs.length;
  const tooCommon = Math.max(8, Math.min(Math.floor(size * 0.25), 300));
  const vectors = bags.map((bag) => {
    const vector = new Map();
    let squares = 0;
    for (const [key, count] of bag) {
      const df = docFreq.get(key);
      if (df < 2 || df > tooCommon) continue;
      const weight = (1 + Math.log(count)) * Math.log((1 + size) / (1 + df));
      vector.set(key, weight);
      squares += weight * weight;
    }
    const length = Math.sqrt(squares);
    if (length > 0) for (const [key, weight] of vector) vector.set(key, weight / length);
    return vector;
  });
  return { vectors, docFreq, size };
};

/**
 * The sparse graph: each memory linked to its `k` nearest others (cosine of
 * the word vectors, never below `floor`). A link counts when EITHER end chose
 * it, so the graph is symmetric. Rows are sorted nearest first, ties by index.
 * Pure.
 * @param {Array<Map<string,number>>} vectors
 * @param {{k?:number, floor?:number}} [opts]
 * @returns {Array<Array<{j:number, w:number}>>} adjacency by doc index
 */
export const nearestNeighbours = (vectors, { k = 7, floor = 0.1 } = {}) => {
  const postings = new Map();
  vectors.forEach((vector, i) => {
    for (const [key, weight] of vector) {
      if (!postings.has(key)) postings.set(key, []);
      postings.get(key).push([i, weight]);
    }
  });
  const chosen = vectors.map((vector, i) => {
    const scores = new Map();
    for (const [key, weight] of vector) {
      for (const [j, other] of postings.get(key)) {
        if (j !== i) scores.set(j, (scores.get(j) || 0) + weight * other);
      }
    }
    return [...scores.entries()]
      .filter(([, w]) => w >= floor)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, k);
  });
  const rows = vectors.map(() => new Map());
  chosen.forEach((list, i) => {
    for (const [j, w] of list) { rows[i].set(j, w); rows[j].set(i, w); }
  });
  return rows.map((row) => [...row.entries()]
    .map(([j, w]) => ({ j, w }))
    .sort((a, b) => b.w - a.w || a.j - b.j));
};

// One Louvain level: every node tries each neighbouring group and moves to the
// one that raises modularity most (ties to the lowest group id), over and over
// until a whole pass moves nothing. `graph` is {n, rows:[Map(j→w)], self:[w]}.
const localMoving = (graph, resolution) => {
  const { n, rows, self } = graph;
  const group = Int32Array.from({ length: n }, (_, i) => i);
  const degree = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    let sum = self[i];
    for (const w of rows[i].values()) sum += w;
    degree[i] = sum;
    total += sum;
  }
  if (total === 0) return { group, moved: false };
  const groupDegree = Float64Array.from(degree);
  let moved = false;
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const home = group[i];
      const toward = new Map();
      for (const [j, w] of rows[i]) toward.set(group[j], (toward.get(group[j]) || 0) + w);
      groupDegree[home] -= degree[i];
      let best = home;
      let bestGain = (toward.get(home) || 0) - resolution * groupDegree[home] * degree[i] / total;
      for (const [g, w] of [...toward.entries()].sort((a, b) => a[0] - b[0])) {
        const gain = w - resolution * groupDegree[g] * degree[i] / total;
        if (gain > bestGain + 1e-12) { best = g; bestGain = gain; }
      }
      groupDegree[best] += degree[i];
      if (best !== home) { group[i] = best; changed = true; moved = true; }
    }
    if (!changed) break;
  }
  return { group, moved };
};

// Fold each group of one level into a single node of the next.
const fold = (graph, group) => {
  const ids = [...new Set(group)].sort((a, b) => a - b);
  const indexOf = new Map(ids.map((g, i) => [g, i]));
  const rows = ids.map(() => new Map());
  const self = new Float64Array(ids.length);
  for (let i = 0; i < graph.n; i++) {
    const a = indexOf.get(group[i]);
    self[a] += graph.self[i];
    for (const [j, w] of graph.rows[i]) {
      const b = indexOf.get(group[j]);
      if (a === b) self[a] += w; else rows[a].set(b, (rows[a].get(b) || 0) + w);
    }
  }
  return { graph: { n: ids.length, rows, self }, indexOf };
};

/**
 * Sort a graph into groups by Louvain modularity. Returns the group of every
 * node as a dense index (0…), numbered by each group's lowest member so the
 * numbering never depends on the order work happened in. Pure.
 * @param {Array<Array<{j:number, w:number}>>} adjacency
 * @param {{resolution?:number}} [opts] - above 1 makes more, smaller groups
 * @returns {Int32Array}
 */
export const louvain = (adjacency, { resolution = 1 } = {}) => {
  const n = adjacency.length;
  let graph = { n, rows: adjacency.map((row) => new Map(row.map(({ j, w }) => [j, w]))), self: new Float64Array(n) };
  let membership = Int32Array.from({ length: n }, (_, i) => i);
  for (let level = 0; level < 12; level++) {
    const { group, moved } = localMoving(graph, resolution);
    if (!moved) break;
    const folded = fold(graph, group);
    membership = membership.map((g) => folded.indexOf.get(group[g]));
    graph = folded.graph;
  }
  const order = new Map();
  for (let i = 0; i < n; i++) if (!order.has(membership[i])) order.set(membership[i], order.size);
  return membership.map((g) => order.get(g));
};
