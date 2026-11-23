// SAID TWICE — an email that makes one point two times.
//
// Design note, 2026-11-21, on first emails that had passed every check: […] (the
// 95% the LP keeps, once in the why and again in the offer; and […], one sentence after the other). A reader with 120 words to give
// us reads the second one as filler. Two things count as said twice:
//   A FIGURE in two sentences: the same percentage or sum of money (95%, $500,000) stated more than once.
//   A POINT in two sentences: most of the meaning-carrying words of the shorter sentence are in the other too (three
//   or more of them and six in ten; two and half of them when both sentences also open with the same two words).
// PURE.

const STOP = new Set(['about', 'after', 'their', 'there', 'these', 'those', 'which', 'while', 'where', 'would', 'could', 'should', 'other', 'every', 'being', 'since', 'still', 'before', 'today',
  'with', 'from', 'that', 'this', 'what', 'have', 'into', 'over', 'your', 'they', 'them', 'were', 'been', 'more', 'most', 'some', 'than', 'very', 'also', 'only', 'just', 'when', 'will', 'here', 'each', 'such', 'both', 'does', 'make', 'made', 'like', 'you\'re', 'it\'s']);
const stem = (w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
/** pure — the words of a sentence that carry its meaning: four letters or more, plural folded, no filler. */
const meaning = (s) => new Set((String(s ?? '').toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem));
/** pure — the percentages and sums of money a sentence states ("95%", "$500000"). */
const figures = (s) => new Set((String(s ?? '').match(/\$\s?\d[\d,.]*\s?(?:k|m|bn|million|billion)?|\d[\d,.]*\s?(?:%|percent)/gi) ?? [])
  .map((f) => f.toLowerCase().replace(/[\s,]/g, '').replace(/\.$/, '').replace('percent', '%')));
const sentences = (text) => String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(' ').length >= 3);
const opening = (s) => s.toLowerCase().split(' ').slice(0, 2).join(' ');
const short = (s) => (s.length > 90 ? `${s.slice(0, 87)}…` : s);

/**
 * What an email says twice, each as words the writer can act on (empty: nothing).
 * @param {string[]} parts - the email's own parts, in order, the ask LAST (hook, why, offer, ask)
 * @returns {string[]}
 */
export const saidTwice = (parts) => {
  const list = Array.isArray(parts) ? parts : [parts, ''];
  const all = list.flatMap(sentences);
  const found = [];
  const figureSeen = new Map();
  // The ask may name the sum it is about: a figure there is the thing asked, not a second telling.
  for (const s of list.slice(0, -1).flatMap(sentences)) {
    for (const f of figures(s)) {
      if (figureSeen.has(f) && figureSeen.get(f) !== s) found.push(`${f} is stated twice ("${short(figureSeen.get(f))}" and "${short(s)}") — say it once`);
      else figureSeen.set(f, s);
    }
  }
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const [a, b] = [meaning(all[i]), meaning(all[j])];
      const shared = [...a].filter((w) => b.has(w)).length;
      const least = Math.min(a.size, b.size);
      const sameStart = opening(all[i]) === opening(all[j]);
      if ((shared >= 3 && shared / least >= 0.6) || (sameStart && shared >= 2 && shared / least >= 0.5)) found.push(`two sentences make the same point ("${short(all[i])}" and "${short(all[j])}") — keep the stronger one`);
    }
  }
  return [...new Set(found)];
};
