// SEND AN INVOICE TO ITS BUYER — from the house mailbox, on the operator's own press (Design note, 2026-11-21: […]). The email IS the invoice: its lines, its total, when it is
// due, and each way it can be paid — the Stripe link, the crypto address — all printed by the platform from the
// record (invoice-shape.js invoiceText). No page has to be hosted anywhere for the buyer to read it or pay it.
//
// It is the operator who sends: the press is the approval. It is still refused to an address on the do-not-contact
// list, and an email to a lead lands in the same thread as the conversation and is kept on that lead's history.
// impure — the mailbox, the invoice record, the lead ledger.
import { readInvoices, recordInvoiceSent, retryCardLink } from './invoice-store.js';
import { invoiceText } from './invoice-shape.js';
import { resolveEmailCredential } from '../email/email-credentials.js';
import { sendEmail } from '../email/smtp-sender.js';
import { fromFor } from '../email/send-as.js';
import { normalizeEmail } from '../sales/suppress-shape.js';
import { suppressedRecipients, recordSent, threadFor } from '../sales/email-ledger.js';
import { typoOf } from '../sales/address-typo.js';

/** The email an invoice goes out as. pure. */
export const invoiceEmail = (invoice, { greeting = '' } = {}) => ({
  subject: `Invoice ${invoice.number} from ${invoice.company}`,
  text: [greeting.trim() || 'Hello,', '', `Here is invoice ${invoice.number} from ${invoice.company}.`, '', invoiceText(invoice), '', 'Reply to this email with any question about it.', '', invoice.company].join('\n'),
});

/**
 * @param {string} wallet
 * @param {{invoiceId: string, to: unknown, greeting?: string, by: string}} ask
 * @returns {Promise<{ok: true, to: string, messageId: string} | {ok: false, reason: string}>}
 */
export const sendInvoice = async (wallet, { invoiceId, to, greeting = '', by }) => {
  const address = normalizeEmail(to);
  if (!address) return { ok: false, reason: 'to: the buyer\'s email address' };
  const typo = typoOf(address);
  if (typo) return { ok: false, reason: `${address} looks mistyped — did you mean ${typo.meant}?` };
  let invoice = (await readInvoices(wallet)).invoices.find((v) => v.id === invoiceId || v.number === invoiceId);
  if (!invoice) return { ok: false, reason: 'no such invoice in this house' };
  if (invoice.status !== 'open') return { ok: false, reason: `${invoice.number} is ${invoice.status} — only an open invoice is sent` };
  // A card invoice goes out with its link on it: one still without a link asks Stripe again first.
  if (invoice.byCard && !invoice.card) {
    const linked = await retryCardLink(wallet, invoice.id);
    if (!linked.ok && !invoice.payTo) return { ok: false, reason: `${invoice.number} is paid by card and has no payment link yet: ${linked.reason}` };
    invoice = (await readInvoices(wallet)).invoices.find((v) => v.id === invoice.id);
  }
  if ((await suppressedRecipients(wallet, [address])).length) return { ok: false, reason: `${address} is on the do-not-contact list` };
  const credentials = await resolveEmailCredential(wallet).catch(() => null);
  if (!credentials) return { ok: false, reason: 'the house mailbox is not connected — connect it under MAILBOX, then send' };
  const sender = fromFor(credentials, { company: invoice.companyId });
  if (!sender.ok) return { ok: false, reason: sender.detail };
  const email = invoiceEmail(invoice, { greeting });
  const outcome = await sendEmail(credentials, { to: [address], ...email, from: sender.from, references: await threadFor(wallet, [address]) });
  if (!outcome.ok && !outcome.uncertain) return { ok: false, reason: outcome.detail };
  const now = new Date().toISOString();
  await recordInvoiceSent(wallet, { invoiceId: invoice.id, to: address, messageId: outcome.messageId, by, now });
  await recordSent(wallet, { to: [address], subject: email.subject, by, from: outcome.from, messageId: outcome.messageId, uncertain: outcome.uncertain === true });
  return outcome.uncertain ? { ok: false, reason: `${invoice.number} may have been sent to ${address}: the mail server took it and did not confirm. Check your sent mail before sending it again` } : { ok: true, to: address, messageId: outcome.messageId, number: invoice.number };
};
