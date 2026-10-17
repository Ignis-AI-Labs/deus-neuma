// files-refresh-apply — what one `neuma:files-changed` announcement asks of
// the tree, pure.
//
// Three shapes ride the bus since the live watch (2026-08-15):
//   { path }  a single file moved — re-list its directory (the original
//             contract, from editor saves and being acts).
//   { bulk }  a root's subtree churned past counting (npm install, a git
//             checkout) — re-list the root and every EXPANDED dir under it;
//             what is not on screen re-lists when it is next opened.
//   { git }   .git internals only — no dir moved; the badges re-probe.
// Every shape refreshes git: a write can always move a repo's state.

import { dirOf } from '../../../utils/path.js';

/**
 * @param {{path?: string, bulk?: string, git?: boolean}|null} detail
 * @param {Iterable<string>} expanded - the dirs the tree currently shows open
 * @returns {{dirs: string[], git: boolean}}
 */
// pure
export const refreshPlanFor = (detail, expanded) => {
  if (!detail || typeof detail !== 'object') return { dirs: [], git: false };
  if (typeof detail.path === 'string' && detail.path) {
    return { dirs: [dirOf(detail.path)], git: true };
  }
  if (typeof detail.bulk === 'string' && detail.bulk) {
    const under = [...expanded].filter((d) => d === detail.bulk || d.startsWith(`${detail.bulk}/`));
    return { dirs: [detail.bulk, ...under.filter((d) => d !== detail.bulk)], git: true };
  }
  return { dirs: [], git: detail.git === true };
};

/**
 * A BURST of announcements → one plan. The live watch re-announces a folded
 * backend frame per path, so a busy tree fires dozens of events a second;
 * the listeners that spent a metered call per event 429'd the desk (Founder,
 * live 2026-08-27). The burst folds back here: dirs union (first-seen
 * order), git ORs — one re-list per moved dir, one badge re-probe. Pure.
 * @param {Array<{path?: string, bulk?: string, git?: boolean}|null>} details
 * @param {Iterable<string>} expanded - the dirs the tree currently shows open
 * @returns {{dirs: string[], git: boolean}}
 */
export const mergeRefreshPlans = (details, expanded) => {
  const dirs = [];
  const seen = new Set();
  let git = false;
  for (const detail of Array.isArray(details) ? details : []) {
    const plan = refreshPlanFor(detail, expanded);
    for (const d of plan.dirs) {
      if (!seen.has(d)) { seen.add(d); dirs.push(d); }
    }
    git = git || plan.git;
  }
  return { dirs, git };
};

/**
 * Which roots a burst's badge re-probe must cover. The 429 fix folded the
 * EVENT axis (one flush per burst) but left the ROOT axis: every flush
 * re-probed EVERY open root, so a 14-root desk still spent 14 metered calls
 * per burst — ~420/min under sustained churn, the bucket dead in seconds
 * (audit, 2026-09-02). Path/bulk frames name their dirs, so the probe scopes
 * to the roots that actually moved. A git-ONLY frame (.git plumbing: a
 * commit, a checkout) names no dir — there the probe stays wide, because a
 * commit is exactly when every badge owes the truth, and commits are
 * human-paced, never a storm. Pure.
 * @param {{dirs: string[], git: boolean}} plan
 * @param {string[]} roots - the open roots
 * @returns {string[]} roots to re-probe
 */
export const gitRootsFor = (plan, roots) => {
  const all = [...(roots || [])];
  const moved = all.filter((r) => (plan?.dirs || []).some((d) => d === r || d.startsWith(`${r}/`)));
  return moved.length > 0 ? moved : all;
};
