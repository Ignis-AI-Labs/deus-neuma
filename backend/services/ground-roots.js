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
import { getRealmRoot, walletDir } from './user-realm.js';
import { getSettingsDir } from './data-root.js';
import { realpathOfNearestExisting } from './sandbox-path-policy.js';
import { readInstallOwner, standingIn } from './install-owner.js';
import { APP_ROOT, currentLayout, isPackagedLayout } from './security/app-inventory.js';

// The app's own checkout, read per call. NEUMA_APP_ROOT points it elsewhere so
// a test of the guest rule targets a throwaway checkout: a rule broken on
// purpose (a mutation run) then writes there, never into the real one.
const appCheckout = () => process.env.NEUMA_APP_ROOT || APP_ROOT;
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

// A refusal is the operator's answer, not a fault: the routes show its words
// with a 400.
const refuse = (message) => Object.assign(new Error(message), { code: 'GROUND_REFUSED' });

const WALLET_DIR = /^0x[0-9a-f]{40}$/;

/**
 * Refuse a ground inside another wallet's realm folder, a ground holding the
 * realm root, and a ground inside the install's settings. A ground is raised
 * with a marker and folders and lent to council tooling, so one in another
 * wallet's realm folder writes into that house and reads its records
 * (security seat pen matrix, 2026-10-19); one holding the realm root reaches
 * every house at once. The house's own realm folder, and a folder of the
 * realm that is no wallet's, stay legal grounds, as they always were. Judged
 * on the path as typed and with its links resolved, so a link is no way
 * round. A ground that merely HOLDS the settings stays legal: an owner's
 * ground over the checkout does (the dev data root sits inside it), and the
 * platform write walls refuse every tool write into the settings.
 * impure (fs realpath).
 * @param {string} wallet
 * @param {string} resolved - absolute
 * @param {string} what - the ground's name in the refusal ('a house ground')
 */
export const assertClearOfRealmAndSettings = async (wallet, resolved, what) => {
  const self = String(wallet).toLowerCase();
  const forms = async (p) => [...new Set([path.resolve(p), await realpathOfNearestExisting(p)])];
  const [grounds, realms, settings] = await Promise.all([resolved, getRealmRoot(), getSettingsDir()].map(forms));
  const pairs = grounds.flatMap((ground) => realms.map((realm) => [ground, realm]));
  if (pairs.some(([ground, realm]) => isWithin(realm, ground))) {
    throw refuse(`That path holds the realm, where every house on this install keeps its records — ${what} can never contain it`);
  }
  const walletFolder = ([ground, realm]) => (isWithin(ground, realm) ? path.relative(realm, ground).split(path.sep)[0].toLowerCase() : null);
  if (pairs.map(walletFolder).some((top) => WALLET_DIR.test(top ?? '') && top !== self)) {
    throw refuse(`That path is inside another house's folder in the realm — ${what} never stands in another house's records`);
  }
  if (grounds.some((ground) => settings.some((dir) => isWithin(ground, dir)))) {
    throw refuse(`That path is inside this install's own settings — ${what} never stands in the machine's state`);
  }
  // A dev checkout is the install owner's working tree (its .env, its history):
  // a guest house's ground never holds it or stands inside it.
  if (!isPackagedLayout(currentLayout()) && standingIn(await readInstallOwner(), wallet) === 'guest') {
    const app = await forms(appCheckout());
    if (grounds.some((ground) => app.some((dir) => isWithin(ground, dir) || isWithin(dir, ground)))) {
      throw refuse(`That path holds this install's own app checkout, which is its owner's — ${what} for a guest house stands outside it`);
    }
  }
};
