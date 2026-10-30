// The books as the office and the desk read them, for ONE house: each
// company's books with its statement (this year, and all time), its live and
// voided entries, its deadlines; and every receipt the house holds that no
// company has booked yet — the reconciliation the Logista owes.
// impure (store reads); the shaping is pure (books-shape.js).

import { listCompanies } from '../company-line/company-store.js';
import { readBooks, bookedRefs } from './books-store.js';
import { houseReceipts } from './house-receipts.js';
import { statement } from './books-shape.js';

/**
 * @param {string} wallet
 * @param {number} nowMs
 */
export const accountsBoard = async (wallet, nowMs) => {
  const year = new Date(nowMs).toISOString().slice(0, 4);
  const [{ companies }, receipts, booked] = await Promise.all([listCompanies(wallet), houseReceipts(wallet), bookedRefs(wallet)]);
  const books = await Promise.all(companies.map(async (c) => {
    const b = await readBooks(wallet, c.id);
    return {
      id: c.id, name: c.name,
      yearToDate: statement(b.entries, { from: `${year}-01-01`, to: null }),
      allTime: statement(b.entries),
      entries: b.entries.slice(-50), voided: b.voided.length, deadlines: b.deadlines, torn: b.torn,
    };
  }));
  return { year, books, unbooked: receipts.filter((r) => !booked.has(`${r.kind}:${r.ref}`)) };
};
