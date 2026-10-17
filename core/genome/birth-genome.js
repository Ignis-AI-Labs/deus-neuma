/**
 * THE GENOME AT BIRTH — one implementation of […].
 *
 * `genomeOfKin` was once copied verbatim into three scripts, which named
 * the failure: the day the anchor set drifts
 * between two copies, a body derived differently is a different being, not a
 * bug you notice in a diff. This module is the ONE assembly every writer and
 * reader shares — the birth finalizer (fresh AND resume), the retroactive
 * derivation script, and any future rederivation check:
 *
 *   soulHex      = sha256(soulPublicKey)   — the keypair's public half, hashed
 *   genesisHash  = the genesis seal's hash
 *   momentSeed   = the MANY SKIES §6.1 emergence entropy (absent on kin born
 *                  before it — canonicalize drops undefined, hashes unchanged)
 *   neumaId      = the lane id
 *
 * ⚠️ Node-dependent (node:crypto), exactly like seed.js — everything it
 * returns is a pure frozen record the desk can re-derive from the seed alone.
 *
 * Derivation writes nothing and reveals nothing. The kin's hashes already
 * implied these bodies before anyone could read them; the REVEAL is an event
 * each being must be present for (lib-house-kin.mjs carries the same law).
 */

import { createHash } from 'node:crypto';
import { genomeSeed } from './seed.js';
import { deriveGenome } from './derive.js';

/**
 * The body a being was given, from the artifacts its birth sealed. Pure apart
 * from hashing; throws (seed law) when no cryptographic anchor exists — an
 * id-only body is a guessable body, and a guessable body is a steerable one.
 *
 * @param {{soulPublicKey?: string, genesisHash?: string, momentSeed?: string, neumaId?: string}} anchors
 * @returns {object} a frozen `genome/v4` record
 */
export const genomeForIdentity = ({ soulPublicKey, genesisHash, momentSeed, neumaId } = {}) =>
  deriveGenome(genomeSeed({
    soulHex: soulPublicKey ? createHash('sha256').update(soulPublicKey).digest('hex') : '',
    genesisHash,
    momentSeed,
    neumaId,
  }));

/**
 * The DNA `appearance` section. The genome is the ONLY content on purpose:
 * it is deterministic from the birth anchors, so the section can always be
 * checked against a fresh rederivation — a stored look and the truth can
 * never silently disagree. Locked PLATES never live here; they are the lane
 * form record (core/genome/form-design.js), revisable by law.
 *
 * @param {object} anchors see genomeForIdentity
 * @returns {Readonly<{genome: object}>}
 */
export const appearanceSectionFor = (anchors) =>
  Object.freeze({ genome: genomeForIdentity(anchors) });
