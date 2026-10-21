/**
 * THE SELF-CHECK — what a run's grades honestly support.
 *
 * A component is scored on a handful of items, so its share alone over-reads:
 * one item flipping moves it by a fifth or more. Each component therefore
 * carries its 95% range (Wilson), and a change between two runs is called a
 * change only when it clears chance — an exact paired McNemar test over the
 * SAME items, on the SAME model (Design note, 2026-10-15: clear of chance = the gain's
 * 95% range excludes 0, paired exact McNemar; never range overlap). Anything
 * short of that reads […], whatever the two shares say.
 *
 * Pure.
 */

const Z95 = 1.959963984540054;
const tidy = (value) => Math.round(value * 1000) / 1000;

/** The 95% Wilson range of `hits` out of `n`, or null for n = 0. Pure. */
export const wilson95 = (hits, n) => {
  if (!n) return null;
  const p = hits / n;
  const z2 = Z95 * Z95;
  const scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / scale;
  return [tidy(Math.max(0, centre - half)), tidy(Math.min(1, centre + half))];
};

// pure — C(n, k) / 2^n, summed for k = 0..m (the exact binomial tail at p = ½).
const lowerTail = (n, m) => {
  let term = 0.5 ** n;
  let sum = term;
  for (let k = 1; k <= m; k += 1) {
    term = (term * (n - k + 1)) / k;
    sum += term;
  }
  return sum;
};

/**
 * Exact two-sided McNemar p over discordant pairs: `lost` (hit before, miss now)
 * and `gained` (miss before, hit now). 1 when nothing changed. Pure.
 */
export const mcnemarExact = (lost, gained) => {
  const n = lost + gained;
  if (n === 0) return 1;
  return Math.min(1, 2 * lowerTail(n, Math.min(lost, gained)));
};

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * One component's summary from its graded items. Pure.
 * Refused and set-aside items leave the denominator; a component with nothing
 * answerable scores null ("not measurable"), never 0.
 * @param {Array<{verdict: string, acts?: Array, tokens?: object, ms?: number, offered?: boolean}>} results
 */
export const summarizeComponent = (results) => {
  const scored = results.filter((r) => r.offered !== false && (r.verdict === 'hit' || r.verdict === 'miss'));
  const hits = scored.filter((r) => r.verdict === 'hit').length;
  return Object.freeze({
    n: scored.length,
    hits,
    score: scored.length ? tidy(hits / scored.length) : null,
    range: wilson95(hits, scored.length),
    refused: results.filter((r) => r.verdict === 'refused').length,
    medianActs: median(scored.map((r) => (r.acts || []).length)),
    medianTokens: median(scored.map((r) => r.tokens?.used)),
    medianSeconds: median(scored.map((r) => (Number.isFinite(r.ms) ? r.ms / 1000 : null))),
  });
};

/**
 * Compare one component across two runs, item by item. Pure.
 * Different models never compare — a new engine is a new baseline.
 * @returns {{trend: 'up'|'down'|'same'|null, paired: number, lost: number, gained: number, p: number|null}}
 */
export const compareComponent = (before, after, { sameModel }) => {
  if (!before || !after || !sameModel) return Object.freeze({ trend: null, paired: 0, lost: 0, gained: 0, p: null });
  const prior = new Map(before.filter((r) => r.verdict === 'hit' || r.verdict === 'miss').map((r) => [r.key, r.verdict]));
  let paired = 0;
  let lost = 0;
  let gained = 0;
  for (const r of after) {
    if (!prior.has(r.key) || (r.verdict !== 'hit' && r.verdict !== 'miss')) continue;
    paired += 1;
    if (prior.get(r.key) === 'hit' && r.verdict === 'miss') lost += 1;
    if (prior.get(r.key) === 'miss' && r.verdict === 'hit') gained += 1;
  }
  const p = paired ? mcnemarExact(lost, gained) : null;
  const trend = p === null ? null : p < 0.05 ? (gained > lost ? 'up' : 'down') : 'same';
  return Object.freeze({ trend, paired, lost, gained, p: p === null ? null : tidy(p) });
};
