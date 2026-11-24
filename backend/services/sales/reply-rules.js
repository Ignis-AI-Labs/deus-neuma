// REPLY RULES — the fixed rules that sort mail before any model reads it
// (lead-engine-plan.md §3 step 12: fixed rules first, the model second). A
// bounce notice names the address that failed; a reply that asks to be left
// alone says so in plain words. Neither needs judgement, so neither waits for
// a being: the house stops writing the moment the words arrive. Only the
// reply's own new text is read — quoted history below it is the house's
// words, not theirs.
//
// WHO SAYS SO (audit P6-70): a From line and a subject are free to forge, so
// neither closes anyone. The rules act only on PROOF — the message carries the
// Message-ID of an email the house itself sent to that very address (a reply's
// In-Reply-To, a notice's returned headers). Only the person written to, or
// the mail system that failed to reach them, ever saw that id. A notice that
// names more addresses than one email can hold is no notice at all.
// PURE.

import { normalizeEmail } from './suppress-shape.js';
import { personTouches } from '../leads/lead-ledger.js';

/** The most addresses one notice may name: an email goes to at most this many (email/smtp-sender.js SEND_MAX_RECIPIENTS). */
export const BOUNCE_MAX_ADDRESSES = 10;

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;
const BOUNCE_SUBJECT = /undeliver|delivery status notification|delivery (has )?failed|failure notice|returned mail|not delivered|could not be delivered|address not found/i;
const RECIPIENT_LINE = /^(?:final|original)-recipient:\s*rfc822;\s*<?([^\s>;]+)>?/gim;
// Strict on purpose: "not interested" is a no for now, not a request to be
// forgotten — only words that ask the house to stop writing count.
const STOP = /\b(unsubscribe|remove me|take me off|stop (emailing|e-mailing|contacting|messaging|sending)|do not (contact|email|e-mail|write to) me|don'?t (contact|email|e-mail|write to) me( again)?|opt[- ]?out)\b/i;
const OWN_TEXT_CHARS = 1200;

/** Is this message a delivery-failure notice? pure. */
export const isBounce = ({ from, subject }) => BOUNCE_FROM.test(String(from ?? '')) && BOUNCE_SUBJECT.test(String(subject ?? ''));

/**
 * The addresses a bounce says failed: its Final-/Original-Recipient lines, or
 * failing those, the known addresses the notice names — none at all when it
 * names more than one email can hold. pure.
 * @param {string} text the notice's text
 * @param {string[]} known the addresses the house writes to (its leads')
 */
export const bouncedAddresses = (text, known) => {
  const named = [...new Set([...String(text ?? '').matchAll(RECIPIENT_LINE)].map((m) => normalizeEmail(m[1])).filter(Boolean))];
  const body = String(text ?? '').toLowerCase();
  const failed = named.length ? named : [...new Set(known.map(normalizeEmail).filter((a) => a && body.includes(a)))];
  return failed.length > BOUNCE_MAX_ADDRESSES ? [] : failed;
};

/**
 * Of the addresses a message would close, those it PROVES: a lead's address
 * the house wrote to, where the message carries the id of an email sent to it. pure.
 * @param {{addresses: string[], leads: object[], ids: string[]}} m ids: every message id the message carries
 * @returns {string[]}
 */
export const provenAddresses = ({ addresses, leads, ids }) => {
  const carried = new Set(ids ?? []);
  const sentIds = (address) => leads.filter((l) => normalizeEmail(l.contact) === address).flatMap((l) => personTouches(l).filter((t) => t.direction === 'out').map((t) => t.messageId).filter(Boolean));
  return [...new Set(addresses.map(normalizeEmail).filter(Boolean))].filter((address) => sentIds(address).some((id) => carried.has(id)));
};

/** The reply's own words: everything above the first quoted line or "On … wrote:". pure. */
export const ownText = (text, max = OWN_TEXT_CHARS) => {
  const lines = String(text ?? '').split(/\r?\n/);
  const cut = lines.findIndex((l) => /^\s*>/.test(l) || /^on .+wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*original message/i.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').slice(0, max);
};

/** What they wrote, whole, without the email of ours they quoted under it (Design note, 2026-11-19: […]). pure. */
export const THEIR_WORDS_MAX = 6000;
export const theirWords = (text) => ownText(text, THEIR_WORDS_MAX).trim();

/** Does the reply ask the house to stop writing? pure. */
export const asksToStop = (text) => {
  const own = ownText(text);
  // The disclosure line invites a bare "stop": that one word alone is the request.
  return STOP.test(own) || /^\s*stop[.!]?\s*$/i.test(own.split(/\r?\n/).find((l) => l.trim()) ?? '');
};
