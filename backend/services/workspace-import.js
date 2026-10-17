/**
 * Workspace import — the custody rules for writing a bundle into a lane.
 *
 * This was sixty-six lines inside `POST /api/v1/workspace/import`, and none of
 * it was routing: it is the law about WHO may write into a sovereign lane, and
 * it is the reason SEC-AUDIT-003 (#162) is closed. It lives here so the rules
 * can be read and tested as rules, and so the route is a route again.
 *
 * The posture is fail-CLOSED throughout. An existing lane may only be
 * re-imported by its recorded owner; a lane that exists with NO claim is
 * refused rather than adopted, because […] is
 * exactly how a silent takeover looks from the inside.
 *
 * impure — reads and writes the real sovereign filesystem.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from './logger.js';

const log = createLogger('WorkspaceImport');

/** An outcome the route can hand straight to Express. Pure. */
const outcome = (status, body) => Object.freeze({ status, body });

const walletsMatch = (a, b) =>
  String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * The lane's owner, or the refusal that stands in its place.
 * @returns {Promise<{owner: object}|{refusal: object}>}
 */
const readClaim = async (ownerPath, neumaId) => {
  try {
    return { owner: JSON.parse(await fs.readFile(ownerPath, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        refusal: outcome(403, {
          error: 'Workspace exists without a claim — refuse import (no silent takeover)',
        }),
      };
    }
    log.error('Import owner read', { error: err.message, neumaId });
    return { refusal: outcome(500, { error: 'Ownership verification failed' }) };
  }
};

/**
 * Claim a BRAND-NEW lane for the importing wallet.
 *
 * The `wx` flag is load-bearing: two imports racing for the same fresh id must
 * not both believe they claimed it. The loser reads the winner's claim back and
 * is refused unless it is the same wallet.
 * @returns {Promise<object|null>} a refusal outcome, or null when the claim holds
 */
const claimFreshLane = async (ownerPath, wallet) => {
  try {
    await fs.writeFile(
      ownerPath,
      JSON.stringify({ wallet, claimedAt: Date.now() }),
      { flag: 'wx' },
    );
    return null;
  } catch (claimErr) {
    if (claimErr.code !== 'EEXIST') throw claimErr;
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    return walletsMatch(owner.wallet, wallet)
      ? null
      : outcome(403, { error: 'Not your workspace' });
  }
};

/**
 * Import a bundle into a lane, under the custody rules above.
 *
 * @param {{neumaId: *, bundle: *, wallet: string, workspace: object}} input
 * @returns {Promise<Readonly<{status: number, body: object}>>}
 * @throws only on a genuinely unexpected filesystem failure — the caller logs it
 */
// impure
export const importIntoLane = async ({ neumaId, bundle, wallet, workspace }) => {
  if (!neumaId || !bundle) return outcome(400, { error: 'neumaId and bundle required' });
  if (!/^[a-zA-Z0-9_-]+$/.test(neumaId)) return outcome(400, { error: 'Invalid neumaId' });

  // Fail CLOSED on an id the engine refuses — never a hand-join fallback
  // (the split's law: only the resolver knows a lane's true ground).
  let laneDir;
  try {
    laneDir = workspace.pathFor(neumaId);
  } catch {
    return outcome(400, { error: 'Invalid neumaId' });
  }

  const ownerPath = path.join(laneDir, 'owner.json');
  const exists = await workspace.exists(neumaId);

  // SEC-AUDIT-003 / #162: never overwrite a foreign lane or steal owner.json.
  if (exists) {
    const claim = await readClaim(ownerPath, neumaId);
    if (claim.refusal) return claim.refusal;
    const ownerWallet = typeof claim.owner?.wallet === 'string' ? claim.owner.wallet : '';
    if (!ownerWallet || !walletsMatch(ownerWallet, wallet)) {
      return outcome(403, { error: 'Not your workspace' });
    }
  }

  await workspace.importWorkspace(neumaId, bundle);

  // Claim only for brand-new lanes. An existing owner file is already the caller's.
  if (!exists) {
    const refusal = await claimFreshLane(ownerPath, wallet);
    if (refusal) return refusal;
  }

  return outcome(200, { success: true, neumaId });
};
