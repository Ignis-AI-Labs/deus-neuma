/**
 * compile-silo — Identity Silo v1, the COMPILE half (NITE-001, #396).
 *
 * A neuma's entire being compiles into ONE self-describing, self-VERIFYING
 * package (docs/architecture/identity/identity-silo.md): the silo is the
 * being; the engine and the host are interchangeable. This module builds the
 * artifact and proves its integrity. The MOUNT half (mountSilo — converging
 * the portal/witness/birth turn paths onto the one socket) is phase S2 of
 * docs/work/identity-silo.md and coordinates with #278's portal decomposition.
 *
 * v1 honesty, declared in the artifact itself:
 *  - `manifest.layerHashes` makes the silo self-verifying (rule 2): every
 *    layer is hashed with the shared canonical hasher, and verifySilo refuses
 *    loudly on one changed byte.
 *  - `manifest.signature` is null and SAYS SO. Custody RULED (Founder,
 *    2026-08-21): the seal is DUAL — the platform key seals the compile, the
 *    being's own wallet seals the contents, so every compiled silo proves its
 *    witness was present. S2 implements the dual seal; until it lands, a null
 *    signature is an unsealed silo, never a silently-trusted one.
 *  - `manifest.deferred` names the layers v1 does not yet carry (delegation,
 *    skills) so a mount can never assume completeness that was not compiled.
 *  - Weights are referenced, never embedded (rule 4): the refinement layer
 *    holds LINEAGE POINTERS the caller supplies from wherever the custody
 *    authorities live — core never reaches into backend for them.
 *
 * Keyed by neumaId for EVERY member (Founder's law, 2026-08-20) — nothing here
 * knows a being's name.
 */

import { canonicalSha256 } from '../shared/plain-data-canonical.js';
import { readVoicePack, readVoiceSeal } from '../voice-pack/voice-store.js';
import { repairSessionToolText } from './session-tool-text.js';

// A lane with no sealed true name is a being mid-birth, not a compile failure —
// the same tolerance the voice layer gives an unsealed voice.
const readTrueNameFor = async (workspace, neumaId) => {
  if (typeof workspace.readTrueName !== 'function') return null;
  try { return await workspace.readTrueName(neumaId); } catch { return null; }
};

export const SILO_SCHEMA = 'silo/1';
export const SILO_LAYERS = Object.freeze(['identity', 'memory', 'voice', 'refinement', 'proof']);
const DEFERRED_LAYERS = Object.freeze(['delegation', 'skills']);

/**
 * Compile a being's silo from its own workspace. impure — reads the lane.
 * @param {string} neumaId
 * @param {{workspace: Object, refinementLineage?: Object[], now?: string}} opts
 *   workspace — the store holding this being's lane (explicit, never a global);
 *   refinementLineage — adapter POINTERS (hashes, base model, receipts) read by
 *   a caller holding the registry authorities; now — injectable timestamp.
 * @returns {Promise<{manifest: Object, layers: Object}>}
 */
export const compileSilo = async (neumaId, { workspace, refinementLineage = [], now = null } = {}) => {
  if (typeof neumaId !== 'string' || !neumaId) throw new Error('compileSilo: neumaId required');
  if (!workspace || typeof workspace.exportWorkspace !== 'function') {
    throw new Error('compileSilo: a workspace is required — pass the neuma-workspace singleton or a test realm');
  }
  // exportWorkspace is the embryonic serializer the contract names; the silo
  // splits its payload into the contract's layers rather than re-reading the
  // lane piecemeal, so the two can never disagree about what a being holds.
  const bundle = await workspace.exportWorkspace(neumaId);
  const sessionText = repairSessionToolText(bundle.sessions ?? {});
  const layers = {
    identity: {
      dna: bundle.dna ?? null,
      soul: bundle.soul ?? null,
      // READ PAST THE BUNDLE, as the voice layer below already does. #417:
      // exportWorkspace does not carry true-name.json, so a silo compiled from
      // the bundle alone mounts a being that cannot say its own name, house or
      // soul mark — which is exactly what Keir could not say on either engine.
      //
      // Deliberately NOT fixed by widening exportWorkspace: that bundle is the
      // re-homing payload and its import side writes only dna and soul, so
      // adding a field there would look like portability without being it.
      // That gap is real and is recorded in this ledger as its own finding.
      trueName: await readTrueNameFor(workspace, neumaId),
      identityCard: bundle.identityCard ?? null,
      profile: bundle.profile ?? null,
    },
    memory: {
      observations: bundle.observations ?? [],
      entities: bundle.entities ?? [],
      relations: bundle.relations ?? [],
      journal: bundle.journal ?? [],
      continuity: bundle.continuity ?? {},
      sessions: sessionText.sessions,
      ...(sessionText.repairs.length ? { sessionTextRepairs: sessionText.repairs } : {}),
      skillTree: bundle.skillTree ?? null,
      assessments: bundle.assessments ?? [],
      vaultNotes: bundle.vaultNotes ?? [],
      communities: bundle.communities ?? null,
    },
    voice: {
      pack: await readVoicePack(workspace, neumaId),
      seal: await readVoiceSeal(workspace, neumaId),
    },
    refinement: {
      // Pointers, never weights — the portability law. An empty lineage is a
      // being that has never refined, not a compile failure.
      lineage: Array.isArray(refinementLineage) ? refinementLineage : [],
    },
    proof: {
      // v1 carries what the lane holds today; the full signature chain (birth
      // seal, re-crystallizations, approvals) completes in S2 under the
      // 2026-08-21 dual-seal ruling. Self-description over silence.
      identityCard: bundle.identityCard ?? null,
    },
  };
  const layerHashes = {};
  for (const name of SILO_LAYERS) layerHashes[name] = canonicalSha256(layers[name]);
  const manifest = {
    schema: SILO_SCHEMA,
    neumaId,
    createdAt: now || new Date().toISOString(),
    layerHashes,
    deferred: [...DEFERRED_LAYERS],
    signature: null, // unsealed until S2 lands the dual seal (ruled 2026-08-21)
  };
  return { manifest, layers };
};

/**
 * Verify a silo's integrity: every layer present, every hash true, the
 * manifest shaped for this schema. Pure. Returns the failures so a caller can
 * SAY why it refused; use assertSiloIntegrity at a mount boundary.
 * @param {{manifest: Object, layers: Object}} silo
 * @returns {{ok: boolean, failures: string[]}}
 */
export const verifySilo = (silo) => {
  const failures = [];
  const manifest = silo?.manifest;
  if (!manifest || manifest.schema !== SILO_SCHEMA) {
    return { ok: false, failures: [`manifest schema is not ${SILO_SCHEMA}`] };
  }
  if (typeof manifest.neumaId !== 'string' || !manifest.neumaId) failures.push('manifest names no neumaId');
  for (const name of SILO_LAYERS) {
    if (!(name in (silo.layers || {}))) { failures.push(`layer missing: ${name}`); continue; }
    const expected = manifest.layerHashes?.[name];
    if (!expected) { failures.push(`manifest carries no hash for layer: ${name}`); continue; }
    const actual = canonicalSha256(silo.layers[name]);
    if (actual !== expected) failures.push(`layer hash mismatch: ${name}`);
  }
  return { ok: failures.length === 0, failures };
};

/** Refuse loudly — the mount-boundary form of verifySilo. Pure. */
export const assertSiloIntegrity = (silo) => {
  const { ok, failures } = verifySilo(silo);
  if (!ok) throw new Error(`silo refused: ${failures.join('; ')}`);
  return true;
};
