// company-watch — what the MARKETING board's COMPANY WATCH panel draws
// (marketing-panel-plan.md §3): one company's `company_updates` read
// (company-updates.js — the CMO's own grants, the sandbox's walls, secret
// lines held back) folded into marks the operator reads at a glance. Newest
// first: each changelog fragment (Added / Changed / Fixed / Removed /
// Security, its first line), each release note, and each commit that carries
// neither — never a commit twice. Each row names its source (repo, commit)
// and, where the repo lives on the web, its address. A repo the CMO may not
// read says why, never "nothing changed" (the claim law).
//
// Pure.

import path from 'path';

export const WATCH_SHOWN = 6;
export const WATCH_DAYS = 30;
const FRAGMENT_KINDS = Object.freeze(['added', 'changed', 'fixed', 'removed', 'security']);
export const WATCH_KINDS = Object.freeze([...FRAGMENT_KINDS, 'release', 'commit']);

// pure — the web address of a commit (or a file at it) when the repo's remote is a web one.
const hrefOf = (remote, sha, file = null) => {
  if (!/^https:\/\/[^\s]+$/.test(String(remote || '')) || !sha) return null;
  const root = remote.replace(/\.git$/, '').replace(/\/$/, '');
  return file ? `${root}/blob/${sha}/${file}` : `${root}/commit/${sha}`;
};

// pure — what a repo is called on a row: its role, else its folder, else its remote.
const repoName = (repo) => repo.role || (repo.path ? path.basename(repo.path) : '') || String(repo.remote || '').replace(/^https:\/\//, '') || 'repo';

// pure — a fragment's kind (its first line) and its first plain-words line.
const fragmentOf = (text) => {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const kind = FRAGMENT_KINDS.find((k) => k === String(lines[0] || '').toLowerCase()) || 'changed';
  const first = lines.find((l) => l.startsWith('- ')) || lines.find((l, i) => i > 0) || lines[0] || '';
  return { kind, line: first.replace(/^-\s+/, ''), more: Math.max(0, lines.filter((l) => l.startsWith('- ')).length - 1) };
};

// pure — a commit subject without its conventional prefix (`feat(x): `).
const subjectLine = (subject) => String(subject || '').replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '');

/**
 * Every row one read repo gives, unsorted. Pure.
 * @param {object} repo - a read repo of company-updates.js readCompanyUpdates
 */
const repoRows = (repo) => {
  const atOf = new Map(repo.commits.map((c) => [c.sha, c.at]));
  const name = repoName(repo);
  const carried = new Set([...repo.fragments.map((f) => f.sha), ...repo.notes.map((n) => n.sha)]);
  return [
    ...repo.fragments.map((f) => ({ ...fragmentOf(f.text), at: atOf.get(f.sha) || null, sha: f.sha, repo: name, file: f.file, href: hrefOf(repo.remote, f.sha) })),
    ...repo.notes.map((n) => ({
      kind: 'release', line: path.basename(n.file).replace(/^release-notes-(.+)\.md$/, 'release $1'), more: 0,
      at: atOf.get(n.sha) || null, sha: n.sha, repo: name, file: n.file, href: hrefOf(repo.remote, n.sha, n.file),
    })),
    ...repo.commits.filter((c) => !carried.has(c.sha)).map((c) => ({
      kind: 'commit', line: subjectLine(c.subject), more: 0, at: c.at, sha: c.sha, repo: name, file: null, href: hrefOf(repo.remote, c.sha),
    })),
  ];
};

/**
 * One company's watch, from its updates read. Pure.
 * @param {{company: object, window: {since: string, why: string}, repos: object[], held: number}} report
 * @param {{shown?: number}} [opts]
 * @returns {{company: {id: string, name: string, site: ?string}, since: string, rows: object[], counts: Record<string, number>,
 *   total: number, commits: number, repos: number, listed: number, unread: Array<{repo: string, why: string}>, held: number}}
 */
export const companyWatch = (report, { shown = WATCH_SHOWN } = {}) => {
  const read = report.repos.filter((r) => !r.unread);
  const rows = read.flatMap(repoRows).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const counts = Object.fromEntries(WATCH_KINDS.map((k) => [k, rows.filter((r) => r.kind === k).length]).filter(([, n]) => n));
  return {
    company: { id: report.company.id, name: report.company.name, site: report.company.site?.url || null },
    since: report.window.since,
    rows: rows.slice(0, shown),
    counts,
    total: rows.length,
    commits: read.reduce((n, r) => n + (r.total || 0), 0),
    repos: read.length,
    listed: (report.company.repos || []).length,
    unread: report.repos.filter((r) => r.unread).map((r) => ({ repo: repoName(r), why: r.unread })),
    held: report.held || 0,
  };
};
