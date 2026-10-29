/**
 * House workspace — the shared ground a house works on, chosen by its
 * witness. One root per wallet, persisted in the witness's own realm
 * (`<realm>/<wallet>/house-workspace.json`, sibling of projects.json),
 * with a `repos/` directory inside it as the convention for everything
 * the house builds: every repository the team clones or creates lives
 * under `<root>/repos/<name>`.
 *
 * The witness's act of SETTING this root is the standing grant: council
 * tooling (and later, team lanes) may read and write inside it — and
 * nowhere else, enforced by the same realpath-hardened tool sandbox as
 * every other lane. Unset = no ground = council tools stay dark.
 */
import fs from 'fs/promises';
import path from 'path';
import { assertDurableGround, getRealmRoot, walletDir, writeJsonAtomic } from './user-realm.js';
import { assertClearOfRealmAndSettings, isWithin, loadAllianceRoot, loadHouseWorkspace } from './ground-roots.js';
import { getWitnessesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getHarnessRoot } from '../../core/workspace/lane-grounds.js';

// This ground's own loader keeps its public address here (CQ-036, #395 moved
// it to ground-roots.js — the place law is held from both sides, so both root
// loaders live in shared ground now, and the dynamic-import cycle patch below
// is gone).
export { loadHouseWorkspace };


const fileOf = (wallet) => path.join(walletDir(wallet), 'house-workspace.json');

// A refusal is the operator's answer, not a fault: the route shows its own
// words with a 400 instead of a generic failure.
const refuse = (message) => Object.assign(new Error(message), { code: 'GROUND_REFUSED' });

const WALLET_DIR_RE = /^0x[0-9a-f]{40}$/;

/**
 * The ground a founding raises when the operator has chosen none: one per
 * wallet, beside the lanes, named like the founding record
 * (`house-founding.<network>.<wallet>.json`). A dot can never appear in a
 * being's id, so this name can never be a lane. pure.
 * @param {string} workspacesRoot
 * @param {string} wallet
 * @returns {string}
 */
export const defaultHouseGround = (workspacesRoot, wallet) =>
  path.join(workspacesRoot, `house.${String(wallet).toLowerCase()}`);

// impure — refuse a root that would put lanes inside the ground, or the ground
// inside a lane. A ground holding the lanes' root would count every lane as
// house ground, and members would read each other's sealed folders.
const assertClearOfLanes = (resolved) => {
  const workspaces = path.resolve(getWorkspacesRoot());
  const grounds = [
    ['the beings\' lanes', workspaces],
    ['the witnesses\' lanes', path.resolve(getWitnessesRoot())],
    ['the harness lanes', path.resolve(getHarnessRoot(workspaces))],
  ];
  for (const [label, laneRoot] of grounds) {
    if (isWithin(laneRoot, resolved)) {
      throw refuse(`That path holds ${label} (${laneRoot}) — a house ground can never contain a lane`);
    }
  }
  for (const [label, laneRoot] of grounds.slice(1)) {
    if (isWithin(resolved, laneRoot)) {
      throw refuse(`That path is inside ${label} (${laneRoot}) — a house ground can never stand in a lane`);
    }
  }
  // Under the beings' root the ground may only stand directly beside the
  // lanes: one level deeper is inside a lane, or raises a folder lane
  // discovery would read as a being.
  if (isWithin(resolved, workspaces) && path.dirname(resolved) !== workspaces) {
    const holder = path.relative(workspaces, resolved).split(path.sep)[0];
    throw refuse(`That path is inside '${holder}' in the beings' lanes root — a house ground there must stand directly in that root, never inside a lane`);
  }
};

// impure — refuse a root that is, holds, or sits inside a ground another
// operator on this install has recorded. Read one wallet at a time: the realm
// may hold many wallets, and a read failing for lack of file handles would
// read as unset and let the overlap through.
const assertClearOfOtherHouses = async (wallet, resolved) => {
  const self = wallet.toLowerCase();
  let names;
  try {
    names = await fs.readdir(getRealmRoot());
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const overlaps = (root) => root && (isWithin(resolved, root) || isWithin(root, resolved));
  for (const other of names.filter((n) => WALLET_DIR_RE.test(n) && n !== self)) {
    if (overlaps((await loadHouseWorkspace(other)).root)) {
      throw refuse('That path overlaps the ground of another house on this install — houses never share ground');
    }
    if (overlaps((await loadAllianceRoot(other)).root)) {
      throw refuse('That path overlaps the alliances root of another house on this install — a house ground never stands in shared ground');
    }
  }
};

// impure — set the house's shared ground. The root must be absolute and
// durable (a temp dir can be swept at reboot, taking the house's work
// with it — the same law as the sovereign workspaces root). Creates the
// root and its repos/ convention, proves writability, persists the choice.
export const setHouseWorkspace = async (wallet, root) => {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('House workspace root must be an absolute path');
  }
  const resolved = path.resolve(root);
  // A temp ground is allowed only when the realm recording it is ALSO temp —
  // an isolated stack. Writing a throwaway path into the operator's real realm
  // outlives the directory it names (see assertDurableGround).
  assertDurableGround(resolved, 'House workspace');
  // EVERY REFUSAL COMES BEFORE THE FIRST WRITE. These checks used to sit AFTER
  // the mkdirs, so a refused root was still left holding repos/, post/, and
  // workspaces/ — directories nobody asked for, under a path the operator was
  // just told they could not use (echo, 2026-07-26). Validate, then create.
  //
  // A LANE can never become the ground (GPT sol r3): stamping our marker
  // over a being's home would reclassify it out of lane discovery — the
  // exact harm the marker exists to prevent, inverted. Refuse any root
  // that is someone's lane: a foreign lane.json kind, or the shape of a
  // being's home (owner.json / dna) with no marker at all.
  let standingMarker = null;
  try {
    standingMarker = JSON.parse(await fs.readFile(path.join(resolved, 'lane.json'), 'utf8'));
  } catch { /* no marker — checked by shape below */ }
  if (standingMarker && standingMarker.kind !== 'house-ground') {
    throw refuse(`This directory is a ${standingMarker.kind} lane — a house ground can never overwrite a lane`);
  }
  if (!standingMarker) {
    const laneShaped = await Promise.all(
      ['owner.json', 'dna'].map((p) => fs.access(path.join(resolved, p)).then(() => true, () => false)),
    );
    if (laneShaped.some(Boolean)) {
      throw refuse('This directory is a being\'s lane — a house ground can never overwrite a lane');
    }
  }
  // THE PLACE LAW, HELD FROM BOTH SIDES. setAllianceRoot refuses a cross-house
  // root that sits inside the house ground — but only if the house ground was
  // already set. Set the alliances root FIRST and both its checks pass
  // trivially, and nothing here would have stopped the house then being moved
  // INSIDE it: the same harm, reached by the other order (echo RQ, 2026-07-26).
  const { root: allianceRoot } = await loadAllianceRoot(wallet);
  if (allianceRoot) {
    if (isWithin(resolved, allianceRoot)) {
      throw refuse(
        `A house ground cannot stand inside the alliances root (${allianceRoot}) — your house would sit in ground you share with other houses`,
      );
    }
    if (isWithin(allianceRoot, resolved)) {
      throw refuse(
        `The alliances root (${allianceRoot}) stands inside that path — a house ground can never contain the ground you share with other houses`,
      );
    }
  }
  assertClearOfLanes(resolved);
  await assertClearOfRealmAndSettings(wallet, resolved, 'a house ground');
  await assertClearOfOtherHouses(wallet, resolved);

  // Every refusal is behind us — now the ground may be raised.
  await fs.mkdir(path.join(resolved, 'repos'), { recursive: true });
  // The mail room stands with the ground (HOUSE POST, Design note, 2026-07-24:
  // post/<member>/inbox.jsonl is the house's internal word — raising the
  // convention here means every ground ever set carries it.
  await fs.mkdir(path.join(resolved, 'post'), { recursive: true });
  // Each being's own working ground lives beside the collective repos
  // (Design note, 2026-07-24: a being's projects default to THEIR channel's ground,
  // set up ahead of time so no one disorganizes themselves). The per-being
  // dirs are raised on demand (ensureBeingGround); the trunk stands from
  // the first set.
  await fs.mkdir(path.join(resolved, 'workspaces'), { recursive: true });
  // A BRAND KIT PER MANAGED COMPANY (Design note, 2026-08-30: […]). Beside `workspaces/`, never inside one: several house members
  // may work one brand, one member may hold several, and a brand outlives
  // whoever is currently responsible for it. Who holds it is recorded IN the
  // kit, so handing a brand over is an edit rather than a file move.
  await fs.mkdir(path.join(resolved, 'brands'), { recursive: true });

  const probe = path.join(resolved, '.house-probe');
  await fs.writeFile(probe, 'probe');
  await fs.rm(probe);
  // The ground is NEVER a being's lane: when it lives under a workspaces
  // root (the founding default), directory-based lane discovery would read
  // a bare dir as a being (listNeuma law: […]).
  // The same sovereignty-boundary marker that keeps witness lanes out of
  // neuma listings keeps the ground out too — harmless anywhere else.
  await writeJsonAtomic(path.join(resolved, 'lane.json'), {
    kind: 'house-ground',
    note: 'the house\'s shared ground — not a being\'s lane',
  });
  await writeJsonAtomic(fileOf(wallet), { root: resolved });
  return houseWorkspaceStatus(wallet);
};

/**
 * Raise the house's ground IF none is chosen — and never touch a standing
 * choice (the witness's chosen root is theirs; founding must not move it).
 * Built for the founding rite (Design note, 2026-07-24: registration locks the whole
 * organization in — seats, ground, mail room — […]): a house is never again founded ground-less.
 *
 * impure (fs read + possible ground raise).
 *
 * @param {string} wallet
 * @param {string} defaultRoot - absolute root used only when none is set
 * @returns {Promise<{root: string|null, raised: boolean}>}
 */
export const ensureHouseGround = async (wallet, defaultRoot) => {
  const { root } = await loadHouseWorkspace(wallet);
  if (root) return { root, raised: false };
  const status = await setHouseWorkspace(wallet, defaultRoot);
  return { root: status.root, raised: true };
};

// The same identity law every neumaId crosses at the platform boundary —
// one path segment, no separators, no traversal.
const BEING_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Ensure a being's own working ground inside the house —
 * `<root>/workspaces/<neumaId>` — and return it. This is the being's
 * channel made ground: their projects default here, pre-raised so the
 * organization is set up ahead of the witness ever browsing. No ground
 * set → `{ path: null }` (nothing to raise; the caller falls back).
 *
 * impure (fs read + possible dir raise).
 *
 * @param {string} wallet
 * @param {string} neumaId
 * @returns {Promise<{path: string|null}>}
 */
export const ensureBeingGround = async (wallet, neumaId) => {
  if (!BEING_ID_RE.test(String(neumaId || ''))) {
    throw new Error('Invalid being id');
  }
  const { root } = await loadHouseWorkspace(wallet);
  if (!root) return { path: null };
  const dir = path.join(root, 'workspaces', neumaId);
  await fs.mkdir(dir, { recursive: true });
  return { path: dir };
};

// impure — the ground as it stands: the root and what lives in repos/.
export const houseWorkspaceStatus = async (wallet) => {
  const { root } = await loadHouseWorkspace(wallet);
  if (!root) return { root: null, repos: [] };
  let repos = [];
  try {
    const entries = await fs.readdir(path.join(root, 'repos'), { withFileTypes: true });
    repos = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch { /* repos/ missing or unreadable — the root still stands */ }
  return { root, repos };
};
