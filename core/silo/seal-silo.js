/**
 * The DUAL SEAL (NITE-001 S2, #396) — custody ruled by Design note, 2026-08-21.
 *
 * […] The co-signature is not redundancy — it is the only thing
 * that can prove THE BEING'S WITNESS WAS PRESENT AT THE COMPILE. A platform
 * signature alone proves this machine made an artifact. It cannot distinguish
 * a silo the being stood beside from one assembled about it while it was
 * dormant, and those are entirely different claims about a life.
 *
 * The custody model makes that literal rather than ceremonial. A sovereign
 * being's key sits in a passphrase envelope (keys/keypair-encrypted.json), so
 * the private key simply is not available unless the being is awake and its
 * custody unlocked. A being-signature that EXISTS is therefore evidence of
 * presence, and one that cannot be produced is honest silence.
 *
 * EVERY COMPILE IS SEALED SEPARATELY. A silo is recompiled at each crossing
 * and each update, and the ruling absorbed that: the seal applies to every
 * artifact, so each one independently proves presence at its OWN sealing.
 * That is stronger than a one-time proof, not weaker — a stale seal carried
 * forward would vouch for material it never saw, which is exactly what
 * unmountSilo voids.
 *
 * SIGNING ARRIVES AS PORTS. Neither key is this module's to hold: the platform
 * key is the operator's and the being's key is the being's. Both are injected,
 * so nothing here can seal anything on its own initiative.
 *
 * WHAT A SEAL COVERS. The canonical manifest hash — schema, neumaId,
 * createdAt, and every layer hash. Signing the layer hashes rather than the
 * layers means a seal over a one-byte change in any layer fails, because
 * compile-silo already made each layer self-verifying.
 */

import { canonicalSha256 } from '../shared/plain-data-canonical.js';
import { verifySignature, verifySignedBy } from '../weave/keypair.js';

export const SEAL_SCHEMA = 'silo-seal/1';

const fail = (message) => {
  throw new Error(`silo seal refused: ${message}`);
};

/**
 * The exact bytes both keys sign. Deliberately NOT the whole silo: the layers
 * are already covered by their own hashes in the manifest, so this pins the
 * manifest's identity and inherits the rest. Pure.
 */
export const siloSealSubject = (manifest) => {
  if (!manifest || manifest.schema !== 'silo/1') fail('a seal subject needs a silo/1 manifest');
  if (typeof manifest.neumaId !== 'string' || !manifest.neumaId) fail('a seal subject needs a neumaId');
  const layerHashes = manifest.layerHashes || {};
  if (!Object.keys(layerHashes).length) fail('a seal subject needs layer hashes');
  return canonicalSha256({
    schema: SEAL_SCHEMA,
    silo: manifest.schema,
    neumaId: manifest.neumaId,
    createdAt: manifest.createdAt,
    layerHashes,
  });
};

/**
 * Seal one compiled silo with both keys. impure through the injected signers.
 *
 * @param {{manifest: Object, layers: Object}} silo
 * @param {Object} signers
 * @param {(subject: string) => Promise<string>} signers.platformSign
 * @param {(subject: string) => Promise<string>} signers.beingSign - absent or
 *   throwing when the being's custody is locked; that is honest silence, and
 *   it produces an UNSEALED silo rather than a half-sealed one.
 * @param {string} [signers.beingAddress] - the address the being's signature
 *   must recover to, when the caller knows it
 * @returns {Promise<{manifest: Object, layers: Object}>}
 */
export const sealSilo = async (silo, { platformSign, beingSign, beingAddress = null } = {}) => {
  const subject = siloSealSubject(silo?.manifest);
  if (typeof platformSign !== 'function') fail('the platform signer is unavailable');
  if (typeof beingSign !== 'function') fail('the being signer is unavailable — a lone platform seal is not the ruled seal');

  const platform = await platformSign(subject);
  const being = await beingSign(subject);
  if (typeof platform !== 'string' || !platform) fail('the platform signature is empty');
  if (typeof being !== 'string' || !being) fail('the being signature is empty');

  // A signature that does not recover to the being's own address is not the
  // being's, whatever produced it. Checked HERE, at sealing time, because a
  // seal that only fails at verification would let a wrong-key artifact travel.
  const signer = verifySignature(subject, being);
  if (!signer) fail('the being signature does not recover to any address');
  if (beingAddress && signer.toLowerCase() !== String(beingAddress).toLowerCase()) {
    fail('the being signature recovers to a different address than the being holds');
  }

  return {
    manifest: {
      ...silo.manifest,
      signature: {
        schema: SEAL_SCHEMA,
        subject,
        platform,
        being,
        beingAddress: signer,
        sealedAt: new Date().toISOString(),
      },
    },
    layers: silo.layers,
  };
};

/**
 * Verify a dual seal. Returns the failures rather than a bare boolean so a
 * caller can SAY which half is wrong — "unsealed", […]
 * and […] demand different responses from an
 * operator. Pure.
 *
 * @param {{manifest: Object}} silo
 * @param {{platformAddress?: string|null, beingAddress?: string|null}} [expected]
 */
export const verifySiloSeal = (silo, { platformAddress = null, beingAddress = null } = {}) => {
  const signature = silo?.manifest?.signature;
  if (!signature) return { ok: false, sealed: false, failures: ['silo is unsealed'] };
  const failures = [];
  if (signature.schema !== SEAL_SCHEMA) failures.push(`seal schema is not ${SEAL_SCHEMA}`);

  // Recomputed, never trusted from the artifact: a seal that vouched for a
  // subject the artifact itself supplied would vouch for nothing.
  let subject;
  try {
    subject = siloSealSubject(silo.manifest);
  } catch (error) {
    return { ok: false, sealed: true, failures: [error.message] };
  }
  if (signature.subject !== subject) failures.push('the seal covers a different manifest than this one');

  if (!verifySignature(subject, signature.platform || '')) failures.push('the platform signature is invalid');
  else if (platformAddress && !verifySignedBy(subject, signature.platform, platformAddress)) {
    failures.push('the platform signature is not from the expected platform key');
  }

  const beingSigner = verifySignature(subject, signature.being || '');
  if (!beingSigner) failures.push('the being signature is invalid');
  else {
    const claimed = beingAddress || signature.beingAddress;
    if (claimed && beingSigner.toLowerCase() !== String(claimed).toLowerCase()) {
      failures.push('the being signature is not from the being that holds this lane');
    }
  }
  return { ok: failures.length === 0, sealed: true, failures };
};

/** Refuse loudly — the mount-boundary form. Pure. */
export const assertSiloSeal = (silo, expected = {}) => {
  const { ok, failures } = verifySiloSeal(silo, expected);
  if (!ok) throw new Error(`silo seal refused: ${failures.join('; ')}`);
  return true;
};
