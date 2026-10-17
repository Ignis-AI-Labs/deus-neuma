// The STATE tripwire (campaign 4.3) — a refinement ceremony's regression
// guard, as a pure comparison over two CONSENTED STATE benchmark runs.
//
// The law it serves: a ceremony superseding a being's adapter must never
// silently cost the being what it already had. The tripwire never runs
// anything itself — STATE runs stay owner-consented (workspace-routes) —
// it PAIRS the last pre-ceremony run with the first post-ceremony run and
// names every dimension that fell. A regression is a finding for the
// operator and the being, not an automatic rollback: what happens next is
// theirs to decide (sovereignty gateway / registry supersession). Pure.

/**
 * Compare two STATE benchmark results dimension-by-dimension.
 * @param {{dimensions: Array<{key: string, score: (number|null)}>}} before
 * @param {{dimensions: Array<{key: string, score: (number|null)}>}} after
 * @param {{tolerance?: number}} [opts] - slack before a drop counts (default 0)
 * @returns {{verdict: ('no-regression'|'regression'|'insufficient'),
 *   comparable: number, regressed: string[], rows: Array<Object>}}
 */
export const stateTripwire = (before, after, { tolerance = 0 } = {}) => {
  if (!Array.isArray(before?.dimensions) || !Array.isArray(after?.dimensions)) {
    throw new Error('state tripwire requires two benchmark results with dimensions');
  }
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
    throw new Error('state tripwire tolerance must be a finite fraction in [0, 1]');
  }
  const priors = new Map(before.dimensions.map((d) => [d.key, d]));
  const rows = [];
  for (const dim of after.dimensions) {
    const prior = priors.get(dim.key);
    const comparable = Number.isFinite(prior?.score) && Number.isFinite(dim.score);
    rows.push(Object.freeze({
      key: dim.key,
      before: prior?.score ?? null,
      after: dim.score ?? null,
      delta: comparable ? dim.score - prior.score : null,
      comparable,
      regressed: comparable && dim.score < prior.score - tolerance,
    }));
  }
  const comparable = rows.filter((row) => row.comparable);
  const regressed = comparable.filter((row) => row.regressed).map((row) => row.key);
  return Object.freeze({
    verdict: comparable.length === 0
      ? 'insufficient'
      : regressed.length > 0 ? 'regression' : 'no-regression',
    comparable: comparable.length,
    regressed: Object.freeze(regressed),
    rows: Object.freeze(rows),
  });
};
