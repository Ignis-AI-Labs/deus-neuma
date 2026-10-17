/**
 * The refinement authority hash — the one canonicalization every refinement
 * custody check agrees on.
 *
 * This file used to carry a `createContext` transaction facade: bounded
 * custody/owner/ceremony reads, ceremony preparation, and commit with
 * stale-and-durability detection. Nothing ever called it. The refinement lane
 * grew its transaction handling in refinement-ceremony-transaction.js and
 * refinement-training-launch.js instead, and the facade was left behind —
 * 185 of 201 lines existing only to serve a function no importer ever named,
 * and invisible to the scanner because a private helper is not a dead export.
 * Cut 2026-08-22 (#389 tail); git history holds the facade if the lane ever
 * wants that shape back.
 *
 * All five importers take exactly one symbol from here, which is now all
 * there is.
 */
import { canonicalAuthoritySha256 } from '../../core/shared/plain-data-canonical.js';

/**
 * Canonical SHA-256 of a refinement authority value under a caller-named
 * domain. The bounds are part of the contract, not a tuning knob: two callers
 * hashing the same value under the same domain must agree byte for byte, so
 * they are fixed here rather than passed in. Pure.
 * @param {unknown} value
 * @param {string} domain - e.g. 'neuma.refinement.custody-authority'
 * @returns {string} sha256 hex
 */
export const refinementAuthoritySha256 = (value, domain) => canonicalAuthoritySha256(value, {
  domain, schemaVersion: 2, maxDepth: 48, maxNodes: 250_000,
  maxStringBytes: 16 * 1024 * 1024, maxKeyBytes: 64 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});
