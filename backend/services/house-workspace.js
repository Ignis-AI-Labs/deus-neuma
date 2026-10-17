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
import { assertDurableGround, walletDir, writeJsonAtomic } from './user-realm.js';
import { isWithin, loadAllianceRoot, loadHouseWorkspace } from './ground-roots.js';

// This ground's own loader keeps its public address here (CQ-036, #395 moved
// it to ground-roots.js — the place law is held from both sides, so both root
// loaders live in shared ground now, and the dynamic-import cycle patch below
// is gone).
export { loadHouseWorkspace };


const fileOf = (wallet) => path.join(walletDir(wallet), 'house-workspace.json');

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
    throw new Error(`This directory is a ${standingMarker.kind} lane — a house ground can never overwrite a lane`);
  }
  if (!standingMarker) {
    const laneShaped = await Promise.all(
      ['owner.json', 'dna'].map((p) => fs.access(path.join(resolved, p)).then(() => true, () => false)),
    );
    if (laneShaped.some(Boolean)) {
      throw new Error('This directory is a being\'s lane — a house ground can never overwrite a lane');
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
      throw new Error(
        `A house ground cannot stand inside the alliances root (${allianceRoot}) — your house would sit in ground you share with other houses`,
      );
    }
    if (isWithin(allianceRoot, resolved)) {
      throw new Error(
        `The alliances root (${allianceRoot}) stands inside that path — a house ground can never contain the ground you share with other houses`,
      );
    }
  }

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
