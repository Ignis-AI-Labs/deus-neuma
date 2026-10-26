// company-repos — the code a company is built from, as its kit records it
// (the owner, 2026-10-24: the CMO […]).
//
// `company.repos` is a list of the company's repositories: where each stands
// on this machine (`path`), where it is published (`remote`), and what it is
// to the company in a few words (`role`: "the app", "the website"). A repo on
// another machine only is still worth recording — the CMO knows it exists —
// but only a path on this machine can ever be read, and only once the owner
// lets the CMO read it (marketing/company-sources.js).
//
// Pure throughout.

import path from 'path';

/** More than this many repos is a list nobody keeps true. */
export const MAX_REPOS = 12;

const MAX_PATH = 300;
const MAX_ROLE = 60;
const remoteUrl = (v) => typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v) && v.length <= MAX_PATH;
// A path is the place itself, already resolved: absolute, no `..`, no
// trailing slash, no NUL — so two spellings of one checkout never stand as two.
const plainPath = (v) => typeof v === 'string' && v.length > 1 && v.length <= MAX_PATH
  && !v.includes('\0') && path.isAbsolute(v) && path.resolve(v) === v;
const roleText = (v) => typeof v === 'string' && v.trim().length <= MAX_ROLE;

/**
 * The repos a company block records, normalized; a malformed entry is
 * dropped here (the refusals below name it on the way in). Pure.
 * @param {object} block - a kit's `company` block
 * @returns {ReadonlyArray<{path: ?string, remote: ?string, role: string}>}
 */
export const reposOf = (block) => Object.freeze((Array.isArray(block?.repos) ? block.repos : [])
  .filter((r) => r && typeof r === 'object' && (plainPath(r.path) || remoteUrl(r.remote)))
  .slice(0, MAX_REPOS)
  .map((r) => Object.freeze({
    path: plainPath(r.path) ? r.path : null,
    remote: remoteUrl(r.remote) ? r.remote : null,
    role: roleText(r.role) ? r.role.trim() : '',
  })));

/**
 * What is wrong with a company's repos list, named. Pure.
 * @param {unknown} repos
 * @returns {string[]}
 */
export const repoRefusals = (repos) => {
  if (repos === undefined || repos === null) return [];
  if (!Array.isArray(repos)) return ['company.repos must be a list of {path, remote, role}'];
  if (repos.length > MAX_REPOS) return [`company.repos holds at most ${MAX_REPOS} repos`];
  const out = [];
  const seen = new Set();
  repos.forEach((r, i) => {
    const at = `company.repos[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { out.push(`${at} must be {path, remote, role}`); return; }
    for (const key of Object.keys(r)) if (!['path', 'remote', 'role'].includes(key)) out.push(`${at}.${key} is not a repo field (path, remote, role)`);
    const hasPath = r.path !== undefined && r.path !== null && r.path !== '';
    const hasRemote = r.remote !== undefined && r.remote !== null && r.remote !== '';
    if (!hasPath && !hasRemote) out.push(`${at} needs a path on this machine, a remote web address, or both`);
    if (hasPath && !plainPath(r.path)) out.push(`${at}.path must be a full folder path (/like/this, no "..", no trailing slash)`);
    if (hasRemote && !remoteUrl(r.remote)) out.push(`${at}.remote must be a web address (https://…)`);
    if (r.role !== undefined && r.role !== null && !roleText(r.role)) out.push(`${at}.role must be a few words (at most ${MAX_ROLE} characters)`);
    const key = hasPath ? `p:${r.path}` : `r:${r.remote}`;
    if (seen.has(key)) out.push(`${at} repeats a repo already listed`);
    seen.add(key);
  });
  return out;
};
