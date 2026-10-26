// company-updates — what changed in a company, read from its own sources:
// the repos its kit lists (that the owner let this lane read), and its site.
//
// The owner, 2026-10-24: the CMO must […]. So for a window — a date, or the last report — each
// granted repo gives its commit subjects, the changelog fragments added
// (changelog.d/), what CHANGELOG.md gained, and the release notes added or
// changed; one commit's patch on request. Read from git's objects at HEAD,
// so nothing uncommitted is ever claimed as a change.
//
// Walls: a repo the lane was not granted is named and not read; every file
// read is judged by the sandbox's own path law (checkPathAccess) inside the
// repo, so a fragment or a patch section on a walled path (.env, keys,
// credential stores) is never returned; a line shaped like a secret is held
// back wherever it stands. Another house's companies are never in view: the
// company list and the report points are the caller's house's own.
//
// impure — disk, git.

import path from 'path';
import { realpathSync } from 'fs';
import { checkPathAccess } from '../sandbox-path-policy.js';
import { listCompanies } from './companies.js';
import { laneReadRoots, repoGranted } from './company-sources.js';
import { loadReportPoints, recordReportPoint } from './company-updates-store.js';
import {
  baseFor, commitPatch, commitsAfter, filesChangedAfter, headOf, isCommit, isRepoRoot, textAt,
} from './repo-reads.js';
import { changelogGained, pageMark, pageStates, patchForBeing, safeText } from './company-updates-text.js';

const COMMITS_LISTED = 40;
const FRAGMENT_CAP = 1500;
const SECTION_CAP = 3000;
const NOTES_CAP = 2000;
const PATCH_CAP = 24000;
const DEFAULT_DAYS = 7;
const NOT_GRANTED = 'your operator has not let you read it — ask them to (MARKETING → BRAND KITS → SITE & CODE)';

// pure — the company a being named: its id, or its name in any case.
const findCompany = (companies, asked) => {
  const want = String(asked ?? '').trim().toLowerCase();
  return companies.find((c) => c.id === want) || companies.find((c) => c.name.toLowerCase() === want) || null;
};

// pure — the refusal when no company matches, naming the ones there are.
const noCompany = (companies, asked) => (companies.length
  ? `there is no company "${asked}" in your house — it has: ${companies.map((c) => `${c.id} (${c.name})`).join(', ')}`
  : 'your house has no companies yet (each brand kit is one)');

// pure — the window: the date given, else the last report, else a week.
const windowOf = (since, last, now) => {
  if (since) {
    const at = Date.parse(since);
    if (!Number.isFinite(at)) return { error: `"${since}" is not a date (2026-10-20, or a full ISO time)` };
    return { since: new Date(at).toISOString(), why: 'the date you gave', useHeads: false };
  }
  if (last?.at) return { since: last.at, why: `your last report, ${String(last.at).slice(0, 10)}`, useHeads: true };
  return { since: new Date(now - DEFAULT_DAYS * 864e5).toISOString(), why: `the last ${DEFAULT_DAYS} days — no report is recorded yet`, useHeads: false };
};

// impure (stat) — may a being read this repo-relative file? The sandbox's own law.
const readerFor = (root) => (file) => checkPathAccess(path.join(root, file), [root]).allowed;

// impure — why a listed repo cannot be read by this lane now, or null.
const unreadReason = async (repo, roots) => {
  if (!repo.path) return `it is listed at ${repo.remote} only — it is not on this machine, so nothing here reads it`;
  if (!repoGranted(roots, repo.path)) return NOT_GRANTED;
  let real;
  try { real = realpathSync(repo.path); } catch { return 'that folder is not on this machine'; }
  if (real !== repo.path || !(await isRepoRoot(real))) return 'that folder is not the top of a git repository';
  return null;
};

// impure — one granted repo's changes after `base`.
const readRepo = async (repo, base, head) => {
  const mayRead = readerFor(repo.path);
  let held = 0;
  const safe = (text, cap) => { const s = safeText(text, cap); held += s.held; return s.text; };
  const { total, commits } = await commitsAfter(repo.path, base, COMMITS_LISTED);
  const fragments = [];
  for (const f of await filesChangedAfter(repo.path, base, 'changelog.d')) {
    const name = path.basename(f.file);
    if (f.status === 'D' || !name.endsWith('.md') || /^(_|readme)/i.test(name) || !mayRead(f.file)) continue;
    const text = await textAt(repo.path, 'HEAD', f.file);
    if (text !== null) fragments.push({ file: f.file, sha: f.sha, text: safe(text, FRAGMENT_CAP) });
  }
  let changelog = [];
  if (mayRead('CHANGELOG.md') && (await filesChangedAfter(repo.path, base, 'CHANGELOG.md')).length) {
    const before = base ? await textAt(repo.path, base, 'CHANGELOG.md') : null;
    changelog = changelogGained(before, await textAt(repo.path, 'HEAD', 'CHANGELOG.md'))
      .map((s) => ({ heading: s.heading, body: safe(s.body, SECTION_CAP) }));
  }
  const notes = [];
  for (const n of await filesChangedAfter(repo.path, base, 'docs/operations')) {
    if (n.status === 'D' || !/^release-notes-.+\.md$/.test(path.basename(n.file)) || !mayRead(n.file)) continue;
    const text = await textAt(repo.path, 'HEAD', n.file);
    if (text !== null) notes.push({ file: n.file, sha: n.sha, status: n.status, text: safe(text, NOTES_CAP) });
  }
  return {
    ...repo, base, head, total, commits: commits.map((c) => ({ ...c, subject: safe(c.subject, 300) })), fragments, changelog, notes, held,
  };
};

/**
 * What changed in one of the house's companies. impure.
 * @param {object} q
 * @param {string} q.wallet - the house
 * @param {?string} q.laneId - the reading lane (its own grants decide)
 * @param {string} q.company - id or name
 * @param {?string} [q.since] - a date; else since the last report
 * @param {boolean} [q.markReported] - record this read as the report point
 * @param {?{pages?: Array<{url: string, text: string}>, failed?: Array<{url: string, error: string}>, unread?: string}} [q.site]
 *   the site as read (the tool reads it, through the web fetch and its card)
 * @param {number} [q.now]
 * @returns {Promise<{ok: true, report: object}|{ok: false, error: string}>}
 */
export const readCompanyUpdates = async ({ wallet, laneId, company: asked, since = null, markReported = false, site = null, now = Date.now() }) => {
  const companies = await listCompanies(wallet);
  const company = findCompany(companies, asked);
  if (!company) return { ok: false, error: noCompany(companies, asked) };
  const last = (await loadReportPoints(wallet)).companies[company.id] || null;
  const window = windowOf(since, last, now);
  if (window.error) return { ok: false, error: window.error };
  const roots = await laneReadRoots(laneId);
  const repos = [];
  for (const repo of company.repos) {
    const unread = await unreadReason(repo, roots);
    const head = unread ? null : await headOf(repo.path);
    if (unread || !head) { repos.push({ ...repo, unread: unread || 'it has no commits yet' }); continue; }
    const base = await baseFor(repo.path, { sinceSha: window.useHeads ? last?.heads?.[repo.path] : null, sinceDate: window.since });
    repos.push(await readRepo(repo, base, head));
  }
  if (!company.repos.length) repos.push({ path: null, remote: '(none listed)', role: '', unread: 'this company lists no repos yet — your operator adds them in BRAND KITS → SITE & CODE' });
  const marks = (site?.pages || []).map((p) => ({ url: p.url, mark: pageMark(p.text) }));
  // A page has no history but the report points, so it is always judged
  // against the last report's marks, whatever the window.
  const states = pageStates(last?.pages, marks);
  const siteRead = site && (site.unread ? { unread: site.unread }
    : { pages: states.map((s, i) => ({ ...s, text: safeText(site.pages[i].text, SECTION_CAP).text })), failed: site.failed || [] });
  let marked = null;
  if (markReported) {
    const at = new Date(now).toISOString();
    const heads = { ...(last?.heads || {}), ...Object.fromEntries(repos.filter((r) => r.head).map((r) => [r.path, r.head])) };
    const pages = { ...(last?.pages || {}), ...Object.fromEntries(marks.map((m) => [m.url, m.mark])) };
    await recordReportPoint(wallet, company.id, { at, heads, pages, by: laneId || null });
    marked = at;
  }
  const held = repos.reduce((n, r) => n + (r.held || 0), 0);
  return { ok: true, report: { company, window, repos, site: siteRead, marked, held } };
};

/**
 * One commit's patch from a granted repo of the company, cut to what the
 * walls allow. impure.
 * @param {{wallet: string, laneId: ?string, company: string, commit: string, repo?: ?string}} q
 *   repo — its path, role or folder name, when several repos could hold the commit
 * @returns {Promise<{ok: true, text: string}|{ok: false, error: string}>}
 */
export const readCommitDiff = async ({ wallet, laneId, company: asked, commit, repo: which = null }) => {
  const companies = await listCompanies(wallet);
  const company = findCompany(companies, asked);
  if (!company) return { ok: false, error: noCompany(companies, asked) };
  const roots = await laneReadRoots(laneId);
  const want = String(which ?? '').trim().toLowerCase();
  const candidates = company.repos.filter((r) => !want || r.path === which || r.role.toLowerCase() === want
    || path.basename(r.path || '').toLowerCase() === want);
  const readable = [];
  for (const r of candidates) if (!(await unreadReason(r, roots)) && await isCommit(r.path, commit)) readable.push(r);
  if (!readable.length) return { ok: false, error: `no repo of ${company.name} that you may read holds commit "${commit}"` };
  if (readable.length > 1) return { ok: false, error: `commit "${commit}" is in several of ${company.name}'s repos — name one with repo (${readable.map((r) => r.path).join(', ')})` };
  const [r] = readable;
  const cut = patchForBeing(await commitPatch(r.path, commit), readerFor(r.path));
  const safe = safeText(cut.text, PATCH_CAP);
  return {
    ok: true,
    repo: r,
    withheld: cut.withheld,
    held: safe.held,
    text: safe.text,
  };
};
