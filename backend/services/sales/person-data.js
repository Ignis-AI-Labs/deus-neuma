// A PERSON'S DATA — everything the house holds on one email address, read whole to hand it to them, and erased when
// they ask (docs/work/crm-match-blob.md, 2026-11-23; GDPR articles 15 and 17, the UK GDPR the same; Blob sells a
// "GDPR data export"). The house's records on people live in its offices (house-office.js): the lead list, the
// outbox, the research, the address checks and lookups, the prospects, the lead runs, the deals and invoices. Every
// one of them is read here line by line, so nothing a store forgot to declare is missed.
//
// ERASED means: every lead at the address is removed (a tombstone names which lead and who removed it, never the
// person), and every record in every office that names the address is dropped. ONE record stays, on purpose: the
// do-not-contact entry, so the house never writes to them again — keeping that is what the law expects of a sender
// (an erased address that is written to again is the worse breach). The mailbox on the mail server is the operator's
// own account and is not touched here; the answer says so.
// Matching is by the address as a whole word: ana@x.example never matches hana@x.example. impure (fs).

import fs from 'node:fs/promises';
import path from 'node:path';
import { walletDir } from '../user-realm.js';
import { houseKey } from '../staff/cos-designation.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { normalizeEmail, makeSuppression, suppressionMatcher } from './suppress-shape.js';
import { addSuppression, readSuppressions } from './sales-store.js';

const OFFICES = Object.freeze(['marketing', 'revenue', 'treasury', 'legal', 'security']);
const LEDGER = 'lead-ledger.json';
const KEPT = new Set(['suppress.jsonl']); // the do-not-contact list: kept, so they are never written to again
const FILE_MAX = 256 * 1024 * 1024;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A test that finds the address as a whole word in any text. pure. */
export const addressPattern = (address) => new RegExp(`(?<![A-Za-z0-9._%+-])${escape(address)}(?![A-Za-z0-9-]|\\.[A-Za-z0-9])`, 'i');

/** One store's text split into the lines that name the address and the rest. pure. */
export const splitLines = (text, named) => {
  const out = { kept: [], named: [] };
  for (const line of String(text).split('\n')) if (line.trim()) (named.test(line) ? out.named : out.kept).push(line);
  return out;
};

const parse = (line) => { try { return JSON.parse(line); } catch { return line; } };

// impure — every store file of the house's offices: {office, name, file}. Only .json and .jsonl, never a folder below.
const storeFiles = async (wallet) => {
  const key = houseKey(wallet);
  if (!key) throw new Error('a house is named by its wallet');
  const found = [];
  for (const office of OFFICES) {
    const dir = path.join(walletDir(key), 'offices', office);
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && /\.jsonl?$/.test(entry.name)) found.push({ office, name: entry.name, file: path.join(dir, entry.name) });
    }
  }
  return found;
};

// impure — one file's text, or null for one too large to read whole (said, never skipped silently).
const readText = async (file) => ((await fs.stat(file)).size > FILE_MAX ? null : fs.readFile(file, 'utf8'));

/**
 * Everything the house holds on one address, store by store. impure.
 * @returns {Promise<{address: string, at: string, held: Array<{office: string, file: string, records: any[]}>, unread: string[], note: string}>}
 */
export const personRecord = async (wallet, given) => {
  const address = normalizeEmail(given);
  if (!address) throw new Error('an email address names the person');
  const named = addressPattern(address);
  const held = [];
  const unread = [];
  for (const { office, name, file } of await storeFiles(wallet)) {
    const text = await readText(file).catch(() => null);
    if (text === null) { unread.push(`${office}/${name}`); continue; }
    if (name.endsWith('.jsonl')) {
      const lines = splitLines(text, named).named;
      if (lines.length) held.push({ office, file: name, records: lines.map(parse) });
    } else if (named.test(text)) {
      const doc = parse(text);
      held.push({ office, file: name, records: Array.isArray(doc) ? doc.filter((r) => named.test(JSON.stringify(r))) : [doc] });
    }
  }
  return {
    address, at: new Date().toISOString(), held, unread,
    note: 'Everything this house keeps on this address, record by record, as it keeps it. Emails in the mailbox itself are on the mail server, in the operator\'s own account.',
  };
};

// impure — rewrite one log without the lines that name the address. A writer that appends between the read and the
// write is not lost: the file is read again just before it is replaced, and the pass starts over when it moved.
const dropLines = async (file, named) => {
  for (let tries = 0; tries < 5; tries += 1) {
    const text = await fs.readFile(file, 'utf8');
    const { kept, named: gone } = splitLines(text, named);
    if (!gone.length) return 0;
    const tmp = `${file}.${process.pid}.erase`;
    await fs.writeFile(tmp, kept.length ? `${kept.join('\n')}\n` : '', { mode: 0o600 });
    if ((await fs.readFile(file, 'utf8')) !== text) { await fs.rm(tmp, { force: true }); continue; }
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600);
    return gone.length;
  }
  throw new Error(`${path.basename(file)} kept changing while it was being erased — nothing in it was changed; try again`);
};

// impure — a JSON list without the records that name the address; a JSON record that is not a list is not edited.
const dropRecords = async (file, named) => {
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!Array.isArray(doc)) return null;
  const kept = doc.filter((r) => !named.test(JSON.stringify(r)));
  if (kept.length === doc.length) return 0;
  const tmp = `${file}.${process.pid}.erase`;
  await fs.writeFile(tmp, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
  return doc.length - kept.length;
};

/**
 * Erase one person from the house: their leads removed (tombstoned), every record naming them dropped, their address
 * kept on the do-not-contact list only. impure.
 * @param {string} wallet @param {string} given - their address
 * @param {{by: string}} who
 * @returns {Promise<{address: string, leads: number, dropped: Array<{file: string, records: number}>, left: string[], suppressed: boolean}>}
 */
export const erasePerson = async (wallet, given, { by }) => {
  const address = normalizeEmail(given);
  if (!address) throw new Error('an email address names the person');
  const named = addressPattern(address);
  // Never written to again: on the list first, so a send racing the erase is refused.
  const already = suppressionMatcher(await readSuppressions(wallet)).email(address);
  if (!already) await addSuppression(wallet, makeSuppression({ target: address, reason: 'asked', note: 'asked to be erased; kept here only so they are never written to again', by, now: new Date().toISOString() }));
  const ledger = await leadLedgerFor(wallet);
  const theirs = (await ledger.load()).filter((l) => named.test(JSON.stringify({ contact: l.contact, touches: (l.touches ?? []).map((t) => t.contactFrom) })));
  for (const lead of theirs) await ledger.remove(lead.id, { by, why: 'erased at their request' });
  const dropped = [];
  const left = [];
  for (const { office, name, file } of await storeFiles(wallet)) {
    if (KEPT.has(name) || name === LEDGER || name.startsWith('lead-removed')) continue;
    const text = await readText(file).catch(() => null);
    if (text === null) { left.push(`${office}/${name} (too large to read whole)`); continue; }
    if (!named.test(text)) continue;
    const n = name.endsWith('.jsonl') ? await dropLines(file, named) : await dropRecords(file, named);
    if (n === null) left.push(`${office}/${name} (one record, not a list: open and edit it by hand)`);
    else if (n) dropped.push({ file: `${office}/${name}`, records: n });
  }
  // Anything still naming them inside the lead list (a lead at another address whose notes name them) is said.
  if (named.test(JSON.stringify(await ledger.load()))) left.push('marketing/lead-ledger.json (another lead\'s notes name them: edit that lead by hand)');
  return { address, leads: theirs.length, dropped, left, suppressed: true };
};
