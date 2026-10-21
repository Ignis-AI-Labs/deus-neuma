// Build watch — […] (ruling, 2026-10-01).
// Every watched repo's commits since the last watch are read (subject +
// changed paths) and matched against the regulated areas; each area the new
// work touches becomes ONE matter for this run, naming the commits and the
// paths that put it there. The Praetor reads the work and settles what law
// reaches it.
//
// Noise law: the house's own record-keeping (work ledgers, test shots, the
// tests themselves, lockfiles) is not what we BUILD — those paths never
// count. A commit that touches only them touches no area.
//
// Read-only by law: `git log` in the repo, nothing written.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { areasOfCommit } from './regulated-areas.js';

const run = promisify(execFile);

const FIRST_LOOK_DAYS = 14; // a fresh office reads the last two weeks
const COMMITS_MAX = 400;
const AFFECTED_MAX = 40;
const RS = '\x1e';
const US = '\x1f';

const NOT_BUILT = [
  /^docs\/work\//, /^test\//, /(^|\/)__tests__\//, /\.(test|spec)\.[cm]?[jt]sx?$/, /^test-results\//,
  /\.(png|jpe?g|webp|gif|wav|mp3|ogg)$/i, /(^|\/)package-lock\.json$/, /^WORK_LEDGER\.md$/, /^TODO\.md$/,
];
const built = (path) => !NOT_BUILT.some((re) => re.test(path));

// pure — `git log` output → commits.
export const parseLog = (stdout) => stdout.split(RS).map((block) => block.trim()).filter(Boolean).map((block) => {
  const [head, ...rest] = block.split('\n');
  const [sha, at, author, subject] = head.split(US);
  return { sha, at, author, subject: subject || '', files: rest.map((l) => l.trim()).filter(Boolean) };
});

/**
 * pure — commits → one matter per touched area.
 * @param {{id: string}} repo
 * @param {Array<{sha: string, at: string, subject: string, files: string[]}>} commits newest first
 */
export const buildMatters = (repo, commits) => {
  const byArea = new Map();
  for (const commit of commits) {
    const files = commit.files.filter(built);
    if (!files.length) continue;
    for (const hit of areasOfCommit({ subject: commit.subject, files })) {
      const slot = byArea.get(hit.area.id) || { area: hit.area, commits: [] };
      slot.commits.push({ commit, paths: hit.paths, word: hit.word });
      byArea.set(hit.area.id, slot);
    }
  }
  return [...byArea.values()].map(({ area, commits: hits }) => {
    const newest = hits[0].commit;
    const paths = [...new Set(hits.flatMap((h) => h.paths))];
    return {
      area: 'product', source: 'build-watch', repo: repo.id,
      externalId: `build:${area.id}@${newest.sha.slice(0, 12)}`,
      title: `New work touches ${area.name.toLowerCase()} — ${hits.length} commit(s) in ${repo.id}`,
      severity: area.severity,
      summary: [
        area.question,
        `Where to start reading: ${area.regimes.join('; ')}.`,
        `Paths: ${paths.slice(0, 15).join(', ')}${paths.length > 15 ? ` (+${paths.length - 15} more)` : ''}`,
      ].join('\n'),
      regimes: area.regimes,
      affected: hits.slice(0, AFFECTED_MAX).map((h) => `${h.commit.sha.slice(0, 9)} ${h.commit.at.slice(0, 10)} ${h.commit.subject.slice(0, 140)}`),
    };
  });
};

/**
 * impure — read a repo's commits since `since` (ISO) and match them.
 * @param {{id: string, path: string}} repo
 * @param {{since?: string|null, now?: number}} [opts]
 * @returns {Promise<{repo: string, commits: number, since: string, matters: Array<Object>, error: string|null}>}
 */
export const runBuildWatch = async (repo, { since = null, now = Date.now() } = {}) => {
  const from = since || new Date(now - FIRST_LOOK_DAYS * 86400000).toISOString();
  try {
    const { stdout } = await run('git', [
      'log', `--since=${from}`, '--no-merges', `--max-count=${COMMITS_MAX}`, '--name-only',
      `--format=${RS}%H${US}%cI${US}%an${US}%s`,
    ], { cwd: repo.path, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
    const commits = parseLog(stdout);
    return { repo: repo.id, commits: commits.length, since: from, matters: buildMatters(repo, commits), error: null };
  } catch (err) {
    return { repo: repo.id, commits: 0, since: from, matters: [], error: `git log failed: ${err.message.split('\n')[0]}` };
  }
};
