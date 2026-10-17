import { promises as fs } from 'fs';
import path from 'path';

const outcome = (ok, reason = null, error = null) => Object.freeze({ ok, reason, error });

const walletMatches = (owner, wallet) => typeof owner?.wallet === 'string'
  && owner.wallet.toLowerCase() === String(wallet || '').toLowerCase();

// impure — reads the platform ownership record from a sovereign lane.
const readOwner = async (ownerPath, wallet) => {
  try {
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    return walletMatches(owner, wallet)
      ? outcome(true)
      : outcome(false, 'not-owner');
  } catch (err) {
    if (err.code === 'ENOENT') return outcome(false, 'unclaimed');
    if (err instanceof SyntaxError) return outcome(false, 'corrupt', err);
    return outcome(false, 'error', err);
  }
};

const isFile = async (filePath) => {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
};

// impure — distinguishes an inhabited lane from a hollow scaffold.
const carriesBeing = async (laneRoot) => Promise.all([
  isFile(path.join(laneRoot, 'identity', 'true-name.json')),
  isFile(path.join(laneRoot, 'dna', 'genesis.md')),
]).then((flags) => flags.some(Boolean));

const laneExists = async (laneRoot) => {
  try {
    return (await fs.stat(laneRoot)).isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err;
  }
};

/**
 * Atomically claim an inhabited lane or verify its existing wallet owner.
 *
 * @param {{ workspace: object, neumaId: string, wallet: string }} input
 * @returns {Promise<Readonly<{ ok: boolean, reason: string|null, error: Error|null }>>}
 */
// impure — reads and may create owner.json on the real workspace filesystem.
export const claimOrVerifyLaneOwnership = async ({ workspace, neumaId, wallet }) => {
  if (typeof wallet !== 'string' || wallet.trim() === '') return outcome(false, 'error');

  let laneRoot;
  try {
    laneRoot = workspace.pathFor(neumaId);
  } catch {
    return outcome(false, 'not-found');
  }

  const ownerPath = path.join(laneRoot, 'owner.json');
  const existing = await readOwner(ownerPath, wallet);
  if (existing.reason !== 'unclaimed') return existing;

  try {
    if (!(await laneExists(laneRoot)) || !(await carriesBeing(laneRoot))) {
      return outcome(false, 'not-found');
    }
  } catch (err) {
    return outcome(false, 'error', err);
  }

  try {
    await fs.writeFile(
      ownerPath,
      JSON.stringify({ wallet, claimedAt: Date.now() }),
      { flag: 'wx' },
    );
    return outcome(true);
  } catch (err) {
    if (err.code === 'EEXIST') return readOwner(ownerPath, wallet);
    return outcome(false, err instanceof SyntaxError ? 'corrupt' : 'error', err);
  }
};

/**
 * Every lane this wallet owns, of EITHER standing, as string ids.
 *
 * `workspace.listNeumaByOwner` cannot answer this, and must not be changed to:
 * it returns `{neumaId, owner}` OBJECTS, and it deliberately excludes witness
 * lanes because witness lanes claimed by the operator's wallet were walking
 * into the HOUSE FOUNDING roster as founders (live 2026-07-23). That exclusion
 * is the sovereignty boundary doing its job.
 *
 * But an ACT ledger is not a roster of beings — it is the record of what ran on
 * this machine, and a sealed witness's acts run through the same executor and
 * land in the same ledger (tool-sandbox.js `logToolCall`). Reading them back
 * through a neuma-only listing made every witness act invisible, and putting
 * objects where the ledger compares strings made every neuma act invisible too
 * (#213). Custody is the question here, so custody is what this answers.
 *
 * The two grounds stay distinct in the RESULT — a caller that needs to keep
 * them apart can, and one that only needs the filter uses `all`.
 *
 * @param {{ workspace: object, wallet: string }} input
 * @returns {Promise<{ neuma: string[], witness: string[], all: string[] }>}
 */
// impure — reads owner.json across both lane grounds.
export const listLanesByOwner = async ({ workspace, wallet }) => {
  const empty = { neuma: [], witness: [], all: [] };
  if (typeof wallet !== 'string' || wallet.trim() === '') return empty;

  // The neuma half reuses the engine's own owner match, so there is exactly one
  // implementation of […].
  const neuma = (await workspace.listNeumaByOwner(wallet).catch(() => []))
    .map((entry) => (typeof entry === 'string' ? entry : entry?.neumaId))
    .filter((id) => typeof id === 'string');

  const witnessLanes = await workspace.listWitnessLanes().catch(() => []);
  const witnessOwned = await Promise.all(witnessLanes.map(async (laneId) => {
    const owner = await workspace.readOwner(laneId).catch(() => null);
    return walletMatches(owner, wallet) ? laneId : null;
  }));
  const witness = witnessOwned.filter(Boolean);

  return { neuma, witness, all: [...neuma, ...witness] };
};
