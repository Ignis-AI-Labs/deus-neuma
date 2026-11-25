// THE COMPANY INDEX — the house's own company database, on this machine.
//
// Design note, 2026-11-16: […] And,
// on their list of companies: […]
//
// WHAT THEY DO. They do not search the web when a campaign asks for leads. They LOOK UP a database
// they built beforehand (their own pages: 310M websites, 74M LinkedIn company profiles, 210M maps
// places, 100M+ registry records), so a list of thousands is one query and costs them nothing.
// Founder's own account shows the same: 26 of 29 people they wrote to carry a LinkedIn profile link.
//
// WHAT THIS IS. The same shape from data anyone may hold, kept in one SQLite file:
//   companies   People Data Labs' free company dataset (22M+ companies: name, website, industry,
//               size, founded, locality, country, LinkedIn page; CC BY 4.0, attribution kept in
//               every row's `source`). The operator downloads the file once (their form), and
//               `node scripts/load-company-index.mjs <file>` loads it.
//   traffic     the Tranco list of the million most visited sites (a free research ranking), so
//               a company's site either has a traffic rank or is not among the million: the
//               free answer to "is anybody there".
// A search is words (matched in name, industry and place) plus exact filters (industry, country,
// size, founded, has traffic), most visited first. It never leaves the machine and costs nothing.
// What the index does NOT hold is people: those still come from a company's own pages or a
// provider the operator attached.
//
// The parsing and the query building are PURE; the database is impure (one file under data/).

import { createReadStream, mkdirSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import process from 'node:process';
import { getDataRoot } from '../data-root.js';
import { openDatabase } from '../drivers/sqlite-binding.js';

export const SIZES = Object.freeze(['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+']);
export const INDEX_ATTRIBUTION = 'People Data Labs free company dataset (CC BY 4.0)';
const BATCH = 20000;
const RECORD_MAX = 4000;

/** Where the index lives (a test names its own file). */
export const indexPath = () => process.env.NEUMA_COMPANY_INDEX || path.join(getDataRoot(), 'lead-index', 'companies.sqlite');

// ── pure ────────────────────────────────────────────────────────────────────

/**
 * pure — one CSV line as its cells. A quoted cell may hold commas, and a quote inside it written either way files
 * are found to write it: doubled ("") or after a backslash (\"), which is how the free company file does it.
 */
export const csvCells = (line, sep = ',') => {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '\\' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { cells.push(cell); cell = ''; } else cell += ch;
  }
  cells.push(cell);
  return cells;
};

/** pure — whether a line ends inside a quoted cell (so the record goes on in the next line). A quote after a backslash is text, not an end. */
export const csvOpen = (line) => (line.replace(/\\"/g, '').match(/"/g) ?? []).length % 2 === 1;

const REGIONS = (() => {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const by = new Map();
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      let name;
      try { name = names.of(code); } catch { continue; }
      if (name && name !== code) by.set(name.toLowerCase(), code);
    }
  }
  // The names the dataset writes that differ from the standard ones.
  for (const [name, code] of [['united states', 'US'], ['united kingdom', 'GB'], ['south korea', 'KR'], ['north korea', 'KP'], ['russia', 'RU'], ['czechia', 'CZ'], ['czech republic', 'CZ'], ['turkey', 'TR'], ['türkiye', 'TR'], ['vietnam', 'VN'], ['hong kong', 'HK'], ['macau', 'MO'], ['taiwan', 'TW'], ['iran', 'IR'], ['syria', 'SY'], ['bolivia', 'BO'], ['venezuela', 'VE'], ['tanzania', 'TZ'], ['moldova', 'MD'], ['laos', 'LA'], ['brunei', 'BN'], ['ivory coast', 'CI'], ["côte d'ivoire", 'CI'], ['palestine', 'PS'], ['myanmar', 'MM'], ['burma', 'MM'], ['cape verde', 'CV'], ['swaziland', 'SZ'], ['macedonia', 'MK'], ['north macedonia', 'MK'], ['bosnia and herzegovina', 'BA'], ['trinidad and tobago', 'TT'], ['saint kitts and nevis', 'KN'], ['antigua and barbuda', 'AG'], ['saint vincent and the grenadines', 'VC'], ['democratic republic of the congo', 'CD'], ['republic of the congo', 'CG'], ['the netherlands', 'NL'], ['the bahamas', 'BS'], ['the gambia', 'GM']]) by.set(name, code);
  return by;
})();

/** pure — a country's two-letter code from its name as a dataset writes it, or '' when unknown. */
export const isoOf = (name) => {
  const n = String(name ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(n) ? n.toUpperCase() : REGIONS.get(n) ?? '';
};

const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
/** pure — a company's own domain from what a file calls its website, or null. */
export const domainOf = (website) => {
  const host = String(website ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return HOST.test(host) && host.length <= 120 ? host : null;
};

/**
 * pure — one row of the free company file as an index row, or null when it has no site of its own
 * (a company nobody can read is no candidate).
 * @param {Record<string, string>} r - the file's own columns: country, founded, id, industry, linkedin_url, locality, name, region, size, website
 */
export const companyRow = (r) => {
  const domain = domainOf(r.website);
  const name = String(r.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!domain || !name) return null;
  const founded = parseInt(r.founded, 10);
  return {
    domain, name,
    industry: String(r.industry ?? '').trim().toLowerCase().slice(0, 80),
    size: SIZES.includes(String(r.size ?? '').trim()) ? String(r.size).trim() : '',
    founded: founded >= 1600 && founded <= 2100 ? founded : null,
    locality: String(r.locality ?? '').trim().toLowerCase().slice(0, 80),
    region: String(r.region ?? '').trim().toLowerCase().slice(0, 80),
    country: String(r.country ?? '').trim().toLowerCase().slice(0, 60),
    iso: isoOf(r.country),
    linkedin: String(r.linkedin_url ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').slice(0, 160),
  };
};

/** pure — the distinct words of a search, lowercased (at most twelve). */
export const wordTokens = (words) => [...new Set(String(words ?? '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 12);

/**
 * pure — search words as a full-text query over a company's NAME and INDUSTRY: any of the words, each as a whole
 * word (and its plural or singular); '' when there are none. Whole words, because a prefix made "defi" find
 * "deficit", "definite" and the town of Defiance (found by a seated sales member, 2026-11-16); name and industry
 * only, because a city is what a company is in, never what it is.
 */
export const wordsQuery = (words) => {
  const forms = wordTokens(words).flatMap((w) => [w, w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : `${w}s`]);
  return forms.length ? `{name industry} : (${[...new Set(forms)].map((w) => `"${w}"`).join(' OR ')})` : '';
};

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

/**
 * pure — the search as SQL and its values.
 * @param {{words?: string, industries?: string[], countries?: string[], sizes?: string[], foundedFrom?: number, live?: boolean}} q
 *   countries: two-letter codes · live: only companies whose site is among the million most visited
 */
export const searchSql = (q = {}) => {
  const where = [];
  const values = [];
  const match = wordsQuery(q.words);
  if (match) { where.push('c.rowid IN (SELECT rowid FROM company_words WHERE company_words MATCH ?)'); values.push(match); }
  for (const [column, given, shape] of [['c.industry', list(q.industries), (v) => v.toLowerCase()], ['c.iso', list(q.countries), (v) => v.toUpperCase()], ['c.size', list(q.sizes), (v) => v]]) {
    if (!given.length) continue;
    where.push(`${column} IN (${given.map(() => '?').join(', ')})`);
    values.push(...given.map(shape));
  }
  const from = parseInt(q.foundedFrom, 10);
  if (from) { where.push('c.founded >= ?'); values.push(from); }
  if (q.live) where.push('t.rank IS NOT NULL');
  return {
    sql: `SELECT c.domain, c.name, c.industry, c.size, c.founded, c.locality, c.region, c.country, c.iso, c.linkedin, t.rank FROM companies c LEFT JOIN traffic t ON t.domain = c.domain${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY (t.rank IS NULL), t.rank, c.rowid LIMIT ? OFFSET ?`,
    values,
  };
};

const title = (s) => String(s ?? '').replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/** pure — how busy a site is, in words, from its place among the million most visited (null: not among them). */
export const trafficWords = (rank) => (rank ? `traffic rank ${Number(rank).toLocaleString('en-US')} of the million most visited sites` : 'not among the million most visited sites');

/** pure — an index row as a lead-engine candidate (lead-sources.js's shape, plus what the index knows). */
export const candidateOfCompany = (row) => ({
  source: 'company-index',
  domain: row.domain,
  name: title(row.name).slice(0, 80),
  symbol: null,
  description: '',
  site: `https://${row.domain}`,
  twitter: null,
  telegram: null,
  categories: row.industry ? [row.industry] : [],
  country: row.iso || null,
  size: row.size || null,
  founded: row.founded ?? null,
  trafficRank: row.rank ?? null,
  linkedin: row.linkedin ? `https://${row.linkedin}` : null,
  signal: [row.size ? `${row.size} people` : null, [title(row.locality), row.iso || title(row.country)].filter(Boolean).join(', ') || null, row.founded ? `founded ${row.founded}` : null, trafficWords(row.rank)].filter(Boolean).join(' · '),
  sourceUrl: row.linkedin ? `https://${row.linkedin}` : `https://${row.domain}`,
});

// ── impure: the database ────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS companies (domain TEXT PRIMARY KEY, name TEXT NOT NULL, industry TEXT, size TEXT, founded INTEGER, locality TEXT, region TEXT, country TEXT, iso TEXT, linkedin TEXT);
  CREATE TABLE IF NOT EXISTS traffic (domain TEXT PRIMARY KEY, rank INTEGER NOT NULL) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
  CREATE VIRTUAL TABLE IF NOT EXISTS company_words USING fts5(name, industry, locality, content='companies', content_rowid='rowid');
`;
const INDEXES = `
  CREATE INDEX IF NOT EXISTS companies_iso ON companies (iso);
  CREATE INDEX IF NOT EXISTS companies_industry ON companies (industry);
  CREATE INDEX IF NOT EXISTS companies_size ON companies (size);
`;

// One open handle per file for the life of the process: a search is asked for often.
let held = null;

/** impure — open the index (made on first open when `create`); null when there is none yet. */
export const openIndex = ({ create = false, file = indexPath() } = {}) => {
  if (held?.file === file && existsSync(file)) return held.db;
  if (!create && !existsSync(file)) return null;
  mkdirSync(path.dirname(file), { recursive: true });
  const db = openDatabase(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  held = { file, db };
  return db;
};

/** impure — let the open handle go (a test's cleanup; a loader's end). */
export const closeIndex = () => {
  try { held?.db.close?.(); } catch { /* already closed */ }
  held = null;
};

/** impure — every record of a delimited file, as an object keyed by its header (lowercased, trimmed). */
export async function* records(file, sep = ',') {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let header = null;
  let held = '';
  for await (const raw of lines) {
    const line = held ? `${held}\n${raw}` : raw;
    // A record that runs on is waited for, but never for long: a stray quote must cost one row, not the file
    // (2026-11-16: the first real load stalled on exactly that, holding every later line).
    if (csvOpen(line) && line.length < RECORD_MAX) { held = line; continue; }
    held = '';
    if (!line.trim()) continue;
    const cells = csvCells(line, sep);
    if (!header) { header = cells.map((c) => c.trim().toLowerCase()); continue; }
    yield Object.fromEntries(header.map((key, i) => [key, cells[i] ?? '']));
  }
}

const setMeta = (db, key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

/**
 * impure — load the free company file (CSV, or pipe-delimited when its name ends .psv or .txt). Rows
 * already held are kept as they are replaced by the file's; the word index is rebuilt at the end.
 * @returns {Promise<{read: number, kept: number, skipped: number}>}
 */
export const loadCompanies = async (file, { db = openIndex({ create: true }), onProgress = () => {} } = {}) => {
  // Tens of millions of rows, keyed by site: a large page cache and no wait on the disk for each batch make the
  // difference between minutes and an hour. A load that is cut short is simply run again (rows replace, never double).
  db.pragma('cache_size = -1000000');
  db.pragma('synchronous = OFF');
  const sep = /\.(psv|txt)$/i.test(file) ? '|' : ',';
  const insert = db.prepare('INSERT INTO companies (domain, name, industry, size, founded, locality, region, country, iso, linkedin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET name = excluded.name, industry = excluded.industry, size = excluded.size, founded = excluded.founded, locality = excluded.locality, region = excluded.region, country = excluded.country, iso = excluded.iso, linkedin = excluded.linkedin');
  const flush = db.transaction((rows) => { for (const r of rows) insert.run(r.domain, r.name, r.industry, r.size, r.founded, r.locality, r.region, r.country, r.iso, r.linkedin); });
  let read = 0; let kept = 0; let batch = [];
  for await (const record of records(file, sep)) {
    read += 1;
    const row = companyRow(record);
    if (row) { batch.push(row); kept += 1; }
    if (batch.length >= BATCH) { flush(batch); batch = []; onProgress({ read, kept }); }
  }
  if (batch.length) flush(batch);
  if (read && !kept) throw new Error('no row of this file has a name and a website — it needs the columns name, website, industry, size, founded, locality, region, country, linkedin_url');
  db.exec(INDEXES);
  db.exec("INSERT INTO company_words (company_words) VALUES ('rebuild')");
  db.pragma('synchronous = NORMAL');
  setMeta(db, 'companiesLoadedAt', new Date().toISOString());
  setMeta(db, 'companiesSource', INDEX_ATTRIBUTION);
  return { read, kept, skipped: read - kept };
};

/**
 * impure — load a traffic ranking: one "rank,domain" a line (the Tranco list's own shape), replacing the last one.
 * @returns {Promise<{ranked: number}>}
 */
export const loadTraffic = async (file, { db = openIndex({ create: true }), onProgress = () => {} } = {}) => {
  const insert = db.prepare('INSERT OR REPLACE INTO traffic (domain, rank) VALUES (?, ?)');
  const flush = db.transaction((rows) => { for (const [domain, rank] of rows) insert.run(domain, rank); });
  db.exec('DELETE FROM traffic');
  let ranked = 0; let batch = [];
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    const [rank, site] = line.split(',');
    const domain = domainOf(site);
    const place = parseInt(rank, 10);
    if (!domain || !(place > 0)) continue;
    batch.push([domain, place]);
    ranked += 1;
    if (batch.length >= BATCH) { flush(batch); batch = []; onProgress({ ranked }); }
  }
  if (batch.length) flush(batch);
  if (!ranked) throw new Error('no line of this file reads as "rank,domain"');
  setMeta(db, 'trafficLoadedAt', new Date().toISOString());
  return { ranked };
};

/**
 * impure — companies matching a search, most visited first, leaving out the domains the house already holds.
 * @param {object} query - searchSql's query
 * @param {{count?: number, known?: Set<string>, db?: object}} opts
 * @returns {{rows: object[], looked: number}}
 */
export const searchIndex = (query, { count = 100, known = new Set(), db = openIndex() } = {}) => {
  if (!db) return { rows: [], looked: 0 };
  const { sql, values } = searchSql(query);
  const read = db.prepare(sql);
  const rows = [];
  let looked = 0;
  const page = Math.max(count * 2, 200);
  for (let offset = 0; rows.length < count && offset < page * 25; offset += page) {
    const got = read.all(...values, page, offset);
    looked += got.length;
    for (const row of got) {
      if (rows.length >= count) break;
      if (!known.has(row.domain)) rows.push(row);
    }
    if (got.length < page) break;
  }
  return { rows, looked };
};

/** impure — the traffic rank of each of these domains that has one (a Map; a domain not in it has none). Empty when no ranking is loaded. */
export const trafficOf = (domains, { db = openIndex() } = {}) => {
  const ranks = new Map();
  if (!db || !domains.length) return ranks;
  const read = db.prepare('SELECT rank FROM traffic WHERE domain = ?');
  for (const domain of domains) { const row = read.get(domain); if (row) ranks.set(domain, row.rank); }
  return ranks;
};

/** impure — whether a traffic ranking is loaded at all (so "no rank" can be said to mean "no traffic"). */
export const trafficLoaded = ({ db = openIndex() } = {}) => Boolean(db && db.prepare('SELECT 1 AS ok FROM traffic LIMIT 1').get());

/** impure — what the index holds: how many companies, how many with a traffic rank, when each was loaded. */
export const indexStats = ({ db = openIndex() } = {}) => {
  if (!db) return { loaded: false, companies: 0, ranked: 0, companiesWithTraffic: 0 };
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  const companies = db.prepare('SELECT count(*) AS n FROM companies').get().n;
  return {
    loaded: companies > 0, companies,
    ranked: db.prepare('SELECT count(*) AS n FROM traffic').get().n,
    companiesWithTraffic: db.prepare('SELECT count(*) AS n FROM companies c JOIN traffic t ON t.domain = c.domain').get().n,
    companiesLoadedAt: meta.companiesLoadedAt ?? null, trafficLoadedAt: meta.trafficLoadedAt ?? null, source: meta.companiesSource ?? null,
  };
};

/** impure — the industries the index knows, most companies first (the exact words a search filters on). */
export const industriesOf = ({ db = openIndex(), like = '', limit = 40 } = {}) => (db
  ? db.prepare("SELECT industry, count(*) AS n FROM companies WHERE industry != '' AND industry LIKE ? GROUP BY industry ORDER BY n DESC LIMIT ?").all(`%${String(like).toLowerCase()}%`, limit)
  : []);
