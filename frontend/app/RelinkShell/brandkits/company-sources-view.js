// company-sources-view — the pure display model for a company's SITE & CODE:
// what each repo is to the CMO right now, the overview counts, and the
// proposals the owner ticks before anything is recorded.
//
// Pure throughout.

/**
 * What a listed repo is to the seated CMO, in a mark and plain words. Pure.
 * @param {{path: ?string, granted: boolean, onDisk: ?boolean}} repo
 * @param {?{laneId: string}} cmo
 * @returns {{key: string, label: string, note: string}}
 */
export const repoState = (repo, cmo) => {
  if (!repo.path) return { key: 'remote', label: 'ELSEWHERE ONLY', note: 'Not on this computer — recorded so the CMO knows it exists.' };
  if (repo.onDisk === false) return { key: 'missing', label: 'NOT A REPOSITORY HERE', note: 'There is no git repository at that folder on this computer.' };
  if (repo.granted) return { key: 'granted', label: 'THE CMO CAN READ', note: 'Read only — never a change. The walls (.env, keys, credential stores) stay shut.' };
  if (!cmo) return { key: 'no-cmo', label: 'NO CMO SEATED', note: 'Seat a CMO in CAMPAIGNS, then let it read.' };
  return { key: 'closed', label: 'NOT LENT', note: 'The CMO cannot read it until you let it.' };
};

/**
 * The overview counts for one company. Pure.
 * @param {{repos: Array<object>}} company
 */
export const sourcesTally = (company) => {
  const repos = company?.repos || [];
  return {
    repos: repos.length,
    readable: repos.filter((r) => r.granted).length,
    here: repos.filter((r) => r.path).length,
  };
};

/**
 * The CMO's name as the house knows it, else its lane id. Pure.
 * @param {?{laneId: string}} cmo
 * @param {Array<{neumaId: string, name?: string}>} roster
 */
export const cmoName = (cmo, roster) => {
  if (!cmo) return null;
  const member = (Array.isArray(roster) ? roster : []).find((m) => m?.neumaId === cmo.laneId);
  return member?.name || cmo.laneId;
};

/** A repo as the company block stores it — no display fields. Pure. */
export const storedRepo = (r) => ({
  ...(r.path?.trim() ? { path: r.path.trim() } : {}),
  ...(r.remote?.trim() ? { remote: r.remote.trim() } : {}),
  role: (r.role || '').trim(),
});

/**
 * Why a typed repo cannot be added yet, or null. The server holds the same
 * law; this only says NO sooner and with a reason. Pure.
 * @param {{path: string, remote: string}} typed
 * @param {Array<{path: ?string, remote: ?string}>} listed
 */
export const typedRepoRefusal = ({ path, remote }, listed) => {
  const p = path.trim();
  const r = remote.trim();
  if (!p && !r) return 'NAME THE FOLDER ON THIS COMPUTER, THE WEB ADDRESS, OR BOTH';
  if (p && (!p.startsWith('/') || p.includes('..') || (p.length > 1 && p.endsWith('/')))) return 'THE FOLDER IS A FULL PATH: /LIKE/THIS';
  if (r && !/^https:\/\/\S+$/i.test(r)) return 'THE WEB ADDRESS STARTS WITH https://';
  if (listed.some((l) => (p && l.path === p) || (!p && r && l.remote === r))) return 'THAT REPO IS LISTED ALREADY';
  return null;
};

/**
 * The repos list after the owner confirms the ticked proposals. Pure.
 * @param {Array<object>} listed
 * @param {Array<{path: string, remote: ?string, role: string, ticked: boolean}>} proposals
 */
export const withTicked = (listed, proposals) => [
  ...listed.map(storedRepo),
  ...proposals.filter((p) => p.ticked).map(storedRepo),
];
