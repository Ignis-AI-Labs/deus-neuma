// company-repo-grants — the owner's yes, once per repo: the house's seated
// CMO may READ one of a company's repos (company-sources.js says why the
// grant is an ordinary read root on the lane's own policy, walls and all).
//
// Only a repo the company lists, in the caller's own house; only the real
// folder (never a link to one), the top of a git repository, and never a
// place the walls keep (repoWallRefusal). Live sessions of the lane pick the
// grant up on their next turn; a revoke takes it from them at once, exactly
// as the PERMISSIONS panel does.
//
// impure — disk (kits, lane policy), git, live sessions.

import { neumaWorkspace } from '../../../core/index.js';
import { addGrantedReadRoot, removeGrantedReadRoot } from '../tool-policy.js';
import { revokeRuntimePermission } from '../permission-runtime-revoke.js';
import { portalConnections } from '../../routes/portal-connections.js';
import { cmoDesignation } from './cmo-designation.js';
import { listCompanies } from './companies.js';
import { isRepoRoot } from './repo-reads.js';
import { realOrNull, repoWallRefusal } from './company-sources.js';

// impure — the company in this house, and its listed repo at `repoPath`.
const listedRepo = async (wallet, companyId, repoPath) => {
  const company = (await listCompanies(wallet)).find((c) => c.id === companyId);
  if (!company) return { ok: false, error: `there is no "${companyId}" company in your house` };
  const repo = company.repos.find((r) => r.path === repoPath);
  if (!repo) return { ok: false, error: `${company.name} does not list ${repoPath} as one of its repos — add it first` };
  return { ok: true, company, repo };
};

// impure — every live session of the lane re-reads its grants on its next turn.
const rehydrateLane = (laneId) => {
  for (const connection of portalConnections.values()) {
    if (connection.companion?.neumaId === laneId) connection._pathGrantsHydrated = false;
  }
};

/**
 * Let the house's seated CMO read one of a company's repos. impure.
 * @param {string} wallet - the house
 * @param {string} companyId
 * @param {string} repoPath
 * @returns {Promise<{ok: true, laneId: string, path: string}|{ok: false, error: string}>}
 */
export const grantRepoRead = async (wallet, companyId, repoPath) => {
  const listed = await listedRepo(wallet, companyId, repoPath);
  if (!listed.ok) return listed;
  const real = realOrNull(repoPath);
  if (!real) return { ok: false, error: `${repoPath} is not on this machine` };
  if (real !== repoPath) return { ok: false, error: `${repoPath} is a link to ${real} — list the real folder instead` };
  if (!(await isRepoRoot(real))) return { ok: false, error: `${repoPath} is not the top of a git repository` };
  const wall = repoWallRefusal(real);
  if (wall) return { ok: false, error: wall };
  const officer = await cmoDesignation.getOfficer(wallet);
  if (!officer?.laneId) return { ok: false, error: 'your house has no CMO seated — seat one first, then let it read' };
  await neumaWorkspace.updateToolPolicy(officer.laneId, (policy) => addGrantedReadRoot(policy, real));
  rehydrateLane(officer.laneId);
  return { ok: true, laneId: officer.laneId, path: real };
};

/**
 * Take the CMO's read of one repo back (the same row the PERMISSIONS panel
 * would take back). impure.
 */
export const revokeRepoRead = async (wallet, companyId, repoPath) => {
  const listed = await listedRepo(wallet, companyId, repoPath);
  if (!listed.ok) return listed;
  const officer = await cmoDesignation.getOfficer(wallet);
  if (!officer?.laneId) return { ok: false, error: 'your house has no CMO seated' };
  await neumaWorkspace.updateToolPolicy(officer.laneId, (policy) => removeGrantedReadRoot(policy, repoPath));
  revokeRuntimePermission(officer.laneId, { kind: 'folder', access: 'read', path: repoPath });
  return { ok: true, laneId: officer.laneId, path: repoPath };
};
