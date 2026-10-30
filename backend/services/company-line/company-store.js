// THE COMPANY RECORD — each company a house founds, kept in that house:
// `<realm>/<wallet>/company-lines/<id>/company.json` (what it is, opened how and
// by whom) beside `line.jsonl` (the founding line's append-only events,
// line-state.js). Design note, 2026-10-16: two houses on one machine are never
// confused — a company is opened for a WALLET, never for the machine.
//
// THE APPEND LAW: an event lands only if it fits the line as it stands at the
// instant of writing. Every append runs behind the store's write chain,
// re-reads the record, folds it, and checks the fit, so two acts racing for
// the same stage can never both land.
// impure.

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from '../user-realm.js';
import { houseKey } from '../staff/cos-designation.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { createWriteChain } from '../write-chain.js';
import { foldLine, fitsLine } from './line-state.js';

export const MODES = Object.freeze(['field', 'house']);
export const NAME_MAX = 80;
const ID_RE = /^c-[a-z0-9]{6,12}-[a-f0-9]{6}$/;

const companiesDir = (wallet) => {
  const key = houseKey(wallet);
  if (!key) throw new Error('a company needs its house\'s wallet');
  return path.join(walletDir(key), 'company-lines');
};

const companyDir = (wallet, id) => {
  if (!ID_RE.test(String(id))) throw new Error(`no such company id: ${id}`);
  return path.join(companiesDir(wallet), id);
};

/** One file in a company's record — for the stores that sit beside the line (hands-store.js). */
export const companyPath = (wallet, id, file) => path.join(companyDir(wallet, id), file);

/** pure — a company record, or a thrown reason the act turns into a refusal. */
export const makeCompany = ({ name, mode, openedBy, now }) => {
  const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!clean) throw new Error('a company needs a name — a working name is fine');
  if (clean.length > NAME_MAX) throw new Error(`a company name is at most ${NAME_MAX} characters`);
  if (!MODES.includes(mode)) throw new Error(`mode is 'field' (the operator's own field) or 'house' (the house finds the gap)`);
  const stamp = Date.parse(now);
  return Object.freeze({
    id: `c-${stamp.toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
    name: clean,
    mode,
    openedBy,
    openedAt: now,
  });
};

// The store's own chain: line appends run one at a time (write-chain.js).
const serialize = createWriteChain();

/**
 * Open a company: its record, and an empty line standing at SURVEY.
 * @param {string} wallet - the house
 * @param {object} company - makeCompany's
 */
export const openCompany = async (wallet, company) => {
  await writeJsonAtomic(path.join(companyDir(wallet, company.id), 'company.json'), company);
  return company;
};

/**
 * The house's companies, oldest first. A record that cannot be read is
 * skipped and named in `unreadable`, never a failed list.
 * @param {string} wallet
 */
export const listCompanies = async (wallet) => {
  let names;
  try {
    names = await fs.readdir(companiesDir(wallet));
  } catch (err) {
    if (err?.code === 'ENOENT') return { companies: [], unreadable: [] };
    throw err;
  }
  const read = await Promise.all(names.filter((n) => ID_RE.test(n)).map(async (id) => ({ id, company: await readCompany(wallet, id).catch(() => null) })));
  return {
    companies: read.filter((r) => r.company).map((r) => r.company).sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    unreadable: read.filter((r) => !r.company).map((r) => r.id),
  };
};

/**
 * One company's record, or null when the house holds no such company.
 * @param {string} wallet
 * @param {string} id
 */
export const readCompany = async (wallet, id) => {
  if (!ID_RE.test(String(id))) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(companyDir(wallet, id), 'company.json'), 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

/**
 * The company's founding line as it stands, plus any torn record lines.
 * @param {string} wallet
 * @param {string} id
 */
export const readLine = async (wallet, id) => {
  const { records, torn } = await readJsonLines(path.join(companyDir(wallet, id), 'line.jsonl'));
  return { ...foldLine(records), torn };
};

/**
 * Append one event if — and only if — it fits the line at this instant.
 * @param {string} wallet
 * @param {string} id
 * @param {object} event
 * @returns {Promise<{ok: true, line: object} | {ok: false, line: object}>}
 */
export const appendLineEvent = (wallet, id, event) => serialize(async () => {
  const line = await readLine(wallet, id);
  if (!fitsLine(line, event)) return { ok: false, line };
  await appendJsonLine(path.join(companyDir(wallet, id), 'line.jsonl'), event);
  return { ok: true, line: await readLine(wallet, id) };
});
