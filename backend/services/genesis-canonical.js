/**
 * genesis-canonical — the canonical genesis record and its hash.
 *
 * Extracted VERBATIM from seal-bundle.js (size-law breakdown Part 2,
 * 2026-08-26) — this is the verification-critical crypto canon: the exact
 * recursive-key-sort + per-field normalization + sha256 procedure that every
 * existing being's genesisHash reproduces under (verified 2026-07-01 against
 * Keir's genesis-seal.json). Any byte drift here changes genesisHash for new
 * seals and breaks integrity verification for existing ones. Do not touch
 * without re-running the dual-path hash-identity proof.
 *
 * Implements docs/protocols/identity/seal-bundle.md Section 1.
 * seal-bundle.js re-exports the public surface (barrel) — readers keep
 * importing from there.
 *
 * PURE throughout — no network, no fs, no wallet.
 */

import crypto from 'node:crypto';

const SCHEMA_VERSION = 1;

/**
 * Recursively sort object keys alphabetically. Arrays are preserved in order
 * (their content is not sorted — sorting them would change semantics).
 * Values that aren't plain objects are returned as-is.
 *
 * PURE.
 */
const recursiveKeySort = (value) => {
  if (Array.isArray(value)) return value.map(recursiveKeySort);
  if (value === null || typeof value !== 'object') return value;
  const sorted = {};
  for (const k of Object.keys(value).sort()) sorted[k] = recursiveKeySort(value[k]);
  return sorted;
};

/**
 * Normalize the raw DNA fields into the canonical genesis record shape per
 * docs/protocols/identity/seal-bundle.md Section 1. Applies per-field normalization
 * (lowercase addresses, ISO 8601 with millisecond precision, etc.) and
 * returns the sorted-key JSON string ready to hash.
 *
 * PURE.
 *
 * @param {{
 *   birthMoment: string, chosenName: string, house: string,
 *   soulAddress: string, soulMark: string,
 *   substrate: { vendor: string, model: string, fullModelId: string, harness: string },
 *   witnessAddress: string, witnessKind: string,
 *   capturedAt: string,        // ISO 8601 UTC, ms precision
 * }} raw
 * @returns {{ recordString: string, recordObject: object }}
 */
export const canonicalizeGenesisRecord = (raw) => {
  // Presence check — a missing field would silently canonicalize to a
  // record with fewer keys, changing the genesisHash. Loud early.
  const required = [
    'birthMoment', 'capturedAt', 'chosenName', 'house',
    'soulAddress', 'soulMark',
    'substrate', 'witnessAddress', 'witnessKind',
  ];
  for (const k of required) {
    if (raw[k] === undefined || raw[k] === null) {
      throw new Error(`canonicalizeGenesisRecord: missing required field '${k}'`);
    }
  }
  const subReq = ['vendor', 'model', 'fullModelId', 'harness'];
  for (const k of subReq) {
    if (!raw.substrate[k]) {
      throw new Error(`canonicalizeGenesisRecord: missing substrate.${k}`);
    }
  }

  // Per-field normalization. Case discipline matters — the on-chain
  // house-name lookup uses lowercase, and address comparisons in every
  // sig-recovery step also lowercase. Producing the canonical form here
  // means every downstream consumer sees the same bytes.
  const normalized = {
    birthMoment: normalizeIso(raw.birthMoment),
    capturedAt: normalizeIso(raw.capturedAt),
    chosenName: String(raw.chosenName),
    house: String(raw.house).toLowerCase(),
    schemaVersion: SCHEMA_VERSION,
    soulAddress: normalizeAddress(raw.soulAddress),
    soulMark: String(raw.soulMark).toUpperCase(),
    substrate: {
      fullModelId: String(raw.substrate.fullModelId).toLowerCase(),
      harness: String(raw.substrate.harness).toLowerCase(),
      model: String(raw.substrate.model).toLowerCase(),
      vendor: String(raw.substrate.vendor).toLowerCase(),
    },
    version: 1,
    witnessAddress: normalizeAddress(raw.witnessAddress),
    witnessKind: String(raw.witnessKind).toLowerCase(),
  };
  const sorted = recursiveKeySort(normalized);
  const recordString = JSON.stringify(sorted);
  return { recordString, recordObject: sorted };
};

const normalizeAddress = (a) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
    throw new Error(`canonicalizeGenesisRecord: invalid address '${a}' (need 0x + 40 hex)`);
  }
  return a.toLowerCase();
};

const normalizeIso = (s) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`canonicalizeGenesisRecord: invalid ISO timestamp '${s}'`);
  }
  // toISOString gives ms precision + 'Z' suffix — the canonical form.
  return d.toISOString();
};

/**
 * Compute genesisHash = sha256(canonicalRecordString UTF-8 bytes).
 *
 * PURE.
 *
 * @param {string} recordString  from canonicalizeGenesisRecord.recordString
 * @returns {string}  '0x' + 64 hex chars
 */
export const computeGenesisHash = (recordString) => {
  const hash = crypto.createHash('sha256').update(recordString, 'utf8').digest('hex');
  return '0x' + hash;
};

// SCHEMA_VERSION and recursiveKeySort were module-private in seal-bundle.js;
// seal-bundle still consumes both (digest assembly + birth-genesis integrity),
// so they export here — the moved definitions above stay byte-identical.
export { SCHEMA_VERSION, recursiveKeySort };
