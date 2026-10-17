/**
 * BM25 Search Engine — Pure function implementation
 *
 * No external dependencies. Provides keyword-based search to complement
 * TF-IDF vector search. Combined via Reciprocal Rank Fusion (RRF).
 */

const K1 = 1.5;
const B = 0.75;

/**
 * Tokenize a string into lowercase word tokens.
 * @param {string} text - Input text
 * @returns {string[]} Array of lowercase tokens
 */
const tokenize = (text) =>
  (text || '').toLowerCase().split(/\s+/).filter(w => w.length > 1);

/**
 * Create a BM25 index from an array of documents.
 * @param {Array<{id: any, text: string}>} documents - Documents to index (id + text)
 * @returns {Readonly<{docs: Array, avgDL: number, idf: Object, docCount: number}>} Frozen BM25 index
 */
export const createBM25Index = (documents) => {
  if (!documents || documents.length === 0) {
    return Object.freeze({ docs: [], avgDL: 0, idf: {}, docCount: 0 });
  }

  // Build term frequencies per document — skip invalid documents
  const validDocs = documents.filter(doc => doc && typeof doc.text === 'string' && doc.id != null);
  if (validDocs.length === 0) {
    return Object.freeze({ docs: [], avgDL: 0, idf: {}, docCount: 0 });
  }

  const docs = validDocs.map(doc => {
    const tokens = tokenize(doc.text);
    const tf = {};
    for (const token of tokens) {
      tf[token] = (tf[token] || 0) + 1;
    }
    return { id: doc.id, tf, length: tokens.length, meta: doc };
  });

  const docCount = docs.length;
  const avgDL = docs.reduce((sum, d) => sum + d.length, 0) / docCount;

  // Compute IDF: log((N - df + 0.5) / (df + 0.5) + 1)
  const df = {};
  for (const doc of docs) {
    const seen = new Set(Object.keys(doc.tf));
    for (const term of seen) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  const idf = {};
  for (const [term, freq] of Object.entries(df)) {
    idf[term] = Math.log((docCount - freq + 0.5) / (freq + 0.5) + 1);
  }

  // `df` rides so appendBM25Doc can update document frequencies without
  // re-tokenizing the whole corpus (harness-friction-map T2).
  return Object.freeze({ docs, avgDL, idf, df, docCount });
};

/**
 * Append ONE document to an existing BM25 index — the incremental lane of
 * createBM25Index (harness-friction-map T2). Corpus-global stats update
 * without re-tokenizing any old document: avgDL is a running mean, df gains
 * only the new doc's terms, and idf recomputes over the vocabulary in memory
 * (its N moved, so every term's idf shifts — the recompute is O(vocab), not
 * O(corpus text)). Pure: returns a NEW frozen index, input untouched.
 * @param {Object} index - a createBM25Index/appendBM25Doc result
 * @param {{id: any, text: string}} doc - the document to append
 * @returns {Readonly<{docs: Array, avgDL: number, idf: Object, df: Object, docCount: number}>}
 */
export const appendBM25Doc = (index, doc) => {
  if (!index || doc == null || typeof doc.text !== 'string' || doc.id == null) return index;
  if (index.docCount === 0) return createBM25Index([doc]);
  const tokens = tokenize(doc.text);
  const tf = {};
  for (const token of tokens) tf[token] = (tf[token] || 0) + 1;
  const docs = [...index.docs, { id: doc.id, tf, length: tokens.length, meta: doc }];
  const docCount = docs.length;
  const avgDL = (index.avgDL * index.docCount + tokens.length) / docCount;
  // An index built before `df` rode still appends correctly: its document
  // frequencies re-derive from the stored per-doc tf maps (key walks, never
  // re-tokenization).
  const df = {};
  if (index.df) Object.assign(df, index.df);
  else for (const d of index.docs) for (const term of Object.keys(d.tf)) df[term] = (df[term] || 0) + 1;
  for (const term of Object.keys(tf)) df[term] = (df[term] || 0) + 1;
  const idf = {};
  for (const [term, freq] of Object.entries(df)) {
    idf[term] = Math.log((docCount - freq + 0.5) / (freq + 0.5) + 1);
  }
  return Object.freeze({ docs, avgDL, idf, df, docCount });
};

/**
 * Search a BM25 index with a query string.
 * @param {Object} index - BM25 index from createBM25Index
 * @param {string} query - Search query
 * @param {number} [limit=10] - Maximum results to return
 * @returns {Array<{id: any, score: number, meta: Object}>} Scored results, sorted by relevance
 */
export const bm25Search = (index, query, limit = 10) => {
  if (!index || index.docCount === 0 || !query) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const results = [];

  for (const doc of index.docs) {
    let score = 0;

    for (const token of queryTokens) {
      const tf = doc.tf[token] || 0;
      if (tf === 0) continue;

      const idfVal = index.idf[token] || 0;
      const numerator = tf * (K1 + 1);
      const denominator = tf + K1 * (1 - B + B * (doc.length / index.avgDL));
      score += idfVal * (numerator / denominator);
    }

    if (score > 0) {
      results.push({ id: doc.id, score, meta: doc.meta });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
};

