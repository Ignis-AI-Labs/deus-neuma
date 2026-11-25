// THE REGISTRY INDEX — official company registers, held on this machine and searched by name.
//
// Design note, 2026-11-16: […]
//
// The company index (sales/company-index.js) answers […]. This one
// answers a different question, for the legal seat as much as the sales seat: DOES THIS COMPANY
// EXIST IN LAW, where, under what number, in what standing, since when. One SQLite file beside the
// company index, loaded from registers their keepers publish for anyone to hold:
//   uk-companies   Companies House's free company data product: every live UK company, its
//                  number, status, type, registered address, incorporation date, what it does
//                  (SIC), with a link to its public record.
//   lei            GLEIF's Golden Copy (CC0): every legal entity with a Legal Entity Identifier,
//                  worldwide: legal name, jurisdiction, legal address, standing, creation date.
// What a register says is a fact with a source: every row keeps which register it came from and
// the page that shows it. The shaping is PURE; the database is impure (one file under data/).

import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { getDataRoot } from '../data-root.js';
import { openDatabase } from '../drivers/sqlite-binding.js';
import { records, isoOf, wordTokens } from '../sales/company-index.js';

const BATCH = 20000;
export const REGISTERS = Object.freeze({
  'uk-companies': Object.freeze({ name: 'UK Companies House', credit: 'Companies House (free company data product)' }),
  lei: Object.freeze({ name: 'Global LEI register (GLEIF)', credit: 'GLEIF Golden Copy, CC0' }),
});

/** Where the registry index lives (a test names its own file). */
export const registryPath = () => process.env.NEUMA_REGISTRY_INDEX || path.join(getDataRoot(), 'lead-index', 'registry.sqlite');

const text = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// A register writes a date as 11/09/2012 or 2012-09-11(T…): kept as 2012-09-11, or nothing.
export const isoDate = (v) => {
  const s = String(v ?? '').trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** pure — one row of Companies House's file as a registry row, or null when it has no name or number. */
export const ukRow = (r) => {
  const number = text(r.companynumber, 20);
  const name = text(r.companyname);
  if (!number || !name) return null;
  return {
    source: 'uk-companies', number, name, status: text(r.companystatus, 60), kind: text(r.companycategory, 80), country: 'GB',
    region: text(r['regaddress.county'] || r['regaddress.country'], 80), city: text(r['regaddress.posttown'], 80), postcode: text(r['regaddress.postcode'], 20),
    address: [r['regaddress.addressline1'], r['regaddress.addressline2']].map((v) => text(v, 120)).filter(Boolean).join(', '),
    founded: isoDate(r.incorporationdate), ended: isoDate(r.dissolutiondate), activity: text(r['siccode.sictext_1'], 160),
    url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(number)}`,
  };
};

/** pure — one row of GLEIF's Golden Copy as a registry row, or null when it has no identifier or name. */
export const leiRow = (r) => {
  const number = text(r.lei, 20);
  const name = text(r['entity.legalname']);
  if (!/^[A-Z0-9]{20}$/.test(number) || !name) return null;
  return {
    source: 'lei', number, name, status: text(r['entity.entitystatus'], 60), kind: text(r['entity.legalform.otherlegalform'] || r['entity.legalform.entitylegalformcode'] || r['entity.entitycategory'], 80),
    country: isoOf(r['entity.legaladdress.country']), region: text(r['entity.legaladdress.region'], 80), city: text(r['entity.legaladdress.city'], 80), postcode: text(r['entity.legaladdress.postalcode'], 20),
    address: [r['entity.legaladdress.firstaddressline'], r['entity.legaladdress.additionaladdressline.1']].map((v) => text(v, 120)).filter(Boolean).join(', '),
    founded: isoDate(r['entity.entitycreationdate']), ended: null,
    // the number its own national register gave it, where the entity declared one
    activity: text(r['entity.registrationauthority.registrationauthorityentityid'] ? `registered locally as ${r['entity.registrationauthority.registrationauthorityentityid']}` : '', 160),
    url: `https://search.gleif.org/#/record/${number}`,
  };
};

const SHAPERS = Object.freeze({ 'uk-companies': ukRow, lei: leiRow });

/** pure — one entity as the line a seat reads. */
export const entityLine = (e) => [
  `${e.name} — ${REGISTERS[e.source]?.name ?? e.source} no. ${e.number}`,
  [e.status, e.kind].filter(Boolean).join(', ') || null,
  [e.address, e.city, e.postcode, e.country].filter(Boolean).join(', ') || null,
  e.founded ? `since ${e.founded}` : null, e.ended ? `ended ${e.ended}` : null, e.activity || null, e.url,
].filter(Boolean).join(' — ');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entities (source TEXT NOT NULL, number TEXT NOT NULL, name TEXT NOT NULL, status TEXT, kind TEXT, country TEXT, region TEXT, city TEXT, postcode TEXT, address TEXT, founded TEXT, ended TEXT, activity TEXT, url TEXT, PRIMARY KEY (source, number));
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
  CREATE VIRTUAL TABLE IF NOT EXISTS entity_words USING fts5(name, content='entities', content_rowid='rowid');
`;
let held = null;

/** impure — open the registry index (made on first open when `create`); null when there is none yet. */
export const openRegistry = ({ create = false, file = registryPath() } = {}) => {
  if (held?.file === file && existsSync(file)) return held.db;
  if (!create && !existsSync(file)) return null;
  mkdirSync(path.dirname(file), { recursive: true });
  const db = openDatabase(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  held = { file, db };
  return db;
};
export const closeRegistry = () => { try { held?.db.close?.(); } catch { /* already closed */ } held = null; };

/**
 * impure — load one register's file. Rows already held are replaced by the file's; the name index is rebuilt.
 * @param {'uk-companies'|'lei'} source
 * @returns {Promise<{read: number, kept: number, skipped: number}>}
 */
export const loadRegister = async (source, file, { db = openRegistry({ create: true }), onProgress = () => {} } = {}) => {
  const shape = SHAPERS[source];
  if (!shape) throw new Error(`no such register: ${source} — the registers are: ${Object.keys(SHAPERS).join(', ')}`);
  db.pragma('cache_size = -600000');
  db.pragma('synchronous = OFF');
  const insert = db.prepare('INSERT OR REPLACE INTO entities (source, number, name, status, kind, country, region, city, postcode, address, founded, ended, activity, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const flush = db.transaction((rows) => { for (const r of rows) insert.run(r.source, r.number, r.name, r.status, r.kind, r.country, r.region, r.city, r.postcode, r.address, r.founded, r.ended, r.activity, r.url); });
  let read = 0; let kept = 0; let batch = [];
  for await (const record of records(file)) {
    read += 1;
    const row = shape(record);
    if (row) { batch.push(row); kept += 1; }
    if (batch.length >= BATCH) { flush(batch); batch = []; onProgress({ read, kept }); }
  }
  if (batch.length) flush(batch);
  if (read && !kept) throw new Error(`no row of this file reads as a ${REGISTERS[source].name} record — is it the right file?`);
  db.exec("INSERT INTO entity_words (entity_words) VALUES ('rebuild')");
  db.exec('CREATE INDEX IF NOT EXISTS entities_number ON entities (number)');
  db.pragma('synchronous = NORMAL');
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`${source}:loadedAt`, new Date().toISOString());
  return { read, kept, skipped: read - kept };
};

/**
 * impure — entities by name (every word must be in the name) or by exact number, optionally in one country.
 * @param {{name?: string, number?: string, country?: string, limit?: number}} q
 * @returns {object[]}
 */
export const searchRegistry = ({ name = '', number = '', country = '', limit = 20 } = {}, { db = openRegistry() } = {}) => {
  if (!db) return [];
  const max = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const iso = country ? isoOf(country) : '';
  if (String(number).trim()) return db.prepare(`SELECT * FROM entities WHERE number = ?${iso ? ' AND country = ?' : ''} LIMIT ?`).all(...[String(number).trim().toUpperCase(), ...(iso ? [iso] : []), max]);
  // every word of the asked name, each a whole word of the registered one
  const match = wordTokens(name).map((w) => `"${w}"`).join(' AND ');
  if (!match) return [];
  return db.prepare(`SELECT e.* FROM entities e WHERE e.rowid IN (SELECT rowid FROM entity_words WHERE entity_words MATCH ?)${iso ? ' AND e.country = ?' : ''} ORDER BY length(e.name), e.name COLLATE NOCASE, e.source DESC LIMIT ?`).all(...[match, ...(iso ? [iso] : []), max]);
};

/** impure — what the registry index holds, by register. */
export const registryStats = ({ db = openRegistry() } = {}) => {
  if (!db) return { loaded: false, entities: 0, registers: {} };
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  const counts = Object.fromEntries(db.prepare('SELECT source, count(*) AS n FROM entities GROUP BY source').all().map((r) => [r.source, { entities: r.n, loadedAt: meta[`${r.source}:loadedAt`] ?? null }]));
  const entities = Object.values(counts).reduce((n, c) => n + c.entities, 0);
  return { loaded: entities > 0, entities, registers: counts };
};
