// Advisory scan — the SOFTWARE layer's dependency watch: every package the
// house ships, queried against the OSV vulnerability database at its exact
// locked version.
//
// OSV (https://osv.dev) aggregates the GitHub Advisory Database, the npm
// advisory feed, and more behind one keyless API. The scan is deterministic:
// a vulnerability published tomorrow for anything in a watched repo's
// package-lock.json is returned by the NEXT run's querybatch — that is the
// […] loop, closed by
// construction rather than by a feed someone remembered to read.
//
// One finding per (advisory id, repo) — the ledger's dedup key — whose
// `affected` names EVERY installed package@version the advisory hits, each
// marked shipped or dev-only (lockfile-inventory.js). A finding whose pairs
// are all dev-only keeps the advisory's own severity and says so in its
// title ("dev-only: …") and its `shipped: false`: the severity is the
// advisory's measured fact, and a lowered copy would be indistinguishable
// from it once in the ledger. On an INSTALLED app dev-only pairs are not
// queried at all — they are not on that machine.
//
// Egress is pinned: one hardcoded host, POST + GET of JSON only, no redirect
// following, a hard timeout. The scanner runs server-side on a schedule —
// it never rides a being's web-tools approval lane.

import fs from 'fs/promises';
import fetch from 'node-fetch';
import { lockfilePackages } from './lockfile-inventory.js';
import { severityOf } from './advisory-severity.js';
import { currentLayout, lockfileTarget } from './app-inventory.js';
import { dependencyPathsFor } from './attack-surface.js';
import { advisoryRemedy } from './osv-remedy.js';
import { isConnectionOn } from '../connections/connection-switches.js';

const OSV_BASE = 'https://api.osv.dev';
const QUERY_CHUNK = 500;
const FETCH_TIMEOUT_MS = 15_000;
const DETAIL_CONCURRENCY = 6;
const ECOSYSTEM = 'npm';
const DEV_ONLY_PREFIX = 'dev-only: ';

// pure — OSV query documents for a package set.
export const osvQueries = (packages) =>
  packages.map(({ name, version }) => ({
    package: { name, ecosystem: ECOSYSTEM },
    version,
  }));

// pure — fixed-size chunks (the API accepts large batches; we stay polite).
export const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * pure — querybatch hits folded to one group per advisory id, its affected
 * list holding every distinct pair the id hit, in first-seen order.
 * @param {Array<{id: string, modified?: string, pair: {name: string, version: string, shipped: boolean}}>} hits
 * @returns {Array<{id: string, modified: string|null, affected: Array<{package: string, version: string, shipped: boolean}>}>}
 */
export const groupByAdvisory = (hits) => {
  const groups = new Map();
  for (const { id, modified, pair } of hits) {
    const group = groups.get(id) || { id, modified: modified || null, affected: [] };
    if (!group.affected.some((a) => a.package === pair.name && a.version === pair.version)) {
      group.affected.push({ package: pair.name, version: pair.version, shipped: pair.shipped });
    }
    groups.set(id, group);
  }
  return [...groups.values()];
};

// pure — "a@1, b@2" for titles.
const pairList = (affected) => affected.map((a) => `${a.package}@${a.version}`).join(', ');

/**
 * pure — one ledger finding from an advisory group and its OSV record (or
 * the reason the record could not be fetched — the id and the affected
 * pairs are still actionable, so the finding stands).
 * @param {string} repoId
 * @param {{id: string, modified: string|null, affected: Array<Object>}} group
 * @param {{vuln?: Object, error?: string}} detail
 * @param {(pair: Object) => string[]} [rootsOf] the direct dependencies that
 *   pull a pair in, for the remedy's "via"
 */
export const findingFor = (repoId, group, { vuln, error }, rootsOf = () => []) => {
  const shipped = group.affected.some((a) => a.shipped);
  const base = vuln && typeof vuln.summary === 'string' && vuln.summary
    ? vuln.summary
    : `${group.id} affects ${pairList(group.affected)}`;
  return {
    layer: 'software',
    source: 'osv',
    repo: repoId,
    externalId: group.id,
    title: shipped ? base : `${DEV_ONLY_PREFIX}${base}`,
    severity: severityOf(vuln || { id: group.id }),
    summary: vuln ? String(vuln.details || '') : `detail fetch failed: ${error}`, // whole — the ledger holds the ceiling
    affected: group.affected,
    shipped,
    publishedAt: (vuln && vuln.published) || group.modified,
    remedy: advisoryRemedy(group, vuln, rootsOf),
  };
};

// pure — a pair's direct dependencies from the lockfile's own graph (the
// remedy's "via electron-builder"); [] when the lock cannot trace it.
export const rootsFromLock = (lock) => (pair) =>
  dependencyPathsFor(lock, pair.package, pair.version).roots.map((root) => root.name);

// impure — one HTTP call with a hard ceiling; OSV is the only host this
// module will ever speak to, and only while the person has the security
// watch's online check turned on (CONNECTIONS, off until turned on).
const osvFetch = async (path, body) => {
  if (!isConnectionOn('security-watch')) throw new Error('the online security check is turned off');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${OSV_BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OSV answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

// impure — one batch of queries → the vuln ids each package is hit by.
export const fetchOsvBatch = (queries) =>
  osvFetch('/v1/querybatch', { queries }).then((json) => json?.results || []);

// impure — the full record for one vuln id, fetched fresh every scan: an
// advisory re-rated or re-worded upstream must reach the ledger re-rated.
export const fetchVulnDetail = (id) => osvFetch(`/v1/vulns/${encodeURIComponent(id)}`);

// impure — the records for many ids, a few in flight at once (a full tree
// hits ~200 ids; one at a time cost minutes, all at once is rude to OSV).
const fetchDetails = async (ids) => {
  const details = new Map();
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      details.set(id, await fetchVulnDetail(id).then((vuln) => ({ vuln }), (err) => ({ error: err.message })));
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, queue.length) }, worker));
  return details;
};

/**
 * impure — the package pairs one watched repo pins, or the plain reason it
 * cannot be read. A watched directory that is gone says THAT, not "no
 * lockfile": the fix is the watch list, not the repo.
 * @param {{path: string, app?: boolean}} repo
 * @param {{appRoot: string, resourcesPath: string|null}} layout
 * @returns {Promise<{packages: Array<Object>, lock: Object|null, lockfile: string, error: string|null}>}
 */
export const readInventory = async (repo, layout) => {
  const { root, lockfile, installed } = lockfileTarget(repo, layout);
  const fail = (error) => ({ packages: [], lock: null, lockfile, error });
  const stat = await fs.stat(root).catch((err) => err);
  if (stat instanceof Error) {
    return fail(stat.code === 'ENOENT' ? `watched path missing: ${root} — moved or deleted, nothing here was scanned` : `watched path unreadable: ${stat.message}`);
  }
  if (!stat.isDirectory()) return fail(`watched path is not a directory: ${root}`);
  let lock;
  try {
    lock = JSON.parse(await fs.readFile(lockfile, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fail(installed
        ? 'this installed app carries no package-lock.json (built before the lockfile shipped) — dependency layer unwatched'
        : 'no package-lock.json — dependency layer unwatched');
    }
    return fail(`lockfile unreadable: ${err.message}`);
  }
  const all = lockfilePackages(lock);
  return { packages: installed ? all.filter((p) => p.shipped) : all, lock, lockfile, error: null };
};

/**
 * Scan one watched repo's lockfile. Never throws — a repo that cannot be
 * read or a network that is down lands as an honest error on the summary,
 * never as a silent "clean".
 *
 * `ok` is the scope's verdict for anything that settles by absence: true
 * ONLY when the lockfile was read and every OSV batch answered, so `hits` is
 * the complete set of advisories that apply today. A hit whose detail record
 * failed still counts (its id is known); a missing path, unreadable lockfile
 * or OSV outage is `ok: false`, and nothing may be closed from that scope.
 *
 * impure — disk + network
 * @param {{id: string, path: string, app?: boolean}} repo
 * @param {{appRoot: string, resourcesPath: string|null}} [layout] the running app's layout (tests pin a temp one)
 * @returns {Promise<{repo: string, ok: boolean, checked: number, hits: Array<Object>, error: string|null, lockfile: string}>}
 */
export const runAdvisoryScan = async (repo, layout = currentLayout()) => {
  const { packages, lock, lockfile, error } = await readInventory(repo, layout);
  if (error) return { repo: repo.id, ok: false, checked: 0, hits: [], error, lockfile };
  // Off is the person's choice, not a failure: nothing is asked, nothing is closed (ok:false keeps
  // the scope open), and the run says the online check is off rather than that OSV is down.
  if (!isConnectionOn('security-watch')) return { repo: repo.id, ok: false, off: true, checked: 0, hits: [], error: null, lockfile };
  const raw = [];
  try {
    for (const batch of chunk(packages, QUERY_CHUNK)) {
      const results = await fetchOsvBatch(osvQueries(batch));
      results.forEach((result, i) => {
        for (const vuln of result?.vulns || []) raw.push({ id: vuln.id, modified: vuln.modified, pair: batch[i] });
      });
    }
  } catch (err) {
    // Partial hits ride along so the ledger still learns them, but the scope
    // is not complete — ok:false keeps absence from reading as "fixed".
    const partial = groupByAdvisory(raw).map((group) => findingFor(repo.id, group, { error: 'OSV went down before the detail fetch' }, rootsFromLock(lock)));
    return { repo: repo.id, ok: false, checked: packages.length, hits: partial, error: `OSV unreachable mid-scan: ${err.message}`, lockfile };
  }
  // Detail rides on HITS only — a clean repo costs no extra calls.
  const groups = groupByAdvisory(raw);
  const details = await fetchDetails(groups.map((g) => g.id));
  const hits = groups.map((group) => findingFor(repo.id, group, details.get(group.id), rootsFromLock(lock)));
  return { repo: repo.id, ok: true, checked: packages.length, hits, error: null, lockfile };
};
