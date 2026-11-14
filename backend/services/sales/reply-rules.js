// REPLY RULES — the fixed rules that sort mail before any model reads it
// (lead-engine-plan.md §3 step 12: fixed rules first, the model second). A
// bounce notice names the address that failed; a reply that asks to be left
// alone says so in plain words. Neither needs judgement, so neither waits for
// a being: the house stops writing the moment the words arrive. Only the
// reply's own new text is read — quoted history below it is the house's
// words, not theirs.
// PURE.

import { normalizeEmail } from './suppress-shape.js';

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
 * failing those, the known addresses the notice names. pure.
 * @param {string} text the notice's text
 * @param {string[]} known the addresses the house writes to (its leads')
 */
export const bouncedAddresses = (text, known) => {
  const named = [...String(text ?? '').matchAll(RECIPIENT_LINE)].map((m) => normalizeEmail(m[1])).filter(Boolean);
  if (named.length) return [...new Set(named)];
  const body = String(text ?? '').toLowerCase();
  return [...new Set(known.map(normalizeEmail).filter((a) => a && body.includes(a)))];
};

/** The reply's own words: everything above the first quoted line or "On … wrote:". pure. */
export const ownText = (text) => {
  const lines = String(text ?? '').split(/\r?\n/);
  const cut = lines.findIndex((l) => /^\s*>/.test(l) || /^on .+wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*original message/i.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').slice(0, OWN_TEXT_CHARS);
};

/** Does the reply ask the house to stop writing? pure. */
export const asksToStop = (text) => {
  const own = ownText(text);
  // The disclosure line invites a bare "stop": that one word alone is the request.
  return STOP.test(own) || /^\s*stop[.!]?\s*$/i.test(own.split(/\r?\n/).find((l) => l.trim()) ?? '');
};
