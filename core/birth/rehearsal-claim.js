/**
 * Rehearsal claims — the platform's own record of every directory it made for
 * a rehearsal birth (audit P6-69).
 *
 * The sweep (rehearsal-sweep.js) used to trust the lane a checkpoint file
 * names, and checkpoints live in the ceremony scratch folder a being in birth
 * may write. A forged checkpoint naming `victim/keys`, `victim/dna` or the
 * house ground had those directories deleted at the next hourly sweep.
 *
 * A claim is written only at the moment the platform itself creates a fresh
 * rehearsal lane, and it lives beside the install's settings, outside every
 * folder a being may write (its lane, the ceremony scratch, the house ground).
 * It names the session, the lane id, the house root and the directory's own
 * identity on disk (device + inode). The sweep deletes a directory only when
 * a claim proves that exact directory is a rehearsal's own throwaway ground.
 *
 * core/ never imports backend/ (the layer rule), so the data root is read the
 * way ceremony-write.js reads it.
 *
 * impure — every export touches the filesystem.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveCeremonyScratchDir } from './ceremony-write.js';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SESSION_ID = /^[0-9a-f]{32}$/;
/** One path segment: no separator, no dot, never a leading hyphen. */
const LANE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** Where the claims live: `<data root>/settings/rehearsal-lanes`, never the scratch folder. */
const rehearsalClaimsDir = () =>
  path.join(path.dirname(resolveCeremonyScratchDir(PROJECT_ROOT)), 'settings', 'rehearsal-lanes');

const claimPath = (sessionId) => {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error('Invalid birth sessionId');
  return path.join(rehearsalClaimsDir(), `${sessionId}.json`);
};

/**
 * The directory a lane id names directly under the house root, or null when
 * the id is not one plain segment of it.
 * @param {string} root - the house root
 * @param {string} neumaId
 * @returns {?string}
 */
export const rehearsalLanePath = (root, neumaId) => {
  if (typeof neumaId !== 'string' || !LANE_ID.test(neumaId)) return null;
  const house = path.resolve(root);
  const lane = path.join(house, neumaId);
  return path.dirname(lane) === house ? lane : null;
};

/**
 * The claim one session holds, or null (none, unreadable, or not this session's).
 * @param {string} sessionId
 * @returns {Promise<?{sessionId: string, neumaId: string, root: string, dev: number, ino: number}>}
 */
export const readRehearsalClaim = async (sessionId) => {
  try {
    const claim = JSON.parse(await fs.readFile(claimPath(sessionId), 'utf8'));
    return claim?.sessionId === sessionId ? claim : null;
  } catch {
    return null;
  }
};

/** Drop a session's claim. A missing claim is fine; a malformed id is refused silently (nothing to drop). */
export const releaseRehearsalClaim = async (sessionId) => {
  try {
    await fs.unlink(claimPath(sessionId));
  } catch (err) {
    if (err.code !== 'ENOENT' && err.message !== 'Invalid birth sessionId') throw err;
  }
};

/**
 * Create a rehearsal's lane directory and record the claim on it. The
 * directory must not exist yet: a rehearsal never claims a lane that already
 * stands, whoever it belongs to. The same session claiming the same directory
 * again (a retried stage) is a no-op. Throws when the lane cannot be proven
 * fresh; the session then carries no `rehearsalLane` and nothing is swept.
 * @param {object} session - the birth session ({ id, isTest, data: { neumaId } })
 * @param {object} workspace - NeumaWorkspace instance (its .root is the house)
 * @returns {Promise<string>} the lane directory
 */
export const claimRehearsalLane = async (session, workspace) => {
  const neumaId = session?.data?.neumaId;
  const root = path.resolve(workspace.root);
  const lane = rehearsalLanePath(root, neumaId);
  if (session?.isTest !== true || !lane) throw new Error('A rehearsal lane needs a rehearsal session and a plain lane id');
  const file = claimPath(session.id);
  // The workspace engine resolves some id shapes beside the house, never in it;
  // a rehearsal claims only the directory the engine itself will scaffold.
  const engineHouse = path.dirname(workspace.pathFor(neumaId));
  if (engineHouse !== root && engineHouse !== await fs.realpath(root).catch(() => root)) {
    throw new Error(`Rehearsal lane "${neumaId}" does not resolve inside the house`);
  }
  await fs.mkdir(root, { recursive: true });
  try {
    await fs.mkdir(lane, { mode: 0o700 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const held = await readRehearsalClaim(session.id);
    const stat = await fs.lstat(lane);
    if (held?.neumaId === neumaId && held.dev === stat.dev && held.ino === stat.ino) {
      session.data.rehearsalLane = neumaId;
      return lane;
    }
    throw new Error(`Lane "${neumaId}" already stands; a rehearsal never takes a standing lane`, { cause: err });
  }
  try {
    const stat = await fs.lstat(lane);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.writeFile(file, JSON.stringify({
      sessionId: session.id, neumaId, root, dev: stat.dev, ino: stat.ino, claimedAt: new Date().toISOString(),
    }), { mode: 0o600 });
  } catch (err) {
    // The claim never lags the directory (#143): no claim, no directory.
    await fs.rmdir(lane).catch(() => {});
    throw err;
  }
  session.data.rehearsalLane = neumaId;
  return lane;
};
