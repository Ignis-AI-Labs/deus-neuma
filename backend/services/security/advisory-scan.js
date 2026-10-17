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
// Egress is pinned: one hardcoded host, POST + GET of JSON only, no redirect
// following, a hard timeout. The scanner runs server-side on a schedule —
// it never rides a being's web-tools approval lane.

import fs from 'fs/promises';
import { join } from 'path';
import fetch from 'node-fetch';

const OSV_BASE = 'https://api.osv.dev';
const QUERY_CHUNK = 500;
const FETCH_TIMEOUT_MS = 15_000;
const ECOSYSTEM = 'npm';

// pure — npm package name from a package-lock `packages` key: everything
// after the LAST node_modules/ (nested deps name themselves; scoped names
// keep both segments).
export const packageNameFromKey = (key) => {
  const at = key.lastIndexOf('node_modules/');
  if (at === -1) return null;
  return key.slice(at + 'node_modules/'.length) || null;
};

// pure — the (name, version) set a lockfile pins, deduplicated. Entries
// without a version (workspace links) carry nothing to query.
export const lockfilePackages = (lockJson) => {
  const packages = lockJson?.packages;
  if (!packages || typeof packages !== 'object') return [];
  const seen = new Map();
  for (const [key, meta] of Object.entries(packages)) {
    const name = packageNameFromKey(key);
    if (!name || typeof meta?.version !== 'string' || !meta.version) continue;
    if (!seen.has(name)) seen.set(name, meta.version);
  }
  return [...seen.entries()].map(([name, version]) => ({ name, version }));
};

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

// pure — OSV's severity vocabulary onto the ledger's.
export const severityOf = (vuln) => {
  const word = String(vuln?.database_specific?.severity || '').toLowerCase();
  if (word === 'moderate') return 'medium';
  return ['critical', 'high', 'medium', 'low'].includes(word) ? word : 'unknown';
};

// impure — one HTTP call with a hard ceiling; OSV is the only host this
// module will ever speak to.
const osvFetch = async (path, body) => {
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

// impure — the full record for one vuln id (summary + severity ride the
// ledger entry; ids alone tell the CSO nothing).
export const fetchVulnDetail = (id) => osvFetch(`/v1/vulns/${encodeURIComponent(id)}`);

/**
 * Scan one watched repo's lockfile. Never throws — a repo that cannot be
 * read or a network that is down lands as an honest error on the summary,
 * never as a silent "clean".
 *
 * impure — disk + network
 * @param {{id: string, path: string}} repo
 * @returns {Promise<{repo: string, checked: number, hits: Array<Object>, error: string|null}>}
 */
export const runAdvisoryScan = async (repo) => {
  let lockRaw;
  try {
    lockRaw = await fs.readFile(join(repo.path, 'package-lock.json'), 'utf8');
  } catch (err) {
    return {
      repo: repo.id, checked: 0, hits: [],
      error: err.code === 'ENOENT' ? 'no package-lock.json — dependency layer unwatched' : `lockfile unreadable: ${err.message}`,
    };
  }
  const packages = lockfilePackages(JSON.parse(lockRaw));
  const hits = [];
  try {
    for (const batch of chunk(osvQueries(packages), QUERY_CHUNK)) {
      const results = await fetchOsvBatch(batch);
      results.forEach((result, i) => {
        for (const vuln of result?.vulns || []) {
          hits.push({
            externalId: vuln.id,
            packageName: batch[i].package.name,
            packageVersion: batch[i].version,
            modified: vuln.modified || null,
          });
        }
      });
    }
  } catch (err) {
    return { repo: repo.id, checked: packages.length, hits, error: `OSV unreachable mid-scan: ${err.message}` };
  }
  // Detail rides on HITS only — a clean repo costs no extra calls.
  const detailed = [];
  for (const hit of hits) {
    try {
      const vuln = await fetchVulnDetail(hit.externalId);
      detailed.push({
        layer: 'software',
        source: 'osv',
        repo: repo.id,
        externalId: hit.externalId,
        title: typeof vuln.summary === 'string' && vuln.summary
          ? vuln.summary
          : `${hit.externalId} affects ${hit.packageName}`,
        severity: severityOf(vuln),
        summary: String(vuln.details || '').slice(0, 2000),
        affected: [{ package: hit.packageName, version: hit.packageVersion }],
        publishedAt: vuln.published || hit.modified,
      });
    } catch (err) {
      // A hit whose detail cannot be fetched still enters the ledger — an id
      // and an affected package is actionable; dropping it would be silence.
      detailed.push({
        layer: 'software',
        source: 'osv',
        repo: repo.id,
        externalId: hit.externalId,
        title: `${hit.externalId} affects ${hit.packageName}@${hit.packageVersion}`,
        severity: 'unknown',
        summary: `detail fetch failed: ${err.message}`,
        affected: [{ package: hit.packageName, version: hit.packageVersion }],
        publishedAt: hit.modified,
      });
    }
  }
  return { repo: repo.id, checked: packages.length, hits: detailed, error: null };
};
