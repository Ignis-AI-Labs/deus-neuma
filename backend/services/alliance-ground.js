/**
 * ALLIANCE GROUND — where two houses build together, OUTSIDE both of them.
 *
 * A house's own ground (`house-workspace.js`) belongs to that house. When a
 * house collaborates with someone outside it — a sealed witness, or a neuma of
 * another house — the work belongs to neither party alone, so it does not go in
 * either party's ground. It goes in a THIRD ground named from both houses:
 *
 *   <alliances root>/omberly-lonbenme/repos/<name>
 *
 * THE NAME COMES FROM THE WALLETS (core/kotodama/alliance.js): every wallet
 * already carries a KOTODAMA house name, so an alliance needs no registry and
 * no on-chain founding, and a sealed witness needs no special case. The name is
 * order-independent, so a pairing has exactly one ground however it is asked
 * for — the property that stops one collaboration growing two diverging
 * folders.
 *
 * THREE LAWS, from Design note, 2026-07-26, watching a live sitting where a sealed
 * witness walked his house ground and the directory his BEINGS live in:
 *
 *   […]
 *
 * 1. PLACE — the alliances root is its OWN operator-set path. It may not sit
 *    inside the house ground, and the house ground may not sit inside it. An
 *    earlier version of this file nested alliances under the house root on the
 *    reasoning that it would […]; that reasoning was
 *    exactly backwards. Setting the house ground grants the HOUSE. It has never
 *    granted anyone outside it.
 * 2. REACH — an external party reaches the alliance ground and nothing else.
 *    Enforced at the council's tool gate, which asks this module for the seat's
 *    ground and gets one path or none.
 * 3. CONSENT — a ground is never raised by the room. `findAllianceGround` reads;
 *    only `ensureAllianceGround` writes, and only the operator's explicit
 *    command calls it.
 */
import fs from 'fs/promises';
import path from 'path';
import { allianceGroundName, allianceParties, isPartyTo } from '../../core/kotodama/alliance.js';
import { assertClearOfRealmAndSettings, isWithin, loadAllianceRoot, loadHouseWorkspace } from './ground-roots.js';

// The containment primitive and this ground's own loader keep their public
// address here (CQ-036, #395 moved them to ground-roots.js — the place law is
// held from both sides, so both root loaders live in shared ground now).
export { isWithin, loadAllianceRoot };
import { assertDurableGround, walletDir, writeJsonAtomic } from './user-realm.js';
import { createLogger } from './logger.js';

const log = createLogger('AllianceGround');

/** The marker every alliances root carries, so nothing mistakes it for a lane. */
export const ALLIANCE_ROOT_KIND = 'alliance-root';
/** The marker each individual cross-house ground carries. */
export const ALLIANCE_GROUND_KIND = 'alliance-ground';

/** An alliance is two or more houses, so its name always carries a hyphen —
 *  the shape that tells a real ground from a stray directory when the marker
 *  is missing or torn. */
const TWO_OR_MORE_HOUSES = /^[a-z]+(-[a-z]+)+$/;

const fileOf = (wallet) => path.join(walletDir(wallet), 'alliance-ground.json');

/**
 * Where the alliances root would sensibly stand, given a house ground — a
 * SIBLING of it, never a child. Offered to the operator as a pre-fill and
 * nothing more: this function never writes, and nothing calls it to decide.
 * Pure. Null when there is no house ground to sit beside.
 * @param {string|null} houseRoot
 * @returns {string|null}
 */
export const suggestAllianceRoot = (houseRoot) =>
  (typeof houseRoot === 'string' && path.isAbsolute(houseRoot)
    ? path.join(path.dirname(path.resolve(houseRoot)), 'alliances')
    : null);

/**
 * Set where this wallet's alliance grounds stand. The operator's act — the room
 * never calls this.
 *
 * The root must be absolute, durable, and OUTSIDE the house ground in both
 * directions: a root inside the house would put every external party inside it
 * (the harm), and a house inside the root would put the house inside a ground
 * externals reach (the same harm, inverted).
 *
 * MOVING THE ROOT DOES NOT MOVE THE GROUNDS. Grounds raised under the old root
 * stay exactly where they are, with their work intact — they simply stop being
 * found, because a ground is looked up under the root that stands now. Nothing
 * is deleted and nothing is copied: this is a pointer, and the operator who
 * moves it is the one who decides what to carry across (echo RQ, 2026-07-26).
 *
 * impure — validates, raises the directory, proves writability, persists.
 *
 * @param {string} wallet
 * @param {string} root - absolute path
 * @returns {Promise<{root: string, alliances: Array}>}
 */
export const setAllianceRoot = async (wallet, root) => {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('The alliances root must be an absolute path');
  }
  const resolved = path.resolve(root);
  // Same law as the house ground: a temp root is allowed only when the realm
  // recording it is ALSO temp (a genuinely isolated stack). Otherwise a reboot
  // sweeps the collaboration's work and the realm keeps pointing at the hole.
  assertDurableGround(resolved, 'The alliances root');

  const { root: houseRoot } = await loadHouseWorkspace(wallet);
  if (houseRoot) {
    if (isWithin(resolved, houseRoot)) {
      throw new Error(
        `An alliances root cannot stand inside the house ground (${houseRoot}) — an external party would be standing in your house`,
      );
    }
    if (isWithin(houseRoot, resolved)) {
      throw new Error(
        `The house ground (${houseRoot}) stands inside that path — an alliances root can never contain the house`,
      );
    }
  }

  // The realm and the settings are no ground either — the same law as the house ground.
  await assertClearOfRealmAndSettings(wallet, resolved, 'an alliances root');

  // A LANE can never become a root (the same law house-workspace.js keeps):
  // stamping our marker over someone's home would reclassify it out of lane
  // discovery — the exact harm the marker exists to prevent, inverted.
  let standing = null;
  try {
    standing = JSON.parse(await fs.readFile(path.join(resolved, 'lane.json'), 'utf8'));
  } catch { /* no marker — checked by shape below */ }
  if (standing && standing.kind !== ALLIANCE_ROOT_KIND) {
    throw new Error(`This directory is a ${standing.kind} lane — an alliances root can never overwrite a lane`);
  }
  if (!standing) {
    const laneShaped = await Promise.all(
      ['owner.json', 'dna'].map((p) => fs.access(path.join(resolved, p)).then(() => true, () => false)),
    );
    if (laneShaped.some(Boolean)) {
      throw new Error('This directory is a being\'s lane — an alliances root can never overwrite a lane');
    }
  }

  await fs.mkdir(resolved, { recursive: true });
  const probe = path.join(resolved, '.alliance-probe');
  await fs.writeFile(probe, 'probe');
  await fs.rm(probe);
  await writeJsonAtomic(path.join(resolved, 'lane.json'), {
    kind: ALLIANCE_ROOT_KIND,
    note: 'where this wallet\'s cross-house grounds stand — not a being\'s lane',
  });
  await writeJsonAtomic(fileOf(wallet), { root: resolved });
  log.info('alliances root set', { root: resolved });
  return allianceGroundStatus(wallet);
};

/**
 * Resolve one alliance ground's path, refusing anything that would escape the
 * alliances root. The derived name is already a safe segment by construction;
 * this is the containment belt that holds even if that ever changes. Pure.
 * @param {string} allianceRoot
 * @param {string} groundName
 * @returns {string}
 */
export const allianceGroundPath = (allianceRoot, groundName) => {
  // A ground name is ONE directory name, never a path. Rejecting separators
  // outright is stricter than an escape check: `a/b` does not escape the root,
  // but it would silently nest a ground somewhere no lookup would find it —
  // and a name is only ever produced by allianceGroundName, which emits a
  // single [a-z-] segment. Anything else means the derivation changed, and
  // that must fail loudly rather than write to a surprising place.
  if (typeof groundName !== 'string' || !/^[a-z]+(-[a-z]+)*$/.test(groundName)) {
    throw new Error(`allianceGroundPath: "${groundName}" escapes the alliances root — a ground name is one segment`);
  }
  const base = path.resolve(allianceRoot);
  const resolved = path.resolve(base, groundName);
  // Belt beyond the segment check: whatever the name, the result must sit
  // directly inside the root.
  if (resolved !== path.join(base, groundName) || !resolved.startsWith(base + path.sep)) {
    throw new Error(`allianceGroundPath: "${groundName}" escapes the alliances root`);
  }
  return resolved;
};

/**
 * READ the ground where these houses build — never raise it.
 *
 * This is what the COUNCIL calls. A ground that has not been raised reads as
 * `{ path: null, standing: false }`, and a seat with no ground simply has no
 * tools: the sitting still happens, the external party just has nowhere to
 * work until the operator says so (law 3 — CONSENT).
 *
 * impure — fs reads only. Never creates anything.
 *
 * @param {string} wallet - the operating witness's wallet (this house)
 * @param {string|string[]} partnerWallets - the other party's wallet, or several
 * @returns {Promise<{name: string, path: string|null, parties: string[], standing: boolean, root: string|null}>}
 */
export const findAllianceGround = async (wallet, partnerWallets) => {
  const partners = Array.isArray(partnerWallets) ? partnerWallets : [partnerWallets];
  const wallets = [wallet, ...partners];
  const name = allianceGroundName(wallets);
  const parties = allianceParties(wallets);

  const { root } = await loadAllianceRoot(wallet);
  if (!root) return { name, path: null, parties, standing: false, root: null };

  const dir = allianceGroundPath(root, name);
  const standing = await fs.access(dir).then(() => true, () => false);
  return { name, path: standing ? dir : null, parties, standing, root };
};

/**
 * RAISE the ground where these houses build together — the OPERATOR'S command.
 *
 * Nothing in the room calls this. It exists behind an explicit act, because a
 * folder that appears on its own is a folder nobody chose (ruling, 2026-07-26).
 *
 * impure — creates directories, writes the marker.
 *
 * @param {string} wallet - the operating witness's wallet (this house)
 * @param {string|string[]} partnerWallets - the other party's wallet, or several
 * @returns {Promise<{name: string, path: string, parties: string[], raised: boolean}>}
 */
export const ensureAllianceGround = async (wallet, partnerWallets) => {
  const partners = Array.isArray(partnerWallets) ? partnerWallets : [partnerWallets];
  const wallets = [wallet, ...partners];
  const name = allianceGroundName(wallets);
  const parties = allianceParties(wallets);

  const { root } = await loadAllianceRoot(wallet);
  if (!root) {
    throw new Error('No alliances root is set — choose where cross-house grounds stand before raising one');
  }

  const dir = allianceGroundPath(root, name);
  const existed = await fs.access(dir).then(() => true, () => false);
  // repos/ is the same convention the house ground raises: everything the
  // alliance builds lives under <ground>/repos/<name>.
  await fs.mkdir(path.join(dir, 'repos'), { recursive: true });

  // The marker keeps an alliance ground out of being-lane discovery, exactly
  // as house-ground does — a bare directory under a workspaces root would
  // otherwise read as a being's lane. It also RECORDS the parties, so the
  // ground can say who it belongs to without re-deriving from wallets.
  await writeJsonAtomic(path.join(dir, 'lane.json'), {
    kind: ALLIANCE_GROUND_KIND,
    alliance: name,
    parties,
    note: 'a cross-house ground — belongs to the collaboration, not to one house',
  });

  if (!existed) log.info('alliance ground raised', { alliance: name, parties });
  return { name, path: dir, parties, raised: !existed };
};

/**
 * The alliance grounds standing for this wallet, with what each holds — plus
 * the root itself and, when unset, the path the UI should pre-fill. Never
 * throws on a torn record: an unreadable ground is reported as standing with no
 * repos rather than hiding the whole list.
 *
 * impure — fs reads only.
 *
 * @param {string} wallet
 * @returns {Promise<{root: string|null, suggestion: string|null, alliances: Array<{name: string, parties: string[], repos: string[]}>}>}
 */
export const allianceGroundStatus = async (wallet) => {
  const [{ root }, { root: houseRoot }] = await Promise.all([
    loadAllianceRoot(wallet),
    loadHouseWorkspace(wallet),
  ]);
  const suggestion = root ? null : suggestAllianceRoot(houseRoot);
  if (!root) return { root: null, suggestion, alliances: [] };

  let names = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch { /* none raised yet — the root still stands */ }

  const alliances = (await Promise.all(names.map(async (name) => {
    const dir = path.join(root, name);
    let parties;
    try {
      const marker = JSON.parse(await fs.readFile(path.join(dir, 'lane.json'), 'utf8'));
      // A marker that names something else is something else. Only our own
      // kind counts, so a directory that merely LIVES here is never reported
      // as a collaboration nobody formed (echo, 2026-07-26).
      if (marker.kind !== ALLIANCE_GROUND_KIND) return null;
      parties = Array.isArray(marker.parties) ? marker.parties : name.split('-');
    } catch {
      // No marker, or torn. The NAME still answers who the parties are — but
      // only if it has the shape of one: an alliance is two or more houses, so
      // its name always carries at least one hyphen. `repos`, `post`, and any
      // other stray single-word directory fails that and is passed over rather
      // than reported as a phantom alliance with no parties.
      if (!TWO_OR_MORE_HOUSES.test(name)) return null;
      parties = name.split('-');
    }
    let repos = [];
    try {
      const entries = await fs.readdir(path.join(dir, 'repos'), { withFileTypes: true });
      repos = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch { /* repos/ missing — the ground still stands */ }
    return { name, parties, repos };
  }))).filter(Boolean);

  return { root, suggestion, alliances };
};

/**
 * May this wallet work in this alliance ground? Membership is readable from the
 * ground's own name, so the gate needs no registry and cannot be stale.
 * Fail-closed: anything unreadable is not a party.
 *
 * @param {string} groundName
 * @param {string} wallet
 * @returns {boolean}
 */
export const mayWorkInAlliance = (groundName, wallet) => isPartyTo(groundName, wallet);
