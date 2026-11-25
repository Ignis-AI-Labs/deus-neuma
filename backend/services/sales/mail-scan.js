// THE MAILBOX SCAN — people who wrote to the house and are on no list (Founder,
// 2026-11-16: […]). It reads
// the inbox's ENVELOPES only (who, subject, when; never a body) and leaves
// out everyone already accounted for: a contact on the lead list, an address
// on the do-not-contact list, the house's own addresses, and machines
// (no-reply senders, notifications, receipts). What is left is a person the
// seat has not looked at. The seat reads the message itself, decides what
// kind of lead they are, and files them (sales/inbound); nothing here files
// anyone.
// The sorting is PURE; the read is impure (the mailbox, read-only).

import { normalizeEmail, suppressionMatcher } from './suppress-shape.js';
import { readSuppressions } from './sales-store.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { resolveEmailCredential } from '../email/email-credentials.js';
import { listInbox, SCAN_MAX_MESSAGES } from '../email/imap-reader.js';
import { frameUntrustedContent } from '../untrusted-content.js';

export const SCAN_DEFAULT = 100;
const SHOWN_MAX = 40;
// A machine, not a person: nobody reads a reply to these.
const MACHINE_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|bounces?|notifications?|notify|newsletters?|news|updates?|alerts?|digest|billing|receipts?|invoices?|security|accounts?|team|hello|info|marketing|mailer|automated|system|admin|support)([+.-].*)?$/i;
const MACHINE_DOMAIN = /(^|\.)(facebookmail\.com|linkedin\.com|github\.com|google\.com|googlemail\.com|accounts\.google\.com|stripe\.com|paypal\.com|substack\.com|mailchimp\.com|sendgrid\.net|amazonses\.com|notion\.so|slack\.com|discord\.com|x\.com|twitter\.com)$/i;

/** pure — the address and the name out of a From header ("Jo Smith <jo@x.example>"). */
export const senderOf = (from) => {
  const raw = String(from ?? '');
  const email = normalizeEmail((/<([^>]+)>/.exec(raw)?.[1] ?? raw).trim());
  const name = raw.replace(/<[^>]*>/, '').replace(/["']/g, '').trim();
  return { email, name: name && name.toLowerCase() !== email ? name : '' };
};

/** pure — is this sender a machine (a no-reply address, a notification service)? */
export const isMachine = (email) => {
  const [local, domain] = String(email ?? '').split('@');
  return !domain || MACHINE_LOCAL.test(local) || MACHINE_DOMAIN.test(domain);
};

/**
 * pure — the senders nobody has accounted for, newest first, each with what they wrote.
 * @param {{messages: Array<{uid: number, from: string, subject: string, date: string}>, leads: object[],
 *   suppressed: (email: string) => boolean, own: string[]}} read
 * @returns {{missed: Array<{email: string, name: string, messages: Array<{uid: number, subject: string, date: string}>}>,
 *   counts: {read: number, onList: number, suppressed: number, machines: number, own: number}}}
 */
export const missedSenders = ({ messages, leads, suppressed, own = [] }) => {
  const onList = new Set(leads.map((l) => normalizeEmail(l.contact)).filter(Boolean));
  const mine = new Set(own.map(normalizeEmail).filter(Boolean));
  const counts = { read: messages.length, onList: 0, suppressed: 0, machines: 0, own: 0 };
  const by = new Map();
  for (const m of messages) {
    const { email, name } = senderOf(m.from);
    if (!email) { counts.machines += 1; continue; }
    if (mine.has(email)) { counts.own += 1; continue; }
    if (onList.has(email)) { counts.onList += 1; continue; }
    if (suppressed(email)) { counts.suppressed += 1; continue; }
    if (isMachine(email)) { counts.machines += 1; continue; }
    const row = by.get(email) ?? by.set(email, { email, name, messages: [] }).get(email);
    row.messages.push({ uid: m.uid, subject: String(m.subject ?? '').slice(0, 160), date: m.date });
    if (!row.name && name) row.name = name;
  }
  return { missed: [...by.values()].sort((a, b) => b.messages[0].uid - a.messages[0].uid), counts };
};

/** pure — the scan as the seat reads it. */
export const scanText = ({ missed, counts }) => [
  `Mailbox scan: ${counts.read} message(s) read. ${counts.onList} from people already on the lead list, ${counts.suppressed} from the do-not-contact list, ${counts.machines} from machines, ${counts.own} from the house itself.`,
  ...(missed.length ? [
    `${missed.length} sender(s) are on no list (their names and subjects are written by them):`,
    frameUntrustedContent('email senders on the open internet', missed.slice(0, SHOWN_MAX).map((s) => `- ${s.name ? `${s.name} ` : ''}<${s.email}> — ${s.messages.length} message(s); newest: uid ${s.messages[0].uid} "${s.messages[0].subject}" (${s.messages[0].date})`).join('\n')),
    ...(missed.length > SHOWN_MAX ? [`…and ${missed.length - SHOWN_MAX} more; scan again after filing these.`] : []),
    'For each one: read the message with read_email (its uid). Decide what they are to the house, then file them with sales/inbound (kind: buyer, applicant, partner, investor, press, vendor or other). Someone who is nobody the house needs is left unfiled; someone who must never be written to goes on the do-not-contact list with sales/suppress.',
  ] : ['Nobody new: every sender is already on a list or is a machine.']),
].join('\n');

/**
 * impure — scan one house's mailbox. Read-only: envelopes, never a body.
 * @returns {Promise<{ok: true, missed: object[], counts: object} | {ok: false, detail: string}>}
 */
export const scanMailbox = async (wallet, { limit = SCAN_DEFAULT, signal } = {}) => {
  const credentials = await resolveEmailCredential(wallet).catch(() => null);
  if (!credentials) return { ok: false, detail: 'no mailbox is connected' };
  const inbox = await listInbox(credentials, { limit, max: SCAN_MAX_MESSAGES, signal });
  if (!inbox.ok) return { ok: false, detail: inbox.detail };
  const [leads, suppressions] = await Promise.all([leadLedgerFor(wallet).then((l) => l.load()), readSuppressions(wallet)]);
  const own = [credentials.username, credentials.address, credentials.from, ...String(credentials.sendAs ?? '').split(/[,\s]+/)].filter(Boolean);
  return { ok: true, ...missedSenders({ messages: inbox.messages, leads, suppressed: suppressionMatcher(suppressions).email, own }) };
};
