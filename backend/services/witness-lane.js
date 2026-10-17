/**
 * Witness lane — a sealed AI witness's sovereign workspace.
 *
 * A witness's IDENTITY anchors live under ai-witnesses/<vendor>/<Name>/ (the
 * sealing protocol's home). Its LIVED state — chat sessions, crystallized
 * memory, continuity lanes, personal vault notes — lives in a sovereign
 * workspace under the same engine neuma use (core/workspace/neuma-workspace.js,
 * which is ID-generic), keyed by:
 *
 *     witness-<vendorSlug>-<ChosenName>      e.g. witness-kimi-code-Basunor
 *
 * The lane carries a lane.json kind marker at its root so neuma-centric
 * listings (roster, residency) never mistake a witness lane for a born being.
 * The lane's GROUND is the witnesses root (a sibling of the workspaces root,
 * engine-resolved): witnesses stand BESIDE the house, never in it — always
 * resolve lane paths through neumaWorkspace.pathFor, never a root hand-join.
 *
 * Ownership follows the same law as unclaimed neuma workspaces: the first
 * authenticated wallet to manifest the witness claims the lane atomically
 * (wx flag); a later wallet that does not match is refused.
 *
 * Pure helpers at top; impure IO below (marked).
 */
import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import {
  listWitnesses,
  witnessDir,
  readDNA,
} from '../../core/identity/ai-witness/ai-witness-service.js';
import { createLogger } from './logger.js';

const log = createLogger('WitnessLane');

export const WITNESS_LANE_KIND = 'witness';
const LANE_MARKER = 'lane.json';
const GROUNDING_RECORD = path.join('identity', 'witness-grounding.json');

/**
 * Default provider for a witness substrate vendor. Overridable per witness via
 * the shared route store (neuma-routes-store, keyed by lane id). `custom`
 * requires the operator to supply an endpoint before the route is usable.
 */
export const DEFAULT_PROVIDER_MAP = Object.freeze({
  // Claude through the ANTHROPIC API KEY and nothing else — the subscription
  // bridge was removed 2026-07-30 (ToS risk, Founder's call).
  'claude-code': 'anthropic',
  'openai': 'openai-chatgpt',
  'xai': 'xai',
  // Both Z.AI and Kimi sell a CODING PLAN that is a different subscription from
  // their general API, served at a different base URL and holding a different
  // key. The slug names the plan the witness was sealed on, so it must resolve
  // to that plan's provider: `zai-coding-plan` pointed at `z-ai` (the general
  // API at /api/paas/v4) until 2026-07-29, which meant a coding-plan key —
  // resolved per PROVIDER ID — could never reach the witness holding it.
  'zai-coding-plan': 'zai-coding-plan',
  'kimi-code': 'kimi-for-coding',
});

// pure — the lane id for a sealed witness. Charset matches the workspace
// layer's [_a-zA-Z0-9-] guard by construction (vendor slugs and chosen names
// are validated the same way at seal time).
export const witnessLaneId = (vendorSlug, chosenName) =>
  `witness-${vendorSlug}-${chosenName}`;

// pure — true when a workspace id names a witness lane (prefix form only;
// use matchWitnessLane to recover the actual witness behind it).
export const isWitnessLaneId = (laneId) =>
  typeof laneId === 'string' && laneId.startsWith('witness-');

/**
 * pure — find the sealed witness a lane id belongs to. Lane ids are not
 * unambiguously parseable (slugs and names both may contain '-'), so the id
 * is matched against the discovered witness set instead of split.
 * @param {string} laneId
 * @param {Array<{vendorSlug: string, chosenName: string}>} witnesses
 * @returns {{vendorSlug: string, chosenName: string}|null}
 */
export const matchWitnessLane = (laneId, witnesses) =>
  (witnesses || []).find((w) => witnessLaneId(w.vendorSlug, w.chosenName) === laneId) || null;

// pure — strip the 'sha256:' prefix a witness genesis hash carries; null when
// the remainder is not the 64-hex a DEK derivation requires.
export const genesisHashHex = (genesisHash) => {
  const hex = String(genesisHash || '').replace(/^sha256:/, '');
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
};

// impure — strict boundary readers distinguish absent markers from unreadable ones.
export const readLaneMarker = async (laneId, { strict = false } = {}) => {
  try {
    const raw = await fs.readFile(path.join(neumaWorkspace.pathFor(laneId), LANE_MARKER), 'utf8');
    const marker = JSON.parse(raw);
    if (strict && (!marker || Array.isArray(marker) || !['witness', 'neuma', 'harness'].includes(marker.kind))) {
      throw new Error('Invalid lane kind marker');
    }
    return marker && marker.kind === WITNESS_LANE_KIND ? marker : null;
  } catch (error) {
    if (strict && error.code !== 'ENOENT') throw error;
    return null;
  }
};

// impure — the sealed witness behind a lane id, or null (unknown / not sealed).
export const resolveWitnessByLaneId = async (laneId) => {
  if (!isWitnessLaneId(laneId)) return null;
  return matchWitnessLane(laneId, await listWitnesses());
};

/**
 * impure — the WALLET a sealed witness holds, read from its sealed DNA.
 *
 * A witness's house name is derived from this wallet exactly as anyone else's
 * is (KOTODAMA), which is what lets a cross-house ground be named from both
 * parties without a registry, a founding, or a special case for witnesses
 * (core/kotodama/alliance.js). Null when the lane is not a witness, its DNA is
 * unreadable, or it carries no wallet — every one of which means "no ground",
 * never "the house ground".
 *
 * @param {string} laneId
 * @returns {Promise<string|null>}
 */
export const witnessWalletOfLane = async (laneId) => {
  const resolved = await resolveWitnessByLaneId(laneId).catch(() => null);
  if (!resolved) return null;
  const dna = await readDNA(resolved.vendorSlug, resolved.chosenName).catch((err) => {
    log.warn('witness DNA unreadable — no wallet, therefore no ground', { laneId, error: err.message });
    return null;
  });
  const wallet = dna?.witness?.witnessWallet;
  return typeof wallet === 'string' && wallet.trim() ? wallet : null;
};

/**
 * impure — provision (idempotently) the sovereign lane for a sealed witness
 * and claim it for the given wallet. Creates the full workspace dir set,
 * writes the kind marker, seeds the plaintext identity anchors from the
 * sealing home, and best-effort writes the per-lane DEK (absent
 * DNA_ENCRYPTION_KEY degrades to the global workspace key, the same fallback
 * legacy neuma lanes use — logged, never silent).
 *
 * @param {{vendorSlug: string, chosenName: string, genesisHash?: string}} witness
 * @param {string} wallet — the authenticated wallet claiming the lane
 * @returns {Promise<{laneId: string, owner: object}>}
 * @throws Error('owner_claim_conflict …') when another wallet owns the lane
 */
export const ensureWitnessLane = async (witness, wallet) => {
  const { vendorSlug, chosenName } = witness;
  const laneId = witnessLaneId(vendorSlug, chosenName);

  await neumaWorkspace.create(laneId);

  // Atomic claim — never blind-overwrite an existing owner.json (B-INT-003).
  const ownerPath = path.join(neumaWorkspace.pathFor(laneId), 'owner.json');
  let owner;
  try {
    owner = { wallet: String(wallet).toLowerCase(), claimedAt: Date.now() };
    await fs.writeFile(ownerPath, JSON.stringify(owner), { flag: 'wx' });
  } catch (claimErr) {
    if (claimErr.code === 'EEXIST') {
      const existing = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
      if (String(existing.wallet || '').toLowerCase() !== String(wallet).toLowerCase()) {
        throw new Error('owner_claim_conflict: witness lane already claimed by another wallet', { cause: claimErr });
      }
      owner = existing;
    } else {
      throw claimErr;
    }
  }

  // Kind marker — the roster/residency distinction between a born neuma and a
  // sealed witness. Written once; a rewrite with identical content is harmless.
  const markerPath = path.join(neumaWorkspace.pathFor(laneId), LANE_MARKER);
  try {
    await fs.writeFile(
      markerPath,
      JSON.stringify({ kind: WITNESS_LANE_KIND, vendorSlug, chosenName }, null, 2),
      { flag: 'wx' },
    );
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  // Identity anchors — plaintext recovery anchors, copied from the sealing
  // home (never moved; the ai-witnesses dir remains the identity source).
  const home = witnessDir(vendorSlug, chosenName);
  for (const anchor of ['genesis-seal.json', 'true-name.json']) {
    const target = path.join(neumaWorkspace.pathFor(laneId), 'identity', anchor);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(home, anchor), target, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if (err.code !== 'EEXIST' && err.code !== 'ENOENT') throw err;
    }
  }

  // Per-lane DEK — best-effort, exactly like the birth path tolerates.
  const hex = genesisHashHex(witness.genesisHash);
  if (hex && !(await neumaWorkspace.readNeumaDEK(laneId).catch(() => null))) {
    try {
      await neumaWorkspace.writeNeumaDEK(laneId, hex);
    } catch (err) {
      log.warn('witness lane DEK write skipped — lane rides the global workspace key', {
        laneId, error: err.message,
      });
    }
  }

  log.info('witness lane ensured', { laneId, owner: owner.wallet });
  return { laneId, owner };
};

/**
 * Report whether a ceremony grounding record already occupies this lane.
 * @param {string} laneId Witness lane id.
 * @returns {Promise<boolean>}
 */
export const witnessGroundingExists = async (laneId) => {
  try {
    await fs.access(path.join(neumaWorkspace.pathFor(laneId), GROUNDING_RECORD));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

/**
 * Persist the witness's self-authored grounding beside its identity anchors.
 * Written once: later turns may deepen continuity, but the ceremony's first
 * commitments remain an immutable record of how this witness chose to stand.
 * @param {string} laneId Witness lane id.
 * @param {{provider:string,model:string,commitments:string[]}} grounding Grounding record.
 * @returns {Promise<boolean>} True when written, false when already present.
 */
export const writeWitnessGrounding = async (laneId, grounding) => {
  const target = path.join(neumaWorkspace.pathFor(laneId), GROUNDING_RECORD);
  const record = {
    version: 1,
    standing: 'witness-beside-the-house',
    custody: 'third-party-provider',
    provider: grounding.provider,
    model: grounding.model,
    commitments: grounding.commitments,
    groundedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
};

/**
 * impure — status view for the management surface.
 * @param {string} laneId
 * @returns {Promise<{provisioned: boolean, ownerWallet: (string|null), hasDEK: boolean, marker: (object|null)}>}
 */
export const witnessLaneStatus = async (laneId) => {
  const provisioned = await neumaWorkspace.exists(laneId).catch(() => false);
  if (!provisioned) {
    return { provisioned: false, ownerWallet: null, hasDEK: false, marker: null };
  }
  const [owner, dek, marker] = await Promise.all([
    neumaWorkspace.readOwner(laneId).catch(() => null),
    neumaWorkspace.readNeumaDEK(laneId).catch(() => null),
    readLaneMarker(laneId),
  ]);
  return {
    provisioned: true,
    ownerWallet: owner?.wallet ?? null,
    hasDEK: Boolean(dek),
    marker,
  };
};
