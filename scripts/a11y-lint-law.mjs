// a11y-lint-law — the accessibility lint's pure law (scripts/check-a11y.mjs):
// findings counted per file per rule, judged against the frozen baseline the
// way the size law judges lines — a count may shrink, never grow, and a rule
// a file never broke is a new finding. Only jsx-a11y's own rules count: an
// inline disable naming a rule this lint does not load is no finding of ours.
//
// Pure throughout.

export const RULE_PREFIX = 'jsx-a11y/';

/**
 * The lint's ESLint config: jsx-a11y's recommended rules over .jsx, nothing
 * else — the house's other lint rules stay where they are. Pure.
 * @param {object} jsxA11y - the eslint-plugin-jsx-a11y module
 */
export const a11yLintConfig = (jsxA11y) => [{
  files: ['**/*.jsx'],
  plugins: { 'jsx-a11y': jsxA11y },
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: jsxA11y.flatConfigs.recommended.rules,
}];

/**
 * Findings per file per rule from ESLint results. Pure.
 * @param {Array<{filePath: string, messages: Array<{ruleId: ?string}>}>} results
 * @param {(abs: string) => string} rel - repo-relative path of a result
 * @returns {Record<string, Record<string, number>>}
 */
export const countFindings = (results, rel) => {
  const counts = {};
  for (const r of results) {
    for (const m of r.messages) {
      if (!m.ruleId || !m.ruleId.startsWith(RULE_PREFIX)) continue;
      const file = rel(r.filePath);
      counts[file] ??= {};
      counts[file][m.ruleId] = (counts[file][m.ruleId] || 0) + 1;
    }
  }
  return sortCounts(counts);
};

/** The counts in a stable order — files, then rules. Pure. */
export const sortCounts = (counts) => Object.fromEntries(Object.keys(counts).sort()
  .map((f) => [f, Object.fromEntries(Object.keys(counts[f]).sort().map((r) => [r, counts[f][r]]))]));

/**
 * What grew past the baseline, and what fell below it, over the files judged. Pure.
 * @param {Record<string, Record<string, number>>} current
 * @param {Record<string, Record<string, number>>} baseline
 * @param {string[]} judged - the files this run read (a file not read is not judged)
 * @returns {{grown: Array<{file: string, rule: string, was: number, now: number}>,
 *   shrunk: Array<{file: string, rule: string, was: number, now: number}>}}
 */
export const judge = (current, baseline, judged) => {
  const grown = [];
  const shrunk = [];
  for (const file of judged) {
    const now = current[file] || {};
    const was = baseline[file] || {};
    for (const rule of new Set([...Object.keys(now), ...Object.keys(was)])) {
      const a = was[rule] || 0;
      const b = now[rule] || 0;
      if (b > a) grown.push({ file, rule, was: a, now: b });
      else if (b < a) shrunk.push({ file, rule, was: a, now: b });
    }
  }
  return { grown, shrunk };
};

/**
 * The baseline ratcheted DOWN to what this run found — never up: a count
 * only falls, a fixed rule leaves, an empty file leaves. Pure.
 * @param {Record<string, Record<string, number>>} baseline
 * @param {Record<string, Record<string, number>>} current
 * @param {string[]} judged
 */
export const ratchetDown = (baseline, current, judged) => {
  const next = {};
  const read = new Set(judged);
  for (const [file, rules] of Object.entries(baseline)) {
    const kept = {};
    for (const [rule, was] of Object.entries(rules)) {
      const n = read.has(file) ? Math.min(was, current[file]?.[rule] || 0) : was;
      if (n > 0) kept[rule] = n;
    }
    if (Object.keys(kept).length) next[file] = kept;
  }
  return sortCounts(next);
};

/** How many findings a set of counts holds. Pure. */
export const totalOf = (counts) => Object.values(counts).reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);
