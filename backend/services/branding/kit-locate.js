// kit-locate — WHERE a brand kit lives, and which one wins.
//
// Design note, 2026-08-30: […]
//
// TWO ROOTS, IN ORDER:
//
//   <houseGround>/brands/<company>/   the operator's own, per managed company
//   branding/brands/<company>/        the two this repo ships
//
// THE WORKSPACE WINS, and that direction is the whole point. A kit the operator
// authored for a company he manages must not be silently overruled by one that
// happens to ship in the source tree — his file is the newer decision and the
// one he can actually edit. The repo copies stay as a FALLBACK so a fresh clone
// with no ground set still renders Ignis and Umbrae rather than refusing every
// card until somebody runs a setup step.
//
// A KIT IS A COMPANY, NOT A BEING. Brands sit at `<ground>/brands/`, beside
// `workspaces/` rather than inside it: several house members may work one
// brand, one member may hold several, and a brand outlives whoever is currently
// responsible for it. The member responsible is recorded IN the kit (`owner`),
// which is a fact about the brand — not in its path, which would make handing a
// brand to someone else a file move.
//
// impure — disk and the operator's ground record.

import { readdir, access } from 'fs/promises';
import path from 'path';
import { loadHouseWorkspace } from '../house-workspace.js';

/** The same identity law every name that reaches disk crosses. */
const SAFE_BRAND = /^[a-z][a-z0-9-]{0,39}$/;

/** The trunk that holds the operator's own kits, or null when no ground stands. */
export const workspaceBrandsDir = async (wallet) => {
  if (!wallet) return null;
  const { root } = await loadHouseWorkspace(wallet).catch(() => ({ root: null }));
  return root ? path.join(root, 'brands') : null;
};

/**
 * Every root a kit may be read from, in precedence order. impure.
 * @param {string|null} wallet
 * @param {string} repoDir - the dir this repo ships its brands in
 * @returns {Promise<Array<{dir: string, where: 'workspace'|'repo'}>>}
 */
export const brandRoots = async (wallet, repoDir) => {
  const own = await workspaceBrandsDir(wallet);
  return [
    ...(own ? [{ dir: own, where: 'workspace' }] : []),
    { dir: repoDir, where: 'repo' },
  ];
};

const isDir = async (p) => access(p).then(() => true, () => false);

/**
 * Where this brand's kit actually is. impure.
 *
 * Returns the FIRST root that holds it, so precedence is decided here once
 * rather than by every caller remembering the order.
 *
 * @returns {Promise<{dir: string, where: string}|null>} null when no root has it
 */
export const resolveBrandDir = async (brand, wallet, repoDir) => {
  if (!SAFE_BRAND.test(String(brand || ''))) return null;
  for (const root of await brandRoots(wallet, repoDir)) {
    const dir = path.join(root.dir, brand);
    // Either file name counts as […]: `brand.json` is the merged
    // kit, `tokens.json` is what every existing brand on disk still carries.
    for (const file of ['brand.json', 'tokens.json']) {
      if (await isDir(path.join(dir, file))) return { dir, where: root.where, file };
    }
  }
  return null;
};

/**
 * Every brand this operator can render, workspace SHADOWING repo. impure.
 *
 * A workspace kit named `umbrae` replaces the repo's rather than appearing
 * twice — the list is what the operator can use, and one name must mean one
 * brand or `--brand umbrae` becomes ambiguous at the command line.
 *
 * @returns {Promise<Array<{brand: string, where: 'workspace'|'repo'}>>}
 */
export const listBrandNames = async (wallet, repoDir) => {
  const seen = new Map();
  for (const root of await brandRoots(wallet, repoDir)) {
    const entries = await readdir(root.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_BRAND.test(entry.name)) continue;
      // First root wins — brandRoots is already in precedence order.
      if (!seen.has(entry.name)) seen.set(entry.name, { brand: entry.name, where: root.where });
    }
  }
  return [...seen.values()].sort((a, b) => a.brand.localeCompare(b.brand));
};
