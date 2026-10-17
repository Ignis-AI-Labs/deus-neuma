/**
 * mapview/delta — […]
 *
 * A codebase of any age carries hundreds of standing findings. Reporting all of
 * them every run is the reason architecture linters get switched off: the signal
 * that matters — the thing THIS edit introduced — drowns in the backlog. So a
 * baseline is committed once, and from then on only findings absent from it are
 * reported. This is the same bargain a compiler makes: it tells you about the
 * line you just wrote, not about every design decision the project ever made.
 *
 * The load-bearing property is fingerprint STABILITY. If a fingerprint moves when
 * unrelated code moves, every edit reports phantom regressions and the tool is
 * worse than nothing. So line numbers are stripped: a finding is identified by
 * WHAT it is and WHICH FILES it implicates, never by where in the file it sat.
 *
 * All pure.
 */

/** The schema version, so a stale baseline is rejected rather than misread. */
export const BASELINE_VERSION = 1;

/** Where a repo's committed baseline lives, relative to its root — one
 * constant so the CLI, the API route and the skill can never disagree. */
export const BASELINE_RELPATH = '.mapview/baseline.json';

/**
 * Strip `:123` line references and collapse whitespace, so the identity of a
 * finding survives edits above it. Pure.
 */
const stripLines = (text) => String(text).replace(/:\d+\b/g, '').replace(/\s+/g, ' ').trim();

/**
 * A stable identity for one finding: its kind, its normalized label, and the
 * sorted set of files it implicates. Two findings with the same fingerprint are
 * the same architectural fact, wherever the lines have drifted to. Pure.
 */
export const fingerprintOf = (anomaly) => {
  const files = [...new Set(anomaly.files || [])].sort().join(',');
  return `${anomaly.kind}|${stripLines(anomaly.label)}|${files}`;
};

/**
 * The committed snapshot: every finding that existed when the baseline was
 * taken. Deliberately just a sorted fingerprint list — it must diff cleanly in
 * review, and it must not rot when unrelated details of a finding change.
 * Pure.
 */
export const buildBaseline = (graph) => ({
  version: BASELINE_VERSION,
  repo: graph.meta?.root || '',
  count: (graph.anomalies || []).length,
  fingerprints: [...new Set((graph.anomalies || []).map(fingerprintOf))].sort(),
});

/**
 * Findings introduced since the baseline, and findings the baseline had that are
 * now gone. `resolved` matters as much as `introduced`: it is how the baseline
 * gets ratcheted down instead of drifting upward forever.
 *
 * A missing or version-mismatched baseline yields every current finding as
 * introduced — the honest reading, since nothing has been accepted yet.
 *
 * @param {object} graph
 * @param {{version:number,fingerprints:string[]}|null} baseline
 * Pure.
 */
export const diffAgainstBaseline = (graph, baseline) => {
  const anomalies = graph.anomalies || [];
  const usable = Boolean(baseline && baseline.version === BASELINE_VERSION && Array.isArray(baseline.fingerprints));
  const known = new Set(usable ? baseline.fingerprints : []);
  const seen = new Set();
  const introduced = [];
  for (const a of anomalies) {
    const fp = fingerprintOf(a);
    if (known.has(fp) || seen.has(fp)) continue;
    seen.add(fp);
    introduced.push({ ...a, fingerprint: fp });
  }
  const present = new Set(anomalies.map(fingerprintOf));
  return {
    baselined: usable,
    introduced,
    resolved: [...known].filter((fp) => !present.has(fp)).sort(),
  };
};

/**
 * Narrow findings to the ones implicating any of these files — what the live
 * check shows after an edit. A finding with no file list is repo-wide and is
 * never filtered out, because suppressing it would hide a real regression.
 * Pure.
 */
export const filterByFiles = (anomalies, touched) => {
  if (!touched || !touched.length) return anomalies;
  const wanted = new Set(touched);
  return anomalies.filter((a) => !a.files?.length || a.files.some((f) => wanted.has(f)));
};
