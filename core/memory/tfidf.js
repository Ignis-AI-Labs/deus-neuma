/*
 * The tokenizer pattern, stopword list and scoring formulas below are ported
 * from the `natural` package (lib/natural/tfidf, tokenizers, util/stopwords),
 * which carries this notice:
 *
 * Copyright (c) 2011, Rob Ellis, Chris Umbel
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * TF-IDF — the recall lane's term-weight ranker, pure.
 *
 * A local reproduction of the `natural` package's TfIdf (8.1.0) as recall
 * used it: string documents, string queries, the default WordTokenizer and
 * stopword list. `natural` itself no longer ships — its package carries
 * storage adapters (mongoose, http-server) the house never loads but would
 * still install. Scores are bit-identical to natural's for every input that
 * does not name one of the words below (test/unit/tfidf-parity.test.js
 * runs both over the same corpora):
 *
 *   natural counted terms on a plain object, so a token that is also an
 *   Object property ("constructor", "__proto__") or its own key slot
 *   ("__key") read the prototype or the key instead of a count — a NaN score
 *   for every memory, or a memory whose key became a string. Counts here are
 *   Maps, so those words weigh like any other word.
 */

// natural's WordTokenizer: split on runs outside ASCII letters, the basic
// Russian alphabet (Ё/ё excluded, as in natural), digits and underscore.
const WORD_GAPS = /[^A-Za-zА-Яа-я0-9_]+/;

// natural's util/stopwords list, applied to documents only — a query keeps
// its stopwords, and they score 0 because no document counted them.
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'another',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'came', 'can', 'cannot', 'come', 'could', 'did',
  'do', 'does', 'doing', 'during', 'each', 'few', 'for', 'from', 'further', 'get',
  'got', 'has', 'had', 'he', 'have', 'her', 'here', 'him', 'himself', 'his', 'how',
  'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'like', 'make', 'many', 'me',
  'might', 'more', 'most', 'much', 'must', 'my', 'myself', 'never', 'now', 'of', 'on',
  'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'said', 'same', 'see', 'she', 'should', 'since', 'so', 'some', 'still', 'such', 'take', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
  'way', 'we', 'well', 'were', 'what', 'where', 'when', 'which', 'while', 'who',
  'whom', 'with', 'would', 'why', 'you', 'your', 'yours', 'yourself',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
  'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '$', '1',
  '2', '3', '4', '5', '6', '7', '8', '9', '0', '_',
]);

/**
 * Lowercased word tokens, in order, duplicates kept.
 * @param {string} text
 * @returns {string[]}
 */
export const tokenizeTfIdf = (text) =>
  String(text).toLowerCase().split(WORD_GAPS).filter((token) => token !== '');

// One document's term counts, stopwords dropped.
const countTerms = (text) => {
  const counts = new Map();
  for (const term of tokenizeTfIdf(text)) {
    if (!STOPWORDS.has(term)) counts.set(term, (counts.get(term) || 0) + 1);
  }
  return counts;
};

/** An index holding no documents. */
export const EMPTY_TFIDF = Object.freeze({ docs: Object.freeze([]) });

/**
 * Append one document. Pure: returns a NEW index, the input untouched.
 * @param {{docs: ReadonlyArray<{key: any, counts: Map<string, number>}>}} index
 * @param {string} text the document's text
 * @param {any} key handed back beside the document's score
 * @returns {{docs: ReadonlyArray<{key: any, counts: Map<string, number>}>}}
 */
export const appendTfIdfDoc = (index, text, key) =>
  Object.freeze({ docs: Object.freeze([...index.docs, Object.freeze({ key, counts: countTerms(text) })]) });

/**
 * Build an index over documents, in order.
 * @param {Array<{text: string, key: any}>} documents
 * @returns {{docs: ReadonlyArray<{key: any, counts: Map<string, number>}>}}
 */
export const createTfIdfIndex = (documents) =>
  Object.freeze({
    docs: Object.freeze(documents.map(({ text, key }) => Object.freeze({ key, counts: countTerms(text) }))),
  });

// natural's idf: 1 + ln(N / (1 + documents holding the term)). N >= 1 here
// (scores are only asked of a non-empty index), so it is always finite.
const idfOf = (docs, term) => {
  const holding = docs.reduce((count, doc) => count + (doc.counts.has(term) ? 1 : 0), 0);
  return 1 + Math.log(docs.length / (1 + holding));
};

/**
 * Every document's score for a query, in index order: the sum over the
 * query's tokens (repeats count again) of tf × idf, added left to right from
 * 0 — natural's order, so the float result matches it bit for bit.
 * @param {{docs: ReadonlyArray<{key: any, counts: Map<string, number>}>}} index
 * @param {string} query
 * @returns {Array<{key: any, score: number}>}
 */
export const tfidfScores = (index, query) => {
  const terms = tokenizeTfIdf(query);
  const idfs = new Map(terms.map((term) => [term, idfOf(index.docs, term)]));
  return index.docs.map((doc) => ({
    key: doc.key,
    score: terms.reduce((value, term) => value + (doc.counts.get(term) || 0) * idfs.get(term), 0.0),
  }));
};
