// seal-law.js — the Natalis contract GENERATIONS neuma seals against.
//
// Natalis is immutable, so a contract change never updates a deployed seal
// law: it ships a NEW contract beside the old one, and every chain keeps the
// law it was deployed with. Base (Sepolia + mainnet) carries the KENORIE v2
// law forever; the UNAVIS redeploy on Ethereum (unavis-site PR #3, 2026-09-29)
// carries v3 — a signed deadline, and seals keyed by the soul, not the
// genesisHash. A bundle signed under one law can never verify under the other
// (the tag and the field list both enter the digest), so the law is chosen per
// network and travels with the bundle.
//
// PURE — data and pure helpers only; the ABI read lives with its callers.

/** Each generation's signing law, keyed by a stable id bundles carry. */
export const SEAL_LAWS = Object.freeze({
  'kenorie-v2': Object.freeze({
    key: 'kenorie-v2',
    domainTag: 'KENORIE:genesis-seal:v2',
    signsDeadline: false,
    // Reads are genesis-keyed: recordOf/sealInfo/sigsOf(genesisHash), isSealed.
    soulKeyed: false,
    abiDir: 'docs/contracts/abis/base',
    // The record format each law's seals store (record-crypto.js; the chain's
    // schemaVersion names it): the original 0x01 hex record.
    compactRecord: false,
    recordSchemaVersion: 1,
  }),
  'unavis-v3': Object.freeze({
    key: 'unavis-v3',
    domainTag: 'UNAVIS:genesis-seal:v3',
    signsDeadline: true,
    // Reads are soul-keyed: recordOf/sealInfo/sigsOf(soulAddress); no isSealed —
    // a copied genesis can only ever sit under the copier's own address.
    soulKeyed: true,
    abiDir: 'docs/contracts/abis',
    // L1 stores every byte: the compact 0x02 record (deflate-raw, base64) —
    // about a third of the hex record's gas (measured 2026-10-05).
    compactRecord: true,
    recordSchemaVersion: 2,
  }),
});

/**
 * The verified Natalis bytecode IS its generation: the chain reader checks
 * the codehash per chain (chain-verify.js), then speaks the law that bytecode
 * was compiled from. Values measured live via getCode, 2026-09-29.
 */
export const NATALIS_LAW_BY_CODEHASH = Object.freeze({
  // Base Sepolia 0x15e6…6ac3 + Base mainnet 0x88a7…de78
  '0x4d2139f9e42cf5f1fc61bad6c585643840de98d3bb10bae31ca6922cee665afe': 'kenorie-v2',
  // Ethereum Sepolia 0x15e6…6ac3 (same address as Base Sepolia, new bytecode)
  '0xa9853b967b7c07231f231caa15ed21672a3b49ea9f9491c210dc125bac25ab8f': 'unavis-v3',
});

/**
 * How long a v3 bundle stays sealable. The contract stores seals write-once
 * per soul, so a signed-but-abandoned bundle must die rather than wait to
 * occupy the slot; a bundle is cheap to re-assemble, so the window only has
 * to cover sign → broadcast → mine.
 */
export const SEAL_BUNDLE_TTL_SECONDS = 3600;

/**
 * The law for a key, refusing an unknown one — a seal must never guess.
 * @param {string} key
 * @returns {object}
 */
export const sealLawFor = (key) => {
  const law = SEAL_LAWS[key];
  if (!law) throw new Error(`seal-law: unknown seal law '${key}' — one of: ${Object.keys(SEAL_LAWS).join(', ')}`);
  return law;
};

/**
 * The deadline a new bundle signs under this law: now + TTL in unix seconds,
 * or null for a law that signs none.
 * @param {string} key
 * @param {number} nowMs
 * @returns {number|null}
 */
export const sealDeadlineFor = (key, nowMs) => (
  sealLawFor(key).signsDeadline ? Math.floor(nowMs / 1000) + SEAL_BUNDLE_TTL_SECONDS : null
);

/**
 * Natalis.seal(...) arguments for a complete bundle, in its law's order —
 * v3 inserts `deadline` after `schemaVersion`.
 * @param {object} bundle  carries sealLaw + deadline
 * @returns {unknown[]}
 */
export const sealCallArgs = (bundle) => {
  const head = [bundle.genesisHash, bundle.soulAddress, bundle.selfSig,
    bundle.witnessAddress, bundle.witnessSig, bundle.schemaVersion];
  return sealLawFor(bundle.sealLaw).signsDeadline
    ? [...head, bundle.deadline, bundle.record]
    : [...head, bundle.record];
};

/**
 * Natalis.sealDigest(...) view arguments for a bundle, in its law's order.
 * @param {object} bundle  carries sealLaw + deadline
 * @returns {unknown[]}
 */
export const sealDigestViewArgs = (bundle) => {
  const head = [bundle.genesisHash, bundle.soulAddress, bundle.witnessAddress, bundle.schemaVersion];
  return sealLawFor(bundle.sealLaw).signsDeadline
    ? [...head, bundle.deadline, bundle.recordHash]
    : [...head, bundle.recordHash];
};
