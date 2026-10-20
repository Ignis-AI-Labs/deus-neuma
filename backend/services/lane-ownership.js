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

// impure — the lane's root, or null when the engine refuses the id
const laneRootOf = (workspace, neumaId) => {
  try {
    return workspace.pathFor(neumaId);
  } catch {
    return null;
  }
};

/**
 * Verify a lane's wallet owner. A READ NEVER CLAIMS (ruling, 2026-10-19): a lane
 * no wallet has claimed answers 'unclaimed' and nothing is written — its
 * operator claims it deliberately (claimLane).
 *
 * @param {{ workspace: object, neumaId: string, wallet: string }} input
 * @returns {Promise<Readonly<{ ok: boolean, reason: string|null, error: Error|null }>>}
 *   reason: 'not-owner' | 'unclaimed' | 'not-found' (missing or hollow) | 'corrupt' | 'error'
 */
// impure — reads owner.json and the lane's identity markers.
export const verifyLaneOwnership = async ({ workspace, neumaId, wallet }) => {
  if (typeof wallet !== 'string' || wallet.trim() === '') return outcome(false, 'error');
  const laneRoot = laneRootOf(workspace, neumaId);
  if (!laneRoot) return outcome(false, 'not-found');

  const existing = await readOwner(path.join(laneRoot, 'owner.json'), wallet);
  if (existing.reason !== 'unclaimed') return existing;
  try {
    return (await laneExists(laneRoot)) && (await carriesBeing(laneRoot))
      ? outcome(false, 'unclaimed')
      : outcome(false, 'not-found');
  } catch (err) {
    return outcome(false, 'error', err);
  }
};

// impure — the operator wallet the lane's genesis seal names, null when
// unsealed; a seal that cannot be read is an error, never "unsealed".
const sealedWallet = async (laneRoot) => {
  let raw;
  try {
    raw = await fs.readFile(path.join(laneRoot, 'identity', 'genesis-seal.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const wallet = JSON.parse(raw)?.record?.witnessWallet;
  if (typeof wallet !== 'string' || !wallet.trim()) throw new Error('genesis seal names no operator wallet');
  return wallet.toLowerCase();
};

/**
 * Claim an inhabited, unclaimed lane — deliberately, never on a read. A lane
 * belongs to the wallet its genesis seal names; a lane with no seal is adopted
 * only by the install owner (the caller has checked that and says so with
 * `adopt`). The `wx` write means two claims racing cannot both land.
 *
 * @param {{ workspace: object, neumaId: string, wallet: string, adopt?: boolean }} input
 * @returns {Promise<Readonly<{ ok: boolean, reason: string|null, error: Error|null }>>}
 *   reason: 'sealed-to-another' | 'unsealed' (needs the install owner) | any verify reason
 */
// impure — reads the seal and may create owner.json.
export const claimLane = async ({ workspace, neumaId, wallet, adopt = false }) => {
  const verified = await verifyLaneOwnership({ workspace, neumaId, wallet });
  if (verified.reason !== 'unclaimed') return verified;
  const laneRoot = laneRootOf(workspace, neumaId);
  try {
    const sealedTo = await sealedWallet(laneRoot);
    if (sealedTo && sealedTo !== wallet.toLowerCase()) return outcome(false, 'sealed-to-another');
    if (!sealedTo && !adopt) return outcome(false, 'unsealed');
  } catch (err) {
    return outcome(false, err instanceof SyntaxError ? 'corrupt' : 'error', err);
  }
  const ownerPath = path.join(laneRoot, 'owner.json');
  try {
    await fs.writeFile(ownerPath, JSON.stringify({ wallet: wallet.toLowerCase(), claimedAt: Date.now() }), { flag: 'wx' });
    return outcome(true);
  } catch (err) {
    if (err.code === 'EEXIST') return readOwner(ownerPath, wallet);
    return outcome(false, 'error', err);
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
