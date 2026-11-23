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
import { readExternalReceipts, putExtra } from '../money-in/money-in-store.js';
import { claimReceipt } from '../money-in/receipt-consumption.js';
import { addressOfAnotherHouse } from '../money-in/watch-set.js';
import { foldInvoices, invoiceNumber, billedFor, judgePaid, judgePaidByCard, judgeVoid, overdue, unmatchedFor } from './invoice-shape.js';
import { createPayLink, askPaid, closePayLink } from './stripe-pay.js';
import { resolveUsableCredential } from '../oauth-token-broker.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('Invoices');

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
 * The operator's Stripe key, when card payments can be taken right now: the key attached (SETTINGS, API, Payments)
 * AND the CARD PAYMENTS connection switched on. Null otherwise. Never shown to a being.
 */
export const cardKey = async () => (isConnectionOn('card-payments') ? (await resolveUsableCredential('stripe').catch(() => null))?.apiKey ?? null : null);

// impure — the invoice's Stripe link, made and put on its record. The invoice stands whether or not this works.
const attachCardLink = async (wallet, invoice, key) => {
  const made = await createPayLink({ key, invoice });
  if (!made.ok) { log.warn('An invoice got no card link', { invoice: invoice.number, reason: made.reason }); return { ok: false, reason: made.reason }; }
  await serialize(() => appendJsonLine(fileOf(wallet), { type: 'card-link', id: invoice.id, link: made.link, at: new Date().toISOString() }));
  return { ok: true, link: made.link };
};

/**
 * Give an open card invoice its link when it has none yet (Stripe did not answer when it was issued). Asked again,
 * Stripe answers with the same link.
 */
export const retryCardLink = async (wallet, invoiceId) => {
  const invoice = (await readInvoices(wallet)).invoices.find((v) => v.id === invoiceId);
  if (!invoice || invoice.status !== 'open' || !invoice.byCard) return { ok: false, reason: 'no open card invoice by that id' };
  if (invoice.card) return { ok: true, link: invoice.card };
  const key = await cardKey();
  return key ? attachCardLink(wallet, invoice, key) : { ok: false, reason: 'card payments are not set up — attach your Stripe key in SETTINGS, API, Payments and turn CARD PAYMENTS on' };
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
}).then(async (issued) => {
  // A card invoice gets its Stripe link right after it is on record (outside the write chain: it is a network call).
  if (!issued.ok || !issued.invoice.byCard) return issued;
  const key = await cardKey();
  const linked = key ? await attachCardLink(wallet, issued.invoice, key) : { ok: false, reason: 'card payments were switched off before the link was made' };
  return linked.ok ? { ...issued, invoice: { ...issued.invoice, card: linked.link } } : { ...issued, cardProblem: linked.reason };
});

/** Record an invoice paid by a money-in receipt (named by its key). */
export const recordPaid = (wallet, { invoiceId, receiptKey, by, now }) => serialize(async () => {
  const [{ invoices }, receipts] = await Promise.all([readInvoices(wallet), readExternalReceipts(wallet).catch(() => [])]);
  const judged = judgePaid(invoices, { invoiceId, receipt: receipts.find((r) => r.key === String(receiptKey ?? '')) ?? null, by, now });
  if (!judged.ok) return judged;
  const claimed = await claimReceipt(wallet, { kind: 'money-in', ref: judged.event.receipt }, { kind: 'invoice', id: judged.event.id, at: now });
  if (!claimed.ok) return claimed;
  await appendJsonLine(fileOf(wallet), judged.event);
  return { ok: true, invoice: { ...invoices.find((v) => v.id === judged.event.id), status: 'paid' } };
}).then(async (done) => { if (done.ok) await closeCard(done.invoice); return done; });

// impure — an invoice that is no longer open can no longer be paid by card. Never throws; a link that will not close is logged.
const closeCard = async (invoice) => {
  if (!invoice?.card?.id) return;
  const key = await cardKey();
  const closed = key ? await closePayLink({ key, linkId: invoice.card.id }) : { ok: false, reason: 'card payments are off' };
  if (!closed.ok) log.warn('A card link was not closed', { invoice: invoice.number, reason: closed.reason });
};

/**
 * Ask Stripe about every open card invoice of a house, and record the ones it says are paid. The operator is told of
 * each. Nothing is asked while CARD PAYMENTS is off or no key is attached. Never throws.
 * @returns {Promise<{asked: number, paid: string[]}>}
 */
export const settleCardInvoices = async (wallet) => {
  try {
    const key = await cardKey();
    if (!key) return { asked: 0, paid: [] };
    const open = (await readInvoices(wallet)).invoices.filter((v) => v.status === 'open' && v.card?.id);
    const paid = [];
    for (const invoice of open) {
      const asked = await askPaid({ key, invoice });
      if (!asked.ok) { log.warn('Stripe did not say whether an invoice is paid', { invoice: invoice.number, reason: asked.reason }); continue; }
      if (!asked.paid) continue;
      const recorded = await serialize(async () => {
        const judged = judgePaidByCard((await readInvoices(wallet)).invoices, { invoiceId: invoice.id, paid: asked.paid, now: new Date().toISOString() });
        if (judged.ok) await appendJsonLine(fileOf(wallet), judged.event);
        return judged.ok;
      });
      if (!recorded) continue;
      paid.push(invoice.number);
      await notifyOperator({ wallet, kind: KIND.companyLine, standing: STANDING.system, actor: { id: 'invoices', name: 'invoices' }, ref: { invoice: invoice.id },
        title: `${invoice.number} is PAID by card — ${asked.paid.amount} ${asked.paid.currency} from ${invoice.buyer}`.slice(0, 200), detail: `Stripe took the payment${asked.paid.email ? ` from ${asked.paid.email}` : ''}. It is in your Stripe balance; Stripe pays it out to your bank on its own schedule.` }).catch(() => {});
    }
    return { asked: open.length, paid };
  } catch (err) {
    log.warn('The card invoices could not be settled', { error: err.message });
    return { asked: 0, paid: [] };
  }
};

/** Record that an invoice was emailed to its buyer. */
export const recordInvoiceSent = (wallet, { invoiceId, to, messageId, by, now }) => serialize(() =>
  appendJsonLine(fileOf(wallet), { type: 'sent', id: invoiceId, to, messageId: messageId ?? null, by, at: now }));

/** Void an open invoice with why. */
export const voidInvoice = (wallet, { invoiceId, reason, by, now }) => serialize(async () => {
  const { invoices } = await readInvoices(wallet);
  const judged = judgeVoid(invoices, { invoiceId, reason, by, now });
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet), judged.event);
  return { ok: true, invoice: invoices.find((v) => v.id === judged.event.id) };
}).then(async (done) => { if (done.ok) { await closeCard(done.invoice); return { ok: true }; } return done; });

/** The invoices as the TREASURY window reads them: newest first, each open one with the receipts that may be its. */
export const invoiceBoard = async (wallet, nowMs) => {
  const [{ invoices }, payTo, receipts, key] = await Promise.all([readInvoices(wallet), readPayTo(wallet), readExternalReceipts(wallet).catch(() => []), cardKey()]);
  return {
    payTo,
    // Card payments: ready when the operator's Stripe key is attached and the connection is on (the key itself never leaves).
    card: { ready: Boolean(key), on: isConnectionOn('card-payments') },
    invoices: [...invoices].reverse().map((v) => ({
      ...v, overdue: overdue(v, nowMs),
      candidates: v.status === 'open' ? unmatchedFor(v, receipts, invoices).map((r) => ({ key: r.key, amount: r.amount, asset: r.asset, at: r.timestamp })) : [],
    })),
  };
};
