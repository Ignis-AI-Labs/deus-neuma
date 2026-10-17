/**
 * Registry Digest — the canonical hash primitives of the refinement
 * registry, shared by the v2 contract (`registry-contract.js`) and the
 * legacy v1 reader (`registry-contract-legacy-v1.js`) so neither imports
 * the other. Pure.
 */
import { canonicalAuthoritySha256 } from '../shared/plain-data-canonical.js';

export const SCHEMA_VERSION = 2;

/** Canonical authority digest under the registry's schema version. Pure. */
export const digest = (domain, value) => canonicalAuthoritySha256(value, {
  domain,
  schemaVersion: SCHEMA_VERSION,
  maxDepth: 64,
  maxNodes: 250_000,
  maxOutputBytes: 16 * 1024 * 1024,
});

/** Digest of a validated adapter id — the identity key of every entry. Pure. */
export const refinementAdapterIdSha256 = (adapterId) => {
  if (typeof adapterId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(adapterId)) {
    throw new Error('registry adapter id is invalid');
  }
  return digest('neuma.refinement.adapter-id', { adapterId });
};
