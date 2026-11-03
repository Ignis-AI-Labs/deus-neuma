// SANCTIONS SCREENING — the public US list (OFAC's Specially Designated
// Nationals, its primary names and its a.k.a.s), kept on this machine and
// read against the names the house deals with: every buyer of a won deal,
// every investor on a raise. A match is a POSSIBLE match, filed for the CLO
// and the operator to look at — the list is names only, and a name is not a
// person (counsel question 7, docs/legal/COUNSEL_NOTES.md: is a name check
// enough?).
//
// The list is fetched by the "Sanctions list" connection, OFF until the
// operator turns it on (electron/connections.json; Design note, 2026-10-25: once a
// day at most, the two public CSV files, nothing sent but the request. While
// it is off, nothing is screened, and the commerce review says so.
//
// Matching: a name and a listed name match when, folded to upper-case letters
// and digits, they hold the same words in any order ("SMITH, John" and
// "John Smith"). Conservative by design: a flag, never a verdict.
// impure (the fetch and the file); the parse and the match are pure.

import fs from 'fs/promises';
import path from 'path';
import { getDataRoot } from '../data-root.js';
import { isConnectionOn } from '../connections/connection-switches.js';

const SOURCES = Object.freeze({
  sdn: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
  alt: 'https://www.treasury.gov/ofac/downloads/alt.csv',
});
const REFRESH_MS = 24 * 60 * 60 * 1000;
const FETCH_MS = 60_000;
const FILE_MAX_BYTES = 40 * 1024 * 1024;

// The test door: a loopback server standing where treasury.gov stands. Read per call.
const sourceOf = (which) => (process.env.NEUMA_SANCTIONS_ROOT ? `${process.env.NEUMA_SANCTIONS_ROOT}/${which}.csv` : SOURCES[which]);
const dir = () => path.join(getDataRoot(), 'sanctions');

/** One CSV line's fields (quoted fields keep their commas). pure. */
const fields = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
};

/** A name folded to its words: upper-case letters and digits, sorted. pure. */
export const nameKey = (name) => String(name ?? '').toUpperCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');

/**
 * The listed names, from SDN.CSV (ent_num, name, type, program, …) and
 * ALT.CSV (ent_num, alt_num, type, alt_name, …). pure.
 * @returns {Array<{id: string, name: string, program: string, key: string}>}
 */
export const parseSanctions = (sdnText, altText = '') => {
  const programs = new Map();
  const rows = [];
  for (const line of String(sdnText).split(/\r?\n/)) {
    const [id, name, , program] = fields(line);
    if (!/^\d+$/.test(id ?? '') || !name || name === '-0-') continue;
    programs.set(id, program && program !== '-0-' ? program : '');
    rows.push({ id, name, program: programs.get(id), key: nameKey(name) });
  }
  for (const line of String(altText).split(/\r?\n/)) {
    const [id, , , alt] = fields(line);
    if (!/^\d+$/.test(id ?? '') || !alt || alt === '-0-' || !programs.has(id)) continue;
    rows.push({ id, name: alt, program: programs.get(id), key: nameKey(alt) });
  }
  return rows.filter((r) => r.key);
};

/**
 * Screen names against the list. pure.
 * @param {Array<{kind: string, id: string, name: string}>} names - who the house deals with
 * @param {Array<{id: string, name: string, program: string, key: string}>} list
 * @returns {Array<{kind: string, id: string, name: string, listed: {id: string, name: string, program: string}}>}
 */
export const screen = (names, list) => {
  const byKey = new Map();
  for (const r of list) if (!byKey.has(r.key)) byKey.set(r.key, r);
  return names.flatMap((n) => {
    const hit = byKey.get(nameKey(n.name));
    return hit ? [{ ...n, listed: { id: hit.id, name: hit.name, program: hit.program } }] : [];
  });
};

/** The list as kept on this machine, or null when it was never fetched. impure. */
export const readSanctions = async () => {
  try {
    const [sdn, alt, meta] = await Promise.all([
      fs.readFile(path.join(dir(), 'sdn.csv'), 'utf8'),
      fs.readFile(path.join(dir(), 'alt.csv'), 'utf8').catch(() => ''),
      fs.readFile(path.join(dir(), 'fetched.json'), 'utf8').then(JSON.parse),
    ]);
    return { list: parseSanctions(sdn, alt), fetchedAt: meta.fetchedAt };
  } catch {
    return null;
  }
};

// impure — one public file, bounded in time and size.
const fetchText = async (which) => {
  const res = await fetch(sourceOf(which), { signal: AbortSignal.timeout(FETCH_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`${which}.csv answered ${res.status}`);
  const text = await res.text();
  if (text.length > FILE_MAX_BYTES) throw new Error(`${which}.csv is larger than the screen takes`);
  return text;
};

/**
 * Bring the list up to date when the connection is on and the copy is a day
 * old (or missing). Never throws. impure.
 * @returns {Promise<{off?: true, fresh?: true, fetched?: number, error?: string}>}
 */
export const refreshSanctions = async (nowMs = Date.now()) => {
  if (!isConnectionOn('sanctions-list')) return { off: true };
  const kept = await readSanctions();
  if (kept && nowMs - Date.parse(kept.fetchedAt) < REFRESH_MS) return { fresh: true };
  try {
    const [sdn, alt] = await Promise.all([fetchText('sdn'), fetchText('alt')]);
    const list = parseSanctions(sdn, alt);
    if (list.length < 10) throw new Error('the list came back nearly empty — kept the last copy');
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(path.join(dir(), 'sdn.csv'), sdn);
    await fs.writeFile(path.join(dir(), 'alt.csv'), alt);
    await fs.writeFile(path.join(dir(), 'fetched.json'), JSON.stringify({ fetchedAt: new Date(nowMs).toISOString(), names: list.length }));
    return { fetched: list.length };
  } catch (error) {
    return { error: error.message };
  }
};
