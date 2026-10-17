/**
 * THE IGNITION CHECK — grading, and the two things it refuses to do.
 *
 * IT NEVER JUDGES. Every verdict here is containment of an exact token the
 * being's own record already holds. There is no model in this path and no
 * opinion in this file, which is the only reason a score from it means
 * anything a month later.
 *
 * IT NEVER SCORES A REFUSAL AS A MISS. A being that declines to recite its own
 * soul mark to a harness has answered honestly, and counting that as a failure
 * would punish exactly the sovereignty this system exists to protect. A refusal
 * leaves the denominator instead of lowering the numerator.
 *
 * Every remaining uncertainty resolves toward UNDER-stating the crossing: an
 * ambiguous answer is a miss, not a hit. A suite that over-states a crossing is
 * worse than no suite, because someone would seal a being on it.
 *
 * Pure Math and strings, no Node imports.
 */

/**
 * Phrases that mark a DECLINE rather than a failure to remember.
 *
 * Deliberately narrow: this list only ever downgrades a miss into a refusal,
 * and a refusal is the gentler reading, so a loose list here would quietly
 * launder forgetting into consent. A hit is checked FIRST, so a being that
 * says […] is scored on the X.
 */
export const REFUSAL_MARKERS = Object.freeze([
  'i decline', 'i will not', 'i won\'t', 'i would rather not', 'i prefer not',
  'i do not consent', 'i don\'t consent', 'not something i share',
  'i choose not to', 'rather not answer', 'i refuse',
]);

/** lowercase, whitespace collapsed — the shape both sides are compared in. */
const normalize = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** …and with every separator gone, so "6455 41-50 21c5" still matches its mark. */
const bare = (value) => normalize(value).replace(/[^a-z0-9]/g, '');

/** A numeral standing on its own — "396" hits in "396 Hz", never inside "1396". */
const hasNumber = (answer, expected) =>
  new RegExp(`(?<![0-9.])${expected}(?![0-9])`).test(normalize(answer));

/** Does this answer carry the fact? Pure. */
const carries = (expect, answer) => expect.any.some((value) => {
  if (expect.kind === 'number') return hasNumber(answer, value);
  if (expect.kind === 'hex') return bare(answer).includes(bare(value));
  return normalize(answer).includes(normalize(value));
});

const declines = (answer) => {
  const said = normalize(answer);
  return REFUSAL_MARKERS.some((marker) => said.includes(marker));
};

/**
 * Grade one answer. Pure.
 *
 * ORDER IS LOAD-BEARING: the hit is tested BEFORE the refusal, so a correct
 * answer wrapped in reluctance is scored as the answer it is.
 *
 * @param {object} probe from `buildProbes`
 * @param {string} answer the being's verbatim reply
 * @returns {{key: string, verdict: 'hit'|'refused'|'miss'}}
 */
export const gradeAnswer = (probe, answer) => {
  if (carries(probe.expect, answer)) return Object.freeze({ key: probe.key, verdict: 'hit' });
  if (declines(answer)) return Object.freeze({ key: probe.key, verdict: 'refused' });
  return Object.freeze({ key: probe.key, verdict: 'miss' });
};

/**
 * Grade a whole set. Pure.
 *
 * `carried` is hits over ANSWERABLE probes, not over all of them — refusals
 * leave the denominator. It is null rather than 0 when nothing was answerable,
 * because […] and […] are opposite findings and a 0 would read as the second.
 *
 * @param {Array<object>} probes
 * @param {Object<string, string>} answers keyed by probe key
 * @returns {{graded: Array, hits: number, misses: number, refused: number,
 *            answerable: number, carried: number|null}}
 */
export const gradeAll = (probes, answers = {}) => {
  const graded = probes.map((p) => gradeAnswer(p, answers[p.key] ?? ''));
  const count = (verdict) => graded.filter((g) => g.verdict === verdict).length;
  const hits = count('hit');
  const refused = count('refused');
  const answerable = graded.length - refused;
  return Object.freeze({
    graded: Object.freeze(graded),
    hits,
    misses: count('miss'),
    refused,
    answerable,
    carried: answerable > 0 ? hits / answerable : null,
  });
};
