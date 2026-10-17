/**
 * mapview/protocol — MEASURED protocol law (MAPVIEW-012, #392).
 *
 * The repo keeps two measured laws (the size ratchet, the signed layer law)
 * and a long tail of PROSE rules that nothing enforces. This module grows the
 * third backbone the same way layers.js did: a rule fires ONLY when it stands
 * in mapview.config.json's `protocol.rules` carrying the operator's signature
 * and dated reason. `protocolProposed` is the inbox — evidence-backed rows the
 * tool proposes from real scans, INERT until Founder moves them across. Unsigned
 * law does nothing; the tool never invents authority.
 *
 * A rule is a trivially measurable in-file predicate:
 *   { id, signedBy, reason,
 *     appliesTo: ['frontend', ...],      // path prefixes; '' = whole repo
 *     excludePaths?: ['frontend/vendor'],
 *     forbidExtensions?: ['.ts', '.tsx'],  // predicate A: banned file types
 *     forbidPattern?: 'regex-source' }     // predicate B: banned code token
 *
 * Patterns match MASKED text (comments and string contents blanked, extract.js
 * maskNonCode) so doctrine comments QUOTING a banned token can never raise a
 * finding — the same honesty rule every extractor here lives by. Findings ride
 * the ordinary anomaly pipeline, so baseline/delta applies unchanged. Pure.
 */

import { maskNonCode } from './extract.js';

const inScope = (relFile, rule) => {
  const applies = (rule.appliesTo || ['']).some((p) => p === '' || relFile === p || relFile.startsWith(`${p}/`));
  if (!applies) return false;
  return !(rule.excludePaths || []).some((p) => relFile === p || relFile.startsWith(`${p}/`));
};

/**
 * Every violation of every SIGNED rule, as ordinary anomalies.
 * @param {{relFile: string, text: string}[]} files - production + test files
 * @param {object[]|null} rules - config.protocol.rules (signed rows only)
 * @returns {{kind: string, severity: string, label: string, files: string[], detail: string}[]}
 */
export const findProtocolViolations = (files, rules) => {
  if (!Array.isArray(rules) || !rules.length) return [];
  const out = [];
  const masked = new Map(); // relFile -> masked text, computed once per implicated file
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string' || !rule.signedBy) continue; // unsigned = inert, always
    const re = rule.forbidPattern ? new RegExp(rule.forbidPattern, rule.flags || '') : null;
    const exts = Array.isArray(rule.forbidExtensions) ? rule.forbidExtensions : null;
    for (const f of files) {
      if (!inScope(f.relFile, rule)) continue;
      const extHit = exts && exts.some((e) => f.relFile.toLowerCase().endsWith(e));
      let tokenHit = false;
      if (re && !extHit) {
        if (!masked.has(f.relFile)) masked.set(f.relFile, maskNonCode(f.text || ''));
        tokenHit = re.test(masked.get(f.relFile));
      }
      if (!extHit && !tokenHit) continue;
      out.push({
        kind: 'protocol',
        severity: 'warn',
        label: `${rule.id} ${f.relFile}`,
        files: [f.relFile],
        detail: `${rule.reason} (signed: ${rule.signedBy})`,
      });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
};
