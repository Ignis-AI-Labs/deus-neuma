// The house's invoices — the Quaestor's record in the house's treasury office
// (`<realm>/<wallet>/offices/treasury/`): `invoices.jsonl`, append-only
// (invoice-shape.js folds it), and `invoice-wallet.json`, where the operator
// says invoices are paid. Setting that wallet also puts it on the money-in
// watch list, so a customer's payment is seen. Numbers are given and bills are
// judged under the store's write chain, so a race issues once.
// impure.

import { ethers } from 'ethers';
import { officeFile } from '../house-office.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { readReceipts, putExtra } from '../money-in/money-in-store.js';
import { addressOfAnotherHouse } from '../money-in/watch-set.js';
import { foldInvoices, invoiceNumber, billedFor, judgePaid, judgeVoid, overdue, unmatchedFor } from './invoice-shape.js';

const serialize = createWriteChain();
const fileOf = (wallet) => officeFile(wallet, 'treasury', 'invoices.jsonl');
const payToFile = (wallet) => officeFile(wallet, 'treasury', 'invoice-wallet.json');

/** The house's invoices, oldest first. */
export const readInvoices = async (wallet) => {
  const { records, torn } = await readJsonLines(fileOf(wallet));
  return { ...foldInvoices(records), torn };
};

/** Where the operator says invoices are paid, or null. */
export const readPayTo = async (wallet) => {
  const doc = await readJson(payToFile(wallet));
  return doc === ABSENT || !doc?.address ? null : doc;
};

/**
 * The operator sets where invoices are paid: an Ethereum address, watched for
 * money in from then on. Never a being's to set.
 * @returns {Promise<{ok: true, payTo: object} | {ok: false, reason: string}>}
 */
export const setPayTo = async (wallet, { address, by, now }) => {
  if (!ethers.isAddress(String(address ?? ''))) return { ok: false, reason: 'address: the Ethereum wallet invoices are paid to (0x…)' };
  if (await addressOfAnotherHouse(wallet, address)) return { ok: false, reason: 'that wallet belongs to another house on this machine — a house is paid only at its own (houses never confused)' };
  const payTo = { address: ethers.getAddress(address), network: 'ethereum', by, setAt: now };
  await writePrivate(payToFile(wallet), payTo);
  await putExtra(wallet, { address: payTo.address, label: 'invoices', member: null, by, at: now });
  return { ok: true, payTo };
};

/**
 * Issue one: `build` makes the invoice from its number and what the deal is
 * already billed (makeInvoice), and may throw its reason.
 * @param {(given: {number: string, billed: (dealId: string) => number}) => object} build
 */
export const issueInvoice = (wallet, build) => serialize(async () => {
  const { invoices } = await readInvoices(wallet);
  let invoice;
  try {
    invoice = build({ number: invoiceNumber(invoices.length), billed: (dealId) => billedFor(invoices, dealId) });
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  await appendJsonLine(fileOf(wallet), { type: 'issued', invoice, at: invoice.issuedAt });
  return { ok: true, invoice };
});

/** Record an invoice paid by a money-in receipt (named by its key). */
export const recordPaid = (wallet, { invoiceId, receiptKey, by, now }) => serialize(async () => {
  const [{ invoices }, receipts] = await Promise.all([readInvoices(wallet), readReceipts(wallet).catch(() => [])]);
  const judged = judgePaid(invoices, { invoiceId, receipt: receipts.find((r) => r.key === String(receiptKey ?? '')) ?? null, by, now });
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet), judged.event);
  return { ok: true, invoice: { ...invoices.find((v) => v.id === judged.event.id), status: 'paid' } };
});

/** Void an open invoice with why. */
export const voidInvoice = (wallet, { invoiceId, reason, by, now }) => serialize(async () => {
  const judged = judgeVoid((await readInvoices(wallet)).invoices, { invoiceId, reason, by, now });
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet), judged.event);
  return { ok: true };
});

/** The invoices as the TREASURY window reads them: newest first, each open one with the receipts that may be its. */
export const invoiceBoard = async (wallet, nowMs) => {
  const [{ invoices }, payTo, receipts] = await Promise.all([readInvoices(wallet), readPayTo(wallet), readReceipts(wallet).catch(() => [])]);
  return {
    payTo,
    invoices: [...invoices].reverse().map((v) => ({
      ...v, overdue: overdue(v, nowMs),
      candidates: v.status === 'open' ? unmatchedFor(v, receipts, invoices).map((r) => ({ key: r.key, amount: r.amount, asset: r.asset, at: r.timestamp })) : [],
    })),
  };
};
