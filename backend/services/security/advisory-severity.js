// Advisory severity — one OSV record onto the ledger's vocabulary.
//
// Three readings, the worst wins:
//   - a MAL-* id is a published MALICIOUS package (OpenSSF malicious-packages):
//     a hijacked dependency is the worst case the watch exists for, and those
//     records carry no severity at all — read as `unknown` they raised no alert.
//   - GitHub's reviewed word in `database_specific.severity`.
//   - the CVSS v3 vector in `severity[]`, scored here, so a record without
//     GitHub's word still lands on a band. (CVSS v4 needs the spec's
//     macro-vector lookup table; in the 2026-10-19 audit all 72 of 189 live
//     records that carried a v4 vector also carried GitHub's word, so v4 is
//     left to that reading.)
// The record is re-read on every scan, so an advisory GitHub re-rates
// (GHSA-r292: medium at ingest, high today) arrives re-rated.

const RANK = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3, critical: 4 });
const BY_RANK = Object.freeze(['unknown', 'low', 'medium', 'high', 'critical']);

// CVSS v3.1 base metric weights (FIRST spec §7.4).
const AV = Object.freeze({ N: 0.85, A: 0.62, L: 0.55, P: 0.2 });
const AC = Object.freeze({ L: 0.77, H: 0.44 });
const PR_UNCHANGED = Object.freeze({ N: 0.85, L: 0.62, H: 0.27 });
const PR_CHANGED = Object.freeze({ N: 0.85, L: 0.68, H: 0.5 });
const UI = Object.freeze({ N: 0.85, R: 0.62 });
const CIA = Object.freeze({ H: 0.56, L: 0.22, N: 0 });

// pure — the spec's Roundup: smallest one-decimal number >= x, computed on
// integers so float noise (e.g. 4.000000001) never bumps a band.
const roundUp = (x) => {
  const scaled = Math.round(x * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10;
};

/**
 * pure — the CVSS v3.x base score of a vector string, or null when the
 * vector is not a complete v3 base vector.
 * @param {string} vector e.g. […]
 * @returns {number|null}
 */
export const cvss3BaseScore = (vector) => {
  if (typeof vector !== 'string' || !/^CVSS:3\.[01]\//.test(vector)) return null;
  const m = Object.fromEntries(vector.split('/').slice(1).map((part) => part.split(':')));
  const changed = m.S === 'C';
  const weights = [AV[m.AV], AC[m.AC], (changed ? PR_CHANGED : PR_UNCHANGED)[m.PR], UI[m.UI], CIA[m.C], CIA[m.I], CIA[m.A]];
  if (!['U', 'C'].includes(m.S) || weights.some((w) => w === undefined)) return null;
  const [av, ac, pr, ui, c, i, a] = weights;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  return roundUp(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10));
};

// pure — a CVSS score onto the qualitative bands (spec §5); 0.0 is "none".
export const bandOfScore = (score) => {
  if (typeof score !== 'number' || score <= 0) return 'unknown';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
};

// pure — GitHub's word onto the ledger's.
const bandOfWord = (word) => {
  const w = String(word || '').toLowerCase();
  if (w === 'moderate') return 'medium';
  return w in RANK ? w : 'unknown';
};

/**
 * pure — the ledger severity of one OSV record: the worst of its readings.
 * A bare `{ id }` (detail fetch failed) still rates a MAL-* id critical.
 * @param {Object} vuln an OSV vulnerability record
 * @returns {'critical'|'high'|'medium'|'low'|'unknown'}
 */
export const severityOf = (vuln) => {
  if (typeof vuln?.id === 'string' && vuln.id.startsWith('MAL-')) return 'critical';
  const readings = [
    bandOfWord(vuln?.database_specific?.severity),
    ...(Array.isArray(vuln?.severity) ? vuln.severity : [])
      .filter((s) => typeof s?.type === 'string' && s.type.startsWith('CVSS_V3'))
      .map((s) => bandOfScore(cvss3BaseScore(s.score))),
  ];
  return BY_RANK[Math.max(...readings.map((r) => RANK[r]))];
};
