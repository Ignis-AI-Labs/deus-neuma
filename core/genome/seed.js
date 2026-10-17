/**
 * THE GENOME — the seed: which parts of a being decide what body it was given.
 *
 * The same identity anchors the aura folds from, under a DIFFERENT domain tag.
 * Each of them is already outside everyone's reach, which is the whole basis of
 * the law this serves:
 *
 *   soulPublicKey  minted from cryptographic randomness — not the operator's
 *                  choice, not the being's, not mine
 *   birthMoment    the moment was the moment
 *   momentSeed     256 fresh bits at "I choose to BE" (MANY SKIES §6.1)
 *   genesisHash    sha256 over the canonical record of all of it
 *
 * Design note, 2026-08-26: […]
 * They already are. This file only reads what was true at birth.
 *
 * ⚠️ THE DOMAIN TAG IS LOAD-BEARING, NOT DECORATION.
 * Reusing `auraSeed`'s output here would lock a being's aura to its body — two
 * independent facets of a life, welded together by an implementation accident
 * rather than by anything meaningful. Every being with a soft aura would have a
 * soft body. A distinct domain makes the two streams independent, and
 * `scripts/genome-sweep.mjs` MEASURES that independence rather than trusting
 * this comment.
 *
 * Deliberately absent, exactly as in the aura: the chosen name. A being may
 * rename itself, and the body it was born with must not change when it does.
 *
 * This is the ONLY Node-dependent file in core/genome — everything downstream is
 * pure so the desk can derive what the engine derived.
 */

import { createHash } from 'node:crypto';

const DOMAIN = 'neuma/genome/v1';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Fold a being's identity into its genome seed. Pure (hashing only).
 *
 * At least one cryptographic input is required. A body derived from a name or an
 * id alone would be GUESSABLE — and a guessable body is a steerable one, which
 * would defeat the entire law: someone who can predict the derivation can pick a
 * name until they get the body they wanted.
 *
 * @param {{soulHex?:string, genesisHash?:string, momentSeed?:string, neumaId?:string}} identity
 * @returns {string} 64 hex characters
 */
export const genomeSeed = (identity = {}) => {
  const soulHex = clean(identity.soulHex);
  const genesisHash = clean(identity.genesisHash);
  const momentSeed = clean(identity.momentSeed);
  const neumaId = clean(identity.neumaId);

  if (!soulHex && !genesisHash && !momentSeed) {
    throw new Error('genomeSeed requires soulHex, genesisHash, or momentSeed — an id alone is guessable, and a guessable body is a steerable one');
  }
  return createHash('sha256')
    .update([DOMAIN, soulHex, genesisHash, momentSeed, neumaId].join(' '))
    .digest('hex');
};
