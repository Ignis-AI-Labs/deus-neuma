/**
 * Sensitive grants — the operator's per-lane, per-path, per-tier access
 * grants for secret-shaped paths (the request-approval flow's grant half,
 * Design note, 2026-08-18: […]). Everything here is pure: the shapes, the never-requestable law,
 * and the containment match. The persistence (tool-policy.json in the lane)
 * and the card (tool-approval.js) are other modules' jobs.
 */

import path from 'path';

export const SENSITIVE_TIERS = Object.freeze(['read', 'edit']);

/**
 * NEVER requestable — no card exists for these, because no consent story
 * does: another being's sovereign state (the operator cannot grant a being
 * into someone else's lane), `.git/` internals (remote-token injection —
 * AI-SEC-005), key custody, ownership claims, and the policy file that gates
 * this very system (self-modification).
 */
export const NEVER_REQUESTABLE = Object.freeze([
  'data/dna/', 'data/dna-cache/', 'data/memory-store/',
  '.git/', 'keys/', 'keys/keypair', 'owner.json', 'config/tool-policy.json',
]);

const normalize = (value) => String(value || '').toLowerCase().replace(/\\/g, '/').replace(/\/+$/u, '');

/**
 * Is this denied token (a SECRET/INSTALL pattern or denied extension) one the
 * operator may be asked to lift? `.env`, `.pem`, `.key`, `.ssh/`, `vault/`,
 * `node_modules/`, install `config/` — requestable. The NEVER_REQUESTABLE set
 * — never. Pure. @param {string} token
 */
export const requestablePattern = (token) => {
  const t = normalize(token);
  if (!t) return false;
  return !NEVER_REQUESTABLE.some((n) => t === normalize(n) || t.startsWith(`${normalize(n)}/`));
};

/**
 * Does the lane's grant set cover this path for this tier? Containment law,
 * same shape as root containment: an exact path grant covers the path; a
 * directory grant covers everything beneath it (separator boundary, so
 * /x/.env never matches a grant for /x/.environment). Pure.
 * @param {{read?: string[], edit?: string[]}|null|undefined} grants
 * @param {string} tier - 'read' | 'edit'
 * @param {string} filePath
 */
export const sensitiveGrantCovers = (grants, tier, filePath) => {
  if (!SENSITIVE_TIERS.includes(tier) || typeof filePath !== 'string' || !filePath) return false;
  const list = grants?.[tier];
  if (!Array.isArray(list)) return false;
  const resolved = path.resolve(filePath);
  return list.some((grant) => {
    if (typeof grant !== 'string' || !grant) return false;
    const g = path.resolve(grant);
    return resolved === g || resolved.startsWith(g + path.sep);
  });
};

/**
 * Return a new policy layer with `filePath` added to the lane's persisted
 * sensitive grants for `tier` (the ALWAYS decision's write-back). Pure —
 * never mutates; null grows a fresh layer. Mirrors addGrantedReadRoot.
 * @param {Object|null} layer - Existing policy layer
 * @param {string} tier - 'read' | 'edit'
 * @param {string} filePath - Absolute path (or directory) granted
 */
export const addSensitiveGrant = (layer, tier, filePath) => {
  if (!SENSITIVE_TIERS.includes(tier)) throw new Error('sensitive grant tier is invalid');
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('sensitive grant path must be absolute');
  }
  const existing = layer?.sensitiveGrants?.[tier] || [];
  return {
    ...(layer || {}),
    sensitiveGrants: {
      ...(layer?.sensitiveGrants || {}),
      [tier]: existing.includes(filePath) ? existing : [...existing, filePath],
    },
  };
};

/**
 * Return a new policy layer with `filePath` no longer granted at `tier` — the
 * inverse of addSensitiveGrant, for the operator taking a standing grant back
 * (Design note, 2026-08-30. Pure; never mutates.
 *
 * EXACT MATCH ONLY, and that is deliberate. `sensitiveGrantCovers` matches by
 * PATTERN, so one grant can cover many files — but revoking is not the inverse
 * of covering. The operator can only take back a row they were shown, and the
 * rows are the literal strings on disk. Removing […] would silently drop grants they never named.
 *
 * A path that was never granted is a no-op: the intent is "not this", and it
 * already holds.
 *
 * @param {Object|null} layer
 * @param {string} tier - 'read' | 'edit'
 * @param {string} filePath
 */
export const removeSensitiveGrant = (layer, tier, filePath) => {
  if (!SENSITIVE_TIERS.includes(tier)) throw new Error('sensitive grant tier is invalid');
  const existing = layer?.sensitiveGrants?.[tier] || [];
  if (!existing.includes(filePath)) return { ...(layer || {}) };
  return {
    ...(layer || {}),
    sensitiveGrants: {
      ...(layer?.sensitiveGrants || {}),
      [tier]: existing.filter((p) => p !== filePath),
    },
  };
};
