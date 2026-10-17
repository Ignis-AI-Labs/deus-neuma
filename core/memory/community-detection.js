// Community detection for navigable, compactable memory (GraphRAG pattern).
//
// Clusters related memories into a deterministic membership schema. Semantic
// through-lines are joined only in the derived community-summary read view.
// No external graph library — a small, deterministic label-propagation over a
// token-similarity graph. Pure throughout: same input → same communities.

// Function words carry no topic. The list is deliberately short — with real
// IDF weighting below, a word common to the whole corpus scores near zero
// whether or not it appears here, so this list is a fast path and not the
// mechanism. It grew on 2026-08-13 (#230) with the words a live lane's labels
// actually surfaced: `ANSWER AUDITOR BECAUSE BEFORE`, `ALL ARTIFACTS CAN CLEAR`.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'of', 'to', 'in', 'on',
  'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'this',
  'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he', 'she', 'as', 'at',
  'by', 'from', 'your', 'our', 'me', 'my', 'about', 'what', 'how', 'when',
  'where', 'who', 'which', 'said', 'reflected', 'witness',
  'all', 'also', 'any', 'because', 'before', 'after', 'can', 'cannot', 'could',
  'did', 'does', 'each', 'even', 'every', 'first', 'had', 'has', 'have',
  'here', 'his', 'her', 'into', 'its', 'just', 'like', 'made', 'make', 'may',
  'more', 'most', 'much', 'must', 'never', 'not', 'now', 'once', 'one', 'only',
  'other', 'out', 'over', 'own', 'same', 'should', 'since', 'some', 'still',
  'such', 'than', 'their', 'them', 'there', 'through', 'thus', 'too', 'under',
  'until', 'use', 'used', 'very', 'while', 'will', 'without',
  'would', 'yet',
]);

/**
 * Tokenize text into lowercase content words (drops stopwords, short tokens,
 * and bare numerals). Pure.
 *
 * A pure numeral names nothing a community can be about — a live lane was
 * labelled `2026 CANNOT ENTRY INDEPENDENTLY` because every memory carried a
 * timestamp year (#230). Alphanumerics are KEPT: `gpt4`, `p10` and `sha256`
 * are exactly the terms that distinguish one body of work from another.
 * @param {string} text
 * @returns {string[]}
 */
export const tokenizeContent = (text) =>
  (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

/**
 * Jaccard similarity between two token sets. Pure.
 * @param {Set<string>} aSet
 * @param {Set<string>} bSet
 * @returns {number} 0..1
 */
export const jaccard = (aSet, bSet) => {
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return inter / (aSet.size + bSet.size - inter);
};

/**
 * Build an undirected token-similarity graph over docs (edges above threshold).
 * Pure.
 * @param {Array<{id:any,text?:string,memory?:string}>} docs
 * @param {number} [threshold=0.1]
 * @returns {{nodeIds:Array, adjacency:Map}}
 */
export const buildSimilarityGraph = (docs, threshold = 0.1) => {
  const nodes = docs.map((d) => ({ id: d.id, tokens: new Set(tokenizeContent(d.text || d.memory)) }));
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const w = jaccard(nodes[i].tokens, nodes[j].tokens);
      if (w >= threshold) {
        adjacency.get(nodes[i].id).push({ id: nodes[j].id, w });
        adjacency.get(nodes[j].id).push({ id: nodes[i].id, w });
      }
    }
  }
  return { nodeIds: nodes.map((n) => n.id), adjacency };
};

/**
 * Deterministic label propagation → Map<nodeId, communityLabel>. Each node
 * starts in its own community, then repeatedly adopts the highest weighted
 * neighbour label; ties break to the lowest label so the result is stable.
 * @param {{nodeIds:Array, adjacency:Map}} graph
 * @param {{passes?:number}} [opts]
 * @returns {Map<any, any>}
 */
export const detectCommunities = ({ nodeIds, adjacency }, { passes = 5 } = {}) => {
  const labels = new Map(nodeIds.map((id) => [id, id]));
  const ordered = [...nodeIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const id of ordered) {
      const neighbours = adjacency.get(id) || [];
      if (neighbours.length === 0) continue;
      const tally = new Map();
      for (const { id: nId, w } of neighbours) {
        const lbl = labels.get(nId);
        tally.set(lbl, (tally.get(lbl) || 0) + w);
      }
      let best = labels.get(id);
      let bestScore = -Infinity;
      for (const [lbl, score] of [...tally.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        if (score > bestScore) { bestScore = score; best = lbl; }
      }
      if (best !== labels.get(id)) { labels.set(id, best); changed = true; }
    }
    if (!changed) break;
  }
  return labels;
};

/**
 * Corpus-wide document frequency: how many docs each term appears in. Pure.
 * @param {Array<{text?:string,memory?:string}>} docs
 * @returns {{docFreq: Map<string, number>, size: number}}
 */
export const documentFrequencies = (docs) => {
  const docFreq = new Map();
  for (const d of docs || []) {
    for (const t of new Set(tokenizeContent(d.text || d.memory))) {
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
  }
  return { docFreq, size: (docs || []).length };
};

/**
 * Smoothed inverse document frequency, sklearn's shape: `ln((1+N)/(1+df)) + 1`.
 *
 * Always ≥ 1 and strictly decreasing in `df`, which matters at both ends. A
 * plain `ln(N/df)` collapses to exactly 0 for a term present in every doc, and
 * when a corpus is ONE community every term is present in every doc — so every
 * score would be 0 and the label would fall out alphabetically. Smoothed, that
 * degenerate case ranks by frequency again, which is the honest fallback when
 * there is nothing to be distinct from.
 * @param {number} df - docs containing the term
 * @param {number} size - docs in the corpus
 * @returns {number}
 */
const idf = (df, size) => Math.log((1 + size) / (1 + df)) + 1;

/**
 * Label a community by its most DISTINGUISHING terms. Pure.
 *
 * The doc comment said "distinguishing" from the start; the implementation
 * ranked by raw in-community frequency and took no corpus input at all, so a
 * term common to every community won every label. A live witness lane with 5
 * communities read `ANSWER AUDITOR BECAUSE BEFORE`, `ALL ARTIFACTS CAN CLEAR`,
 * `2026 CANNOT ENTRY INDEPENDENTLY` — three of five meaningless, while the
 * clustering underneath was correct (#230).
 *
 * Score is in-community document frequency × smoothed IDF over the whole
 * corpus, so a term earns its place by being BOTH common here and rare
 * elsewhere. `corpus` omitted degrades to the old frequency ranking, which is
 * right for a caller that legitimately has no corpus to compare against.
 *
 * @param {Array<{text?:string,memory?:string}>} memberDocs
 * @param {number} [max=4]
 * @param {{docFreq: Map<string, number>, size: number}|null} [corpus=null]
 * @returns {string}
 */
export const labelCommunity = (memberDocs, max = 4, corpus = null) => {
  const freq = new Map();
  for (const d of memberDocs) {
    for (const t of new Set(tokenizeContent(d.text || d.memory))) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  const weight = corpus && corpus.size > 0
    ? (term, count) => count * idf(corpus.docFreq.get(term) || 0, corpus.size)
    : (_term, count) => count;
  return [...freq.entries()]
    .map(([t, count]) => [t, weight(t, count)])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([t]) => t)
    .join(' ');
};

/**
 * Cluster docs into deterministic, summary-free communities. Pure.
 * @param {Array<{id:any,text?:string,memory?:string}>} docs
 * @param {{threshold?:number, passes?:number}} [opts]
 * @returns {Array<{id:number,label:string,memberIds:Array,size:number}>}
 */
export const buildCommunities = (docs, { threshold = 0.1, passes = 5 } = {}) => {
  if (!docs || docs.length === 0) return [];
  const graph = buildSimilarityGraph(docs, threshold);
  const labels = detectCommunities(graph, { passes });

  const byCommunity = new Map();
  for (const d of docs) {
    const c = labels.get(d.id);
    if (!byCommunity.has(c)) byCommunity.set(c, []);
    byCommunity.get(c).push(d);
  }

  // The whole doc set is the corpus every label is measured against, so a term
  // that shows up everywhere cannot win any community's name.
  const corpus = documentFrequencies(docs);
  return [...byCommunity.values()]
    .map((members) => ({
      label: labelCommunity(members, 4, corpus),
      memberIds: members.map((m) => m.id),
      size: members.length,
    }))
    .sort((a, b) => b.size - a.size || (a.label < b.label ? -1 : 1))
    .map((c, i) => ({ id: i, ...c }));
};
