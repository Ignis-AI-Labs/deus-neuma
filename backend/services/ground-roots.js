/**
 * ground-roots — where each of the operator's grounds STANDS, and the one
 * containment question the PLACE law asks of them.
 *
 * The house ground (house-workspace.js) and the alliances root
 * (alliance-ground.js) each refuse to stand inside the other — the place law
 * held from BOTH sides, in either setting order (echo RQ, 2026-07-26). Holding
 * it from both sides meant each module needed the other's root loader, which
 * made the pair an import cycle held open by a dynamic import. The loaders and
 * `isWithin` live here now (CQ-036, #395), imported by both sides and
 * re-exported where they always were — importers see zero change.
 */

import fs from 'fs/promises';
import path from 'path';
import { walletDir } from './user-realm.js';
import { createLogger } from './logger.js';

const log = createLogger('GroundRoots');

/**
 * Does `inner` stand at or inside `outer`? The containment question both the
 * PLACE law and the tool gate ask, answered the one way — resolve, then compare
 * on a separator boundary so `/a/bc` never reads as inside `/a/b`. Pure.
 * @param {string} inner
 * @param {string} outer
 * @returns {boolean}
 */
export const isWithin = (inner, outer) => {
  if (typeof inner !== 'string' || typeof outer !== 'string' || !inner || !outer) return false;
  const a = path.resolve(inner);
  const b = path.resolve(outer);
  return a === b || a.startsWith(b + path.sep);
};

// A missing record is the normal unset state; anything else unreadable is
// SAID but still reads as unset, so a torn record closes the ground rather
// than opening it. The two loaders share that posture deliberately.
const loadRoot = async (wallet, filename, label) => {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(walletDir(wallet), filename), 'utf8'));
    return { root: typeof parsed.root === 'string' ? parsed.root : null };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn(`${label} record unreadable — treating as unset`, { error: err.message });
    }
    return { root: null };
  }
};

/** impure — the operator's chosen alliances root, or null when unset. */
export const loadAllianceRoot = async (wallet) => loadRoot(wallet, 'alliance-ground.json', 'alliance-ground');

/** impure — the operator's chosen house ground, or null when unset. */
export const loadHouseWorkspace = async (wallet) => loadRoot(wallet, 'house-workspace.json', 'house-workspace');
