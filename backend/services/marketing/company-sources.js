// company-sources — where each company's work stands, and who may read it.
//
// The owner, 2026-10-24: the CMO […]. A
// company's kit lists its repos (branding/company-repos.js); this module is
// the READ GRANT over them — the owner's yes, once per repo, to the house's
// seated CMO.
//
// THE GRANT IS AN ORDINARY READ ROOT. It lands on the CMO lane's own policy
// (`pathGrants.read`, the same place an ALWAYS on a read card lands), so:
// the being's existing file reads (fs/read, fs/list, fs/search) reach the
// repo with every wall still in force — .env, keys, credential stores, .git
// internals and the write walls (sandbox-path-policy.js) — and it is never a
// write; the PERMISSIONS panel lists it and takes it back like any other; and
// `company_updates` asks the same policy, so one record answers both.
//
// Never automatic: the grant itself (company-repo-grants.js) runs only when
// the owner presses its card, at the desk, for a repo its company — in the
// caller's own house — lists. This module reads: the sources, the grants
// standing, and the repos beside this app worth proposing.
//
// impure — disk (kits, lane policy), git.

import os from 'os';
import path from 'path';
import { realpathSync } from 'fs';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { neumaWorkspace } from '../../../core/index.js';
import { getWorkspacesRoot } from '../../../core/workspace/neuma-workspace.js';
import { checkPathAccess, isWithinRoots } from '../sandbox-path-policy.js';
import { getDataRoot } from '../data-root.js';
import { getRealmRoot } from '../user-realm.js';
import { cmoDesignation } from './cmo-designation.js';
import { listCompanies } from './companies.js';
import { isRepoRoot, originOf } from './repo-reads.js';

const APP_CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// impure — the symlink-resolved path, or null when it does not exist.
export const realOrNull = (p) => { try { return realpathSync(p); } catch { return null; } };

/**
 * The read roots a lane's own policy holds. impure.
 * @param {?string} laneId
 * @returns {Promise<string[]>}
 */
export const laneReadRoots = async (laneId) => {
  if (!laneId) return [];
  const policy = await neumaWorkspace.readToolPolicy(laneId).catch(() => null);
  return Array.isArray(policy?.pathGrants?.read) ? policy.pathGrants.read : [];
};

/** Does a lane's own policy let it read this repo? Pure given its roots. */
export const repoGranted = (roots, repoPath) => Boolean(repoPath) && isWithinRoots(repoPath, roots);

// pure — `inner` is `outer` or below it.
const within = (inner, outer) => inner === outer || inner.startsWith(outer + path.sep);

/**
 * Why a folder may never be granted as a repo, or null. A repo is a project,
 * never a place that holds the operator's whole life or sits inside the
 * platform's own state: not the home folder or anything above it, and not
 * inside the lanes, the realm or the data root (other beings' and houses'
 * records); never a place the secret walls refuse outright. A repo that
 * CONTAINS one of those (this app's own checkout keeping its data/ inside)
 * is read as any granted folder is — behind the same walls. impure.
 * @param {string} real - the repo's symlink-resolved path
 * @returns {?string}
 */
export const repoWallRefusal = (real) => {
  const home = realOrNull(os.homedir()) || os.homedir();
  if (real === path.parse(real).root || within(home, real)) return 'that folder holds your whole home (or more) — name the repository folder itself';
  for (const [root, what] of [[getWorkspacesRoot(), 'the beings\' lanes'], [getRealmRoot(), 'every house\'s records'], [getDataRoot(), 'this install\'s data']]) {
    const r = realOrNull(root) || path.resolve(root);
    if (within(real, r)) return `that folder is inside ${what} — no repo grant reaches there`;
  }
  const wall = checkPathAccess(real, []);
  return wall.allowed ? null : `that folder is behind a wall the platform keeps (${wall.reason})`;
};

/**
 * Every company of the house with its site and repos, and for each repo
 * whether the seated CMO may read it. `probe` (the install owner at the
 * desk) adds whether each path is a repository on this machine. impure.
 * @param {string} wallet
 * @param {{probe?: boolean}} [opts]
 */
export const companySources = async (wallet, { probe = false } = {}) => {
  const [companies, officer] = await Promise.all([listCompanies(wallet), cmoDesignation.getOfficer(wallet).catch(() => null)]);
  const roots = await laneReadRoots(officer?.laneId);
  const out = await Promise.all(companies.map(async (c) => ({
    id: c.id,
    name: c.name,
    depth: c.depth,
    site: c.site,
    repos: await Promise.all(c.repos.map(async (r) => ({
      ...r,
      granted: repoGranted(roots, r.path),
      onDisk: probe && r.path ? await isRepoRoot(r.path) : null,
    }))),
  })));
  return { cmo: officer?.laneId ? { laneId: officer.laneId } : null, companies: out };
};

// pure — the words of a company's name and id worth matching a folder on.
const tokensOf = (company) => [...new Set(`${company.id} ${company.name}`.toLowerCase().split(/[^a-z0-9]+/))]
  .filter((t) => t.length >= 4);

// pure — what a folder probably is to its company, from its name; '' when the
// name does not say (the owner writes it).
const roleGuess = (dir, isApp) => {
  if (isApp) return 'the app';
  if (/(^|-)(site|web|www)(-|$)/.test(dir)) return 'the website';
  if (/(^|-)docs?(-|$)/.test(dir)) return 'the docs';
  return '';
};

/**
 * The repos beside this app's own checkout that look like a company's, for
 * the owner to confirm — never recorded by this call. `strong` marks a
 * folder named for the company itself (its id, `<id>-site`, or this app's own
 * checkout when the company's name carries it); the rest share a word with
 * the company's name. Where it looks: the folder holding this app's own
 * checkout, or NEUMA_COMPANY_REPO_SCAN_DIR when the operator keeps their
 * repos elsewhere (read per call). impure — lists one folder, runs git.
 * @param {string} wallet
 * @param {string} companyId
 * @param {{scanDir?: string, appDir?: string}} [opts]
 */
export const proposeRepos = async (wallet, companyId, { scanDir = process.env.NEUMA_COMPANY_REPO_SCAN_DIR, appDir = APP_CHECKOUT } = {}) => {
  const company = (await listCompanies(wallet)).find((c) => c.id === companyId);
  if (!company) return { ok: false, error: `there is no "${companyId}" company in your house` };
  const app = realOrNull(appDir);
  const dir = scanDir || (app ? path.dirname(app) : null);
  if (!dir) return { ok: true, scanned: null, proposals: [] };
  const tokens = tokensOf(company);
  const listed = new Set(company.repos.map((r) => r.path).filter(Boolean));
  const names = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const proposals = [];
  for (const entry of names.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = realOrNull(path.join(dir, entry.name));
    const name = entry.name.toLowerCase();
    if (!full || listed.has(full) || !tokens.some((t) => name.includes(t))) continue;
    if (!(await isRepoRoot(full)) || repoWallRefusal(full)) continue;
    const isApp = full === app;
    const origin = await originOf(full);
    proposals.push({
      path: full,
      remote: origin && /^https:\/\//.test(origin) ? origin.replace(/\.git$/, '') : null,
      role: roleGuess(name, isApp),
      strong: name === company.id || name === `${company.id}-site` || isApp,
    });
  }
  return { ok: true, scanned: dir, proposals };
};

/**
 * The CMO briefing's one line on the company sources, or '' when no company
 * records a site or a repo. Counts only — the reading is company_updates,
 * loaded on demand. impure.
 * @param {string} wallet
 * @param {string} laneId
 */
export const sourcesBriefingLine = async (wallet, laneId) => {
  const companies = await listCompanies(wallet);
  const repos = companies.flatMap((c) => c.repos);
  const sites = companies.filter((c) => c.site.url).length;
  if (!repos.length && !sites) return '';
  const roots = await laneReadRoots(laneId);
  const readable = repos.filter((r) => repoGranted(roots, r.path)).length;
  return `COMPANY SOURCES: your companies record ${sites} site(s) and ${repos.length} code repo(s) (${readable} you may read). `
    + 'company_updates {company} says what changed since your last report — commits, changelog, release notes, the site — cited; report only what it shows.';
};
