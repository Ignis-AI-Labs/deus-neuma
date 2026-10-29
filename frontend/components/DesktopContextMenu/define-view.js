// Pure view logic for DEFINE's card (DefineCard.jsx): the sentence a word
// was read in, the question ASK IN CHAT drafts, and how much of an entry
// shows before MORE. Pure — unit-tested without a DOM.

const MAX_SENTENCE = 220;
const SENSES_AT_A_GLANCE = 2;

/**
 * The sentence around position `at` in a block of text, trimmed to a
 * readable length around that position. Pure.
 * @param {string} text the block the word was selected in
 * @param {number} at where the selection starts in it
 * @returns {string}
 */
export const sentenceAround = (text, at) => {
  const raw = String(text || '');
  const source = raw.replace(/\s+/g, ' ');
  if (!source.trim()) return '';
  // `at` counts the raw text; whitespace runs collapse, so count the same way
  const i = Math.min(source.length, raw.slice(0, Math.max(0, at | 0)).replace(/\s+/g, ' ').length);
  // the last sentence end before it, and the first after it
  const cut = source.slice(0, i).search(/[.!?…]\s(?=[^.!?…]*$)/);
  const start = cut < 0 ? 0 : cut + 2;
  const tail = source.slice(i).search(/[.!?…](\s|$)/);
  const end = tail < 0 ? source.length : i + tail + 1;
  let sentence = source.slice(start, end).trim();
  if (sentence.length > MAX_SENTENCE) {
    const from = Math.max(0, i - start - MAX_SENTENCE / 2);
    sentence = `${from > 0 ? '…' : ''}${sentence.slice(from, from + MAX_SENTENCE).trim()}…`;
  }
  return sentence;
};

/**
 * What ASK IN CHAT drafts: the word, and the sentence it was read in when
 * there is one worth quoting. Pure.
 * @param {string} word
 * @param {string} [sentence]
 */
export const askTextFor = (word, sentence = '') => {
  const quoted = sentence && sentence.toLowerCase() !== word.toLowerCase() ? ` in “${sentence}”` : '';
  return `What does “${word}” mean${quoted}?`;
};

/**
 * The senses an entry shows: two at a glance, all of them once opened. Pure.
 * @param {{ senses: Array<object> }} entry
 * @param {boolean} open
 */
export const sensesShown = (entry, open) => (open ? entry.senses : entry.senses.slice(0, SENSES_AT_A_GLANCE));

/** Whether any entry holds senses beyond the glance — MORE has something to open. Pure. */
export const hasMore = (entries) => entries.some((entry) => entry.senses.length > SENSES_AT_A_GLANCE);

/**
 * The card as plain text, for COPY. Pure.
 * @param {{ word: string, entries: Array<{ pos: string, lemma: string, senses: Array<{ definition: string }> }> }} result
 */
export const definitionText = ({ word, entries }) => [
  word,
  ...entries.map((e) => `${e.lemma} (${e.pos}): ${e.senses.map((s, i) => `${i + 1}. ${s.definition}`).join(' ')}`),
].join('\n');
