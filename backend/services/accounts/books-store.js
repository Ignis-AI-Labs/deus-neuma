// A company's books — `books.jsonl` beside its line in the company's record
// (books-shape.js folds it). A receipt is booked once in the whole house: a
// second booking of the same ref, in any company, is refused — checked under
// the store's write chain so a race books it once.
// impure.

import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { companyPath, listCompanies } from '../company-line/company-store.js';
import { foldBooks } from './books-shape.js';

const serialize = createWriteChain();
const fileOf = (wallet, id) => companyPath(wallet, id, 'books.jsonl');

/** One company's books. @returns {Promise<{entries, voided, deadlines, skipped, torn}>} */
export const readBooks = async (wallet, id) => {
  const { records, torn } = await readJsonLines(fileOf(wallet, id));
  return { ...foldBooks(records), torn };
};

/** Every receipt ref booked in any of the house's companies. */
export const bookedRefs = async (wallet) => {
  const { companies } = await listCompanies(wallet);
  const books = await Promise.all(companies.map((c) => readBooks(wallet, c.id)));
  return new Set(books.flatMap((b) => b.entries).filter((e) => e.receipt.ref).map((e) => `${e.receipt.kind}:${e.receipt.ref}`));
};

/** Book one entry. @returns {Promise<{ok: true, entry} | {ok: false, reason}>} */
export const bookEntry = (wallet, id, entry) => serialize(async () => {
  if (entry.receipt.ref && (await bookedRefs(wallet)).has(`${entry.receipt.kind}:${entry.receipt.ref}`)) {
    return { ok: false, reason: `that ${entry.receipt.kind} receipt is already booked — one receipt, one entry` };
  }
  await appendJsonLine(fileOf(wallet, id), { type: 'booked', entry, at: entry.bookedAt });
  return { ok: true, entry };
});

/** Void a live entry with why. */
export const voidEntry = (wallet, id, entryId, { reason, by, at }) => serialize(async () => {
  if (!(await readBooks(wallet, id)).entries.some((e) => e.id === entryId)) return { ok: false, reason: `no live entry "${entryId}" in these books` };
  await appendJsonLine(fileOf(wallet, id), { type: 'voided', id: entryId, reason, by, at });
  return { ok: true };
});

/** Set a deadline. */
export const setDeadline = (wallet, id, deadline) => serialize(async () => {
  await appendJsonLine(fileOf(wallet, id), { type: 'deadline', deadline, at: deadline.setAt });
  return { ok: true, deadline };
});

/** Mark an open deadline met. */
export const meetDeadline = (wallet, id, deadlineId, { note, by, at }) => serialize(async () => {
  if (!(await readBooks(wallet, id)).deadlines.some((d) => d.id === deadlineId && !d.met)) return { ok: false, reason: `no open deadline "${deadlineId}" in these books` };
  await appendJsonLine(fileOf(wallet, id), { type: 'met', id: deadlineId, note, by, at });
  return { ok: true };
});
