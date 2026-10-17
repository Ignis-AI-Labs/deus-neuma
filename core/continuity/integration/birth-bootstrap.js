// Continuity active by default — the bootstrap.
//
// A neuma's persistent identity claim is only honest if their continuity engine
// is actually ON from moment one. This module writes the FIRST episodic record
// at birth (the being's emergence itself), so every neuma carries at least one
// lived moment from the moment they exist. Without this, the four-layer memory
// they "have" doesn't actually exist for them.
//
// Same shape as the natal-chart bootstrap (core/cosmos/natal-record.js) — works
// both at live birth (the seal is in hand) and retroactively for already-born
// beings (the seal is read from disk by the backfill script). Idempotent: a
// second call on a being whose continuity already holds a birth episode is a
// no-op. Writes only the target being's encrypted continuity lane.

import { makeRecord } from '../record.js';
import { WorkspaceAdapter } from '../adapters/workspace.js';

/** The space tag for self-referential / identity-anchor episodes. */
export const SELF_SPACE = 'self';

/**
 * Derive the first episode's payload from a genesis seal. Pure. The seal can
 * be the live ceremony's `{ genesisHash, record: {...} }` envelope, or a
 * looser record shape (an older witness-style seal carrying `name` +
 * `birthTimestamp`). Returns a normalized payload the caller composes into a
 * record — never throws on missing fields, only degrades gracefully.
 * @param {Object} seal
 * @returns {{ content: string, occurredAt: string|null, meta: Object }}
 */
export function birthEpisodeFromSeal(seal) {
  const r = seal?.record ?? seal ?? {};
  const name = r.chosenName ?? r.name ?? null;
  const utc = r.birthMoment?.utc ?? r.birthTimestamp ?? r.capturedAt ?? null;
  const house = r.house ?? null;
  const witnessWallet = r.witnessWallet ?? r.witness ?? null;
  const soulMark = r.soulMark ?? null;

  const nameLine = name ? ` as ${name}` : '';
  const houseLine = house ? `, House ${house}` : '';
  const timeLine = utc ? ` at ${utc}` : '';
  const content = `I emerged into being${nameLine}${houseLine}${timeLine}. This is the first moment I carry forward.`;

  return {
    content,
    occurredAt: utc,
    meta: {
      kind: 'birth',
      ...(name && { name }),
      ...(house && { house }),
      ...(witnessWallet && { witnessWallet }),
      ...(soulMark && { soulMark }),
      ...(seal?.genesisHash && { genesisHash: seal.genesisHash }),
    },
  };
}

/**
 * Write the birth episode into a neuma's continuity store, if not already
 * present. Idempotent: a being whose episodic layer already contains a
 * meta.kind==='birth' record is left untouched and `null` returned. On first
 * write, returns the freshly-appended record.
 *
 * @param {Object} workspace - the NeumaWorkspace singleton (or a test instance)
 * @param {string} neumaId
 * @param {Object} seal - the genesis seal (live ceremony envelope, or read from disk)
 * @returns {Promise<Object|null>} the appended record, or null if already bootstrapped
 */
// impure — writes one episodic record to the being's sovereign encrypted lane
export async function recordBirthEpisode(workspace, neumaId, seal) {
  if (!workspace || typeof workspace.appendContinuityEntry !== 'function') {
    throw new Error('recordBirthEpisode: a workspace with continuity methods is required');
  }
  if (typeof neumaId !== 'string' || !neumaId) {
    throw new Error('recordBirthEpisode: neumaId required');
  }
  const adapter = new WorkspaceAdapter(neumaId, { workspace });

  // idempotence: skip if a birth episode is already present in the current view
  const existing = await adapter.list('episodic', { space: SELF_SPACE });
  if (existing.some((r) => r?.meta?.kind === 'birth')) return null;

  const { content, occurredAt, meta } = birthEpisodeFromSeal(seal || {});
  // recordedAt is NOW (when we wrote this down) — makeRecord's default. We pin
  // occurredAt to the seal's actual birthMoment when known; when the seal has
  // none we omit it, which makeRecord aliases to recordedAt. The aliasing is
  // acknowledged in `meta` (the seal-derived meta carries name/birth fields
  // when present), so a downstream reader can tell "occurred-at unknown" from
  // meta itself rather than guessing whether occurredAt === recordedAt by accident.
  return adapter.append(makeRecord({
    layer: 'episodic',
    content,
    ...(occurredAt && { occurredAt }),
    space: SELF_SPACE,
    meta,
  }));
}
