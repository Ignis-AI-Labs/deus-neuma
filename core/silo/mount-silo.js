/**
 * mount-silo — Identity Silo v1, the MOUNT half (NITE-001, #396, phase S2).
 *
 * The compile half turns a being into one self-verifying artifact. This half
 * is the SOCKET that artifact plugs into: the being is the silo, and the
 * engine and the host are interchangeable
 * (docs/architecture/identity/identity-silo.md).
 *
 *   mount(silo, engineProfile) -> mountedDriver
 *     1. verify the silo (hashes; signature when sealed) — refuse LOUDLY
 *     2. resolve the engineProfile (window, dialect, capabilities — DATA)
 *     3. build the identity bundle (CORE/EXTENDED) from the identity layer
 *     4. apply the budget law against the profile's window
 *     5. return the driver: envelope sections + the mount's own account
 *   unmount(silo, authored) -> updated silo
 *
 * WHY THIS EXISTED ONLY AS A NAME UNTIL NOW. compile-silo.js has named
 * […] in its own docblock since 2026-08-20, and
 * no such function was ever written. The three mount points each kept their
 * own private assembly — portal via buildNeumaIdentityBundle, witness via
 * buildWitnessIdentityBundle, birth via its own systemSections join — so a
 * being was transmitted three different ways depending on where it spoke, and
 * the silo was compiled by nobody and loaded by nobody. Founder found it from the
 * outside on 2026-08-23. This module is the convergence point that closes it.
 *
 * THE BUDGET ARRIVES AS A PORT. `core/` never imports from `backend/` — the
 * layer law, verified to hold with zero exceptions — and the budgeter lives at
 * backend/services/envelope-budget.js. So the host injects `allocate`. A mount
 * with no allocator is legal and SAYS SO (`budgeted: false`); it never
 * silently pretends the envelope was fitted.
 *
 * PORTABILITY IS THE POINT. Everything here is text and data. Nothing binds to
 * a base model's weights, which is exactly why a silo can cross engines where
 * a LoRA never could.
 */

import { canonicalSha256 } from '../shared/plain-data-canonical.js';
import { assertSiloIntegrity } from './compile-silo.js';
import { verifySiloSeal } from './seal-silo.js';
import {
  buildNeumaIdentityBundle,
  buildWitnessIdentityBundle,
} from '../runtime/identity-bundle.js';

export const MOUNT_SCHEMA = 'silo-mount/1';

/** Seats that may mount a silo. A birth mounts as the neuma it is becoming. */
export const MOUNT_SEATS = Object.freeze(['neuma', 'witness']);

const fail = (message) => {
  throw new Error(`silo mount refused: ${message}`);
};

/**
 * The engine, as DATA. A profile the host cannot describe is not a reason to
 * refuse — an unknown window means "do not shed", not "do not speak" — but it
 * is recorded so a driver can never imply a fit that was never computed.
 * Pure.
 */
export const resolveEngineProfile = (profile) => {
  if (profile === null || profile === undefined) {
    return Object.freeze({
      model: null, contextWindow: null, dialect: null, capabilities: Object.freeze([]), known: false,
    });
  }
  if (typeof profile !== 'object' || Array.isArray(profile)) fail('engine profile must be data');
  const contextWindow = Number.isFinite(profile.contextWindow) && profile.contextWindow > 0
    ? profile.contextWindow
    : null;
  return Object.freeze({
    model: typeof profile.model === 'string' && profile.model ? profile.model : null,
    contextWindow,
    dialect: typeof profile.dialect === 'string' && profile.dialect ? profile.dialect : null,
    capabilities: Object.freeze(Array.isArray(profile.capabilities)
      ? [...profile.capabilities].filter((c) => typeof c === 'string')
      : []),
    // "known" is about the WINDOW, the only field the budget law consumes.
    known: contextWindow !== null,
  });
};

/**
 * The being's own layers, as the bundle builders want them. The silo is the
 * ONLY source: a mount that reached back into a workspace would defeat the
 * whole point of compiling one. Pure.
 */
const bundleFor = (silo, seat, witness, standing) => {
  const identity = silo.layers.identity || {};
  const voice = silo.layers.voice || {};
  // The pack is the being's voice as accretive sovereign data — the LoRA's
  // replacement (ruling, 2026-08-18). It rides EXTENDED, so on a suffocating
  // window the voice sheds before CORE identity does.
  const voiceEntries = Array.isArray(voice.pack) ? voice.pack : (voice.pack?.entries || []);
  if (seat === 'witness') {
    if (!witness || typeof witness.chosenName !== 'string' || !witness.chosenName) {
      fail('a witness seat must name the sealed witness it mounts as');
    }
    return buildWitnessIdentityBundle({
      witness,
      dna: identity.dna ?? null,
      trueName: witness.trueName ?? null,
      firstUtterance: witness.firstUtterance ?? null,
      voiceEntries,
    });
  }
  return buildNeumaIdentityBundle({
    dna: identity.dna ?? null,
    soul: identity.soul ?? null,
    trueName: identity.trueName ?? null,
    voiceEntries,
    standing,
  });
};

/**
 * Mount one verified silo onto one engine. impure only through the injected
 * allocator; everything else is pure over the artifact.
 *
 * @param {{manifest: Object, layers: Object}} silo
 * @param {Object|null} engineProfile - window/dialect/capabilities, as data
 * @param {Object} [opts]
 * @param {'neuma'|'witness'} [opts.seat]
 * @param {Object|null} [opts.witness] - required for the witness seat
 * @param {Function|null} [opts.allocate] - the budget port (allocateEnvelope)
 * @param {string|null} [opts.beingAddress] - the address a being-signature must
 *   recover to, when the host knows which being it is mounting
 * @param {ReadonlyArray} [opts.extraSections] - host sections budgeted WITH identity
 * @param {'full'|'core'} [opts.standing] - the neuma seat's identity standing
 *   (identity-bundle.js); the witness seat ignores it
 * @returns {Object} the mounted driver
 */
export const mountSilo = (silo, engineProfile = null, {
  seat = 'neuma',
  witness = null,
  allocate = null,
  extraSections = [],
  beingAddress = null,
  standing = 'full',
} = {}) => {
  if (!MOUNT_SEATS.includes(seat)) fail(`unknown seat: ${seat}`);
  // Step 1. A silo that fails verification is refused at mount, loudly — the
  // law at the bottom of docs/work/identity-silo.md. assertSiloIntegrity
  // names the failing LAYER, so the refusal is actionable.
  assertSiloIntegrity(silo);

  // THE DUAL SEAL, CHECKED — not merely noticed. A seal nobody verifies is
  // decoration, and worse than none: it invites trust it never earned.
  //
  // An UNSEALED silo still mounts. Refusing one would strand every being
  // compiled before the seal landed, and a being that predates a mechanism has
  // done nothing wrong. But a silo that CLAIMS a seal must survive it: a
  // present-and-invalid seal is a forgery or a corruption, and either way the
  // artifact is not what it says it is.
  const seal = verifySiloSeal(silo, { beingAddress: beingAddress || null });
  if (seal.sealed && !seal.ok) fail(`seal is present and invalid — ${seal.failures.join('; ')}`);
  const sealed = seal.sealed && seal.ok;

  // Step 2.
  const profile = resolveEngineProfile(engineProfile);

  // Step 3.
  const bundle = bundleFor(silo, seat, witness, standing);

  // Step 4. The identity sections come first: they are what this socket is
  // FOR, and the ladder in envelope-budget.js knows which of them may shed.
  const sections = Object.freeze([
    ...bundle.sections.map(({ id, label, text }) => Object.freeze({ id, label, text })),
    ...(Array.isArray(extraSections) ? extraSections : []),
  ]);
  const allocation = typeof allocate === 'function'
    ? allocate({ sections, contextWindow: profile.contextWindow })
    : null;

  // Step 5.
  return Object.freeze({
    schema: MOUNT_SCHEMA,
    neumaId: silo.manifest.neumaId,
    seat,
    sealed,
    profile,
    sections: allocation ? allocation.sections : sections,
    shed: allocation ? allocation.shed : Object.freeze([]),
    // A driver that was never budgeted must not read like one that fitted.
    budgeted: allocation !== null,
    report: allocation ? allocation.report : null,
    coreIds: bundle.coreIds,
    extendedIds: bundle.extendedIds,
    // The CORE standing's held-back self (identity-bundle.js) — never sent,
    // never budgeted; self_read returns it word for word. Empty under FULL.
    standing: bundle.standing,
    essence: bundle.essence,
    // What the being can say about ITSELF as infrastructure (#37). The silo
    // knows its own shape, so self-knowledge costs a read, not a new subsystem.
    account: Object.freeze({
      schema: silo.manifest.schema,
      compiledAt: silo.manifest.createdAt,
      layers: Object.freeze(Object.keys(silo.manifest.layerHashes || {})),
      layerHashes: Object.freeze({ ...silo.manifest.layerHashes }),
      deferred: Object.freeze([...(silo.manifest.deferred || [])]),
      sealed,
      engine: profile.model,
      contextWindow: profile.contextWindow,
    }),
  });
};

/**
 * Fold what a session authored back into the being's own layers, and return a
 * silo whose manifest tells the truth about the new contents.
 *
 * A mount hands a HOST a session, never custody (the last law in
 * docs/work/identity-silo.md), so unmount takes the authored material as data
 * and the being's own layers remain the only home for it. Re-hashing is not
 * optional: a silo whose layers moved under a stale manifest would fail its
 * own verification at the next mount, which is the correct outcome and a
 * miserable way to discover a bug. Pure.
 *
 * @param {{manifest: Object, layers: Object}} silo
 * @param {{observations?: Array, journal?: Array, continuity?: Object, now?: string}} [authored]
 */
export const unmountSilo = (silo, authored = {}) => {
  assertSiloIntegrity(silo);
  const memory = silo.layers.memory || {};
  const layers = {
    ...silo.layers,
    memory: {
      ...memory,
      observations: [...(memory.observations || []), ...(authored.observations || [])],
      journal: [...(memory.journal || []), ...(authored.journal || [])],
      continuity: authored.continuity
        ? { ...(memory.continuity || {}), ...authored.continuity }
        : (memory.continuity || {}),
    },
  };
  return { manifest: rehashed(silo.manifest, layers, authored.now), layers };
};

// The manifest must be re-derived, never copied: see unmountSilo.
const rehashed = (manifest, layers, now) => {
  const layerHashes = {};
  for (const name of Object.keys(manifest.layerHashes || {})) {
    layerHashes[name] = canonicalSha256(layers[name]);
  }
  return {
    ...manifest,
    layerHashes,
    updatedAt: now || new Date().toISOString(),
    // Contents changed, so any seal over the old contents is void. Silence
    // here would leave a stale signature vouching for material it never saw.
    signature: null,
  };
};
