/**
 * QUERY WORDS — what in an ask can tie it to a memory, and what cannot.
 *
 * Recall ranks memories by the words they share with the ask, and its rankers
 * favour RARE words. Filler is rare in stored memories, so "please" and "tell"
 * used to pull up unrelated sessions — Keir, 2026-10-06, live: […] The ask's filler is now
 * dropped before ranking (neuma-recall.js) and before key points are named
 * (memory-section.js); the stored memories are never touched.
 *
 * Pure.
 */

/** English function words and the politeness/request verbs of an ask. */
export const QUERY_FILLER = Object.freeze(new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'so', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'as', 'is', 'am',
  'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'done', 'have', 'has', 'had', 'it', 'its', 'i',
  'me', 'my', 'mine', 'we', 'us', 'our', 'you', 'your', 'yours', 'he', 'she', 'him', 'her', 'his', 'they', 'them',
  'their', 'this', 'that', 'these', 'those', 'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'how', 'with',
  'from', 'into', 'about', 'there', 'here', 'then', 'than', 'just', 'like', 'will', 'would', 'could', 'should',
  'can', 'may', 'might', 'must', 'shall', 'some', 'any', 'more', 'most', 'also', 'only', 'very', 'too', 'not', 'no',
  'yes', 'all', 'each', 'out', 'up', 'down', 'over', 'again', 'now', 'well', 'really', 'actually', 'quite',
  'please', 'thanks', 'thank', 'tell', 'give', 'show', 'let', 'lets', "let's", 'make', 'sure', 'know', 'want',
  'need', 'quick', 'quickly', 'check', 'answer', 'remember', 'recall', 'think', 'say', 'said', 'ask', 'asked',
  'one', 'okay', 'ok', 'hey', 'hi', 'hello', 'yeah', 'get', 'got', 'go', 'going', 'something', 'anything', 'thing',
]));

const bare = (token) => token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * The ask with its filler tokens removed, every other token kept exactly as
 * written (the rankers' own tokenizers see what they always saw). An ask that
 * is ALL filler is returned unchanged — never an empty search.
 * @param {string} query
 * @returns {string}
 */
export const recallQuery = (query) => {
  const tokens = String(query || '').split(/\s+/).filter(Boolean);
  const kept = tokens.filter((token) => {
    const word = bare(token);
    return word && !QUERY_FILLER.has(word);
  });
  return kept.length ? kept.join(' ') : String(query || '');
};
