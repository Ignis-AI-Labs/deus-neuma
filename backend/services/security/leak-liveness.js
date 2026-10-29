// Leak liveness — is a secret the git history leaked STILL IN USE here?
//
// A leak in a pushed commit never leaves the history, so […] can never settle one: the fix for a leak is ROTATION, not erasure.
// What the watch CAN measure is whether the leaked value is still the live
// value of some variable in the checkout's secret sources. Live → the key that
// left the machine still opens doors: critical, and the remedy names the
// variable to rotate. Not live → the house no longer uses it: what is left is
// to confirm the old key is revoked at the provider, and the CSO's
// `mitigated` on it holds (threat-lifecycle.js verifies it each scan).
//
// Matched by the one-way fingerprint both sides compute with the SAME rule
// (secret-sweep.js scanLine): the history sweep fingerprinted each match's
// material; here each live env value (secret-gate.js liveSecretsFrom) is run
// through scanLine too, so equal material gives an equal fingerprint. No
// value is ever returned, stored, compared outside this module, or logged.

import { liveSecretsFrom } from './secret-gate.js';
import { collectLiveSecretSources } from './secret-sources.js';
import { scanLine } from './secret-sweep.js';
import { rotationRemedy } from './threat-remedy.js';

const HISTORY_ID = /^history:/;

/**
 * pure — every live env value's `rule:fingerprint` → the variables holding it
 * ({name: 'DEPLOYER_PRIVATE_KEY', file: '.env'}). A wallet key is fingerprinted by its hex
 * alone, whatever its variable is called, so each value is also read as if it
 * stood under a PRIVATE_KEY name: the EVM rule needs that prefix to match,
 * and its material is the hex either way.
 * @param {Array<{file: string, text: string}>} envFiles
 * @returns {Map<string, Array<{name: string, file: string}>>}
 */
const liveFingerprints = (envFiles) => {
  const where = new Map();
  for (const { value, name, file } of liveSecretsFrom(envFiles)) {
    for (const line of [`${name}=${value}`, `PRIVATE_KEY=${value}`]) {
      for (const { patternId, fingerprint } of scanLine(line)) {
        const key = `${patternId}:${fingerprint}`;
        const known = where.get(key) || [];
        if (!known.some((h) => h.name === name && h.file === file)) where.set(key, [...known, { name, file }]);
      }
    }
  }
  return where;
};

/**
 * pure — history findings with their liveness: `live`, severity, summary and
 * remedy rewritten by it. `where` null = the secret sources could not all be read,
 * so liveness is unknown (`live: null`) and the finding stands as swept.
 * @param {Array<Object>} findings sweepRepoHistory findings
 * @param {Map<string, Array<{name: string, file: string}>>|null} where liveFingerprints() of the checkout
 * @returns {Array<Object>}
 */
const markLeakLiveness = (findings, where) => findings.map((finding) => {
  if (finding.source !== 'secret-sweep' || !HISTORY_ID.test(finding.externalId)) return finding;
  if (!where) return { ...finding, live: null };
  const holders = where.get(`${finding.patternId}:${finding.fingerprint}`) || [];
  if (holders.length) {
    const liveAs = holders.map((h) => `${h.name} in ${h.file}`).join(', ');
    const names = [...new Set(holders.map((h) => h.name))].join(', ');
    const files = [...new Set(holders.map((h) => h.file))].join(', ');
    return {
      ...finding,
      live: true,
      liveAs,
      severity: 'critical',
      summary: `Still live as ${liveAs}. ${finding.summary}`,
      remedy: `${rotationRemedy(finding.patternId, names)}; put the NEW value in ${files} — the leaked one stays in history for good.`,
    };
  }
  return {
    ...finding,
    live: false,
    severity: 'high',
    summary: `No longer in use on this machine — no env file of this checkout holds the value. ${finding.summary}`,
    remedy: `confirm the old ${finding.patternId} credential is revoked at the provider, then mark this mitigated — the history keeps it, and that is expected: a leak is fixed by rotation, not erasure.`,
  };
});

/**
 * impure — the checkout's live secret sources, the SAME set the commit gate
 * guards (secret-sources.js): root env files (a symlinked .env followed),
 * ignored env files deeper in, the machine's secret stores. Reading only the
 * root's regular files said "not live" for a linked .env or a backend/.env,
 * and the watch then verified a CSO's claim on a key still in use
 * (security-seat recheck, 2026-10-20). Null when a source could not be read:
 * a blind read must not report "not live".
 * @param {string} root
 * @returns {Array<{file: string, text: string}>|null}
 */
const readSecretSources = (root) => {
  try {
    return collectLiveSecretSources(root);
  } catch {
    return null;
  }
};

/**
 * impure — one checkout's history findings, each marked live or not against
 * that checkout's live secret sources.
 * @param {string} root the watched checkout
 * @param {Array<Object>} findings its history findings
 */
export const checkLeakLiveness = async (root, findings) => {
  if (!findings.length) return findings;
  const sources = readSecretSources(root);
  return markLeakLiveness(findings, sources ? liveFingerprints(sources) : null);
};
