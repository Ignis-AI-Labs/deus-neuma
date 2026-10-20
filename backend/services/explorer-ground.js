// THE EXPLORER'S REACH — the whole machine for its owner, a guest's own house
// for a guest (audit 3 E4; Design note, 2026-10-19: a recorded install owner owns the
// whole-machine file explorer, other wallets run their own house).
//
// The install owner and its co-owners browse every folder they opened, and
// only they open or close a folder for the machine — at its own desk. A guest
// reaches only its own house: its realm dir, its chosen house ground, and the
// lanes it owns. Every path a guest's request names, and the place its
// symlinks lead, has to stand inside one of them; the folders it is shown,
// and the live change frames it hears, are cut to them too.
//
// The walls (explorer-walls.js) stand first, for every wallet.

import path from 'path';
import { walletDir } from './user-realm.js';
import { loadHouseWorkspace, isWithin } from './ground-roots.js';
import { listLanesByOwner } from './lane-ownership.js';
import { getRoots, withOwnRoots } from './user-files.js';
import { readProjectStore } from './user-projects.js';
import { realOf, namedPaths } from './explorer-walls.js';
import { deskStanding, requireInstallOwner } from './install-owner.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';

const log = createLogger('ExplorerGround');

const GROUND_REFUSAL = "That folder is outside your house. This computer's other folders belong to its owner.";

/**
 * The places that are this wallet's own house: its realm dir, its chosen
 * house ground, the lanes it owns. Shared with the gallery, whose guest view
 * is cut to the same house. impure (fs reads).
 * @param {string} wallet
 * @returns {Promise<string[]>} absolute
 */
export const houseGroundsOf = async (wallet) => {
  const { root } = await loadHouseWorkspace(wallet);
  const { all } = await listLanesByOwner({ workspace: neumaWorkspace, wallet });
  const lanes = all.map((laneId) => {
    try { return neumaWorkspace.pathFor(laneId); } catch { return null; }
  });
  return [walletDir(wallet), root, ...lanes].filter(Boolean).map((ground) => path.resolve(ground));
};

// impure — the folders a guest works in: the machine's opened folders that lie
// in its house, and its own projects' folders there. A guest's project never
// opens a folder for the machine (user-projects-routes.js); it opens it here,
// for that house alone.
const guestRootsOf = async (wallet, inHouse) => {
  const { projects } = await readProjectStore(wallet);
  const own = projects.flatMap((project) => (project.folders || []).map((folder) => folder.path))
    .filter((p) => typeof p === 'string' && path.isAbsolute(p));
  return [...new Set([...getRoots(), ...own].map((p) => path.resolve(p)))].filter(inHouse);
};

/**
 * Express middleware, after requireAuth and the walls. The owner passes (a
 * root change also needs the owner's desk); a guest's request is cut to its
 * own house, and `req.explorerKeep` tells the live lane what it may hear.
 * impure (fs reads).
 */
export const explorerGround = async (req, res, next) => {
  try {
    const standing = await deskStanding(req);
    const rootChange = req.path === '/roots' && req.method !== 'GET';
    if (standing === 'owner' || standing === 'co-owner') {
      return rootChange ? requireInstallOwner(req, res, next) : next();
    }
    // No one owns this install and the caller is not at its desk: a folder is
    // opened or closed only there.
    if (standing === 'unowned' && rootChange) return requireInstallOwner(req, res, next);
    const grounds = await houseGroundsOf(req.walletAddress);
    const inHouse = (target) => [path.resolve(target), realOf(path.resolve(target))]
      .every((candidate) => grounds.some((ground) => isWithin(candidate, ground)));
    const roots = await guestRootsOf(req.walletAddress, inHouse);
    if (req.path === '/roots' && req.method === 'GET') return res.json({ roots });
    // Its reach: those folders, and each part of its house that an opened
    // folder holds (the owner opening the lanes' root opens a guest's lane to it).
    const reach = [...roots, ...grounds.filter((ground) => getRoots().some((root) => isWithin(ground, root)))];
    const named = namedPaths(req).filter((p) => path.isAbsolute(p));
    // The picker's browse opens the home folder when it names none.
    if (req.path === '/browse' && named.length === 0) return res.status(403).json({ error: GROUND_REFUSAL });
    if (named.some((target) => !inHouse(target))) {
      log.info('explorer reach refused to a guest', { wallet: String(req.walletAddress).toLowerCase(), path: req.path });
      return res.status(403).json({ error: GROUND_REFUSAL });
    }
    req.explorerKeep = inHouse;
    return withOwnRoots(reach, next);
  } catch (error) {
    log.error('explorer reach check failed', { error: error.message });
    return res.status(500).json({ error: 'Could not tell which folders are yours — nothing was opened' });
  }
};
