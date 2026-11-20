// THE PAYMENT SCREEN — the words a being writes into a document that asks a
// third party for money (an investor message, an invoice) may never say WHERE
// to pay, nor point anywhere the operator did not pin. Where money goes is the
// operator's own setting, written by the platform. The oldest fraud in billing
// and fundraising is a swapped account beside the real one, and it needs no
// account number at all: a payment page's link, a wallet's ENS name or a
// handle to […] does the same work (audit P6-39, P6-40).
// Two readings, both PURE: payment shapes (accounts) and pointers (links,
// email addresses, ENS names, handles).

const ACCOUNT_SHAPES = Object.freeze([
  [/0x[0-9a-fA-F]{40}/, 'a wallet address'],
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/, 'an IBAN'],
  [/\b(routing|account|acct|swift|bic|iban|aba)\s*(number|no\.?|#|code)?\s*[:#]?\s*[A-Z0-9-]{6,}/i, 'bank details'],
]);
const LONE_NUMBER = Object.freeze([/\b\d{8,}\b/, 'a long number that reads like an account']);
// An invoice honestly carries long numbers (an order, a purchase order, a licence): there a long
// number is an account only when a banking word stands within a few words of it, on either side.
const BANK_WORD = '(?:bank|account|acct|routing|sort[\\s-]?code|iban|swift|bic|aba)';
const NUMBER_BY_BANK_WORD = Object.freeze([
  new RegExp(`\\b${BANK_WORD}\\b[^\\n]{0,40}?\\b\\d{8,}\\b|\\b\\d{8,}\\b[^\\n]{0,40}?\\b${BANK_WORD}\\b`, 'i'),
  'a long number beside banking words',
]);

// One pass, first reading wins: a web address · an email address · a bare
// domain (an ENS name is one) · a handle. Every alternative starts only where
// a word starts, so a long unbroken run of text is read once, not once per character.
const POINTER = /(?:https?:\/\/|www\.)[^\s<>"']+|(?<![^\s<>"'(])[^\s@<>"'(]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+|(?<![\w@.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?|(?<![\w.])@[a-z0-9_]{2,}/gi;

const trimmed = (found) => found.replace(/[.,;:!?)\]]+$/, '');
const bare = (link) => trimmed(String(link)).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

// pure — what kind of pointer this is, in the words a refusal uses.
const kindOf = (found) => {
  if (/^(?:https?:\/\/|www\.)/i.test(found)) return 'a link';
  if (found.startsWith('@')) return 'a handle';
  if (found.includes('@')) return 'an email address';
  return /\.eth(?:\/|$)/i.test(found) ? 'an ENS name' : 'a web address';
};

/**
 * The payment details a text carries, each named once. pure.
 * @param {string} text
 * @param {{loneNumbers?: boolean}} [options] loneNumbers false (an invoice): a long number counts
 *   only beside a banking word
 * @returns {string[]} e.g. ['a wallet address', 'bank details']
 */
export const paymentShapesIn = (text, { loneNumbers = true } = {}) => [...ACCOUNT_SHAPES, loneNumbers ? LONE_NUMBER : NUMBER_BY_BANK_WORD]
  .filter(([shape]) => shape.test(String(text ?? ''))).map(([, words]) => words);

/**
 * The pointers a text carries that nobody pinned: links, email addresses, bare
 * domains, ENS names and handles. A pinned link passes exactly as pinned, with
 * or without its scheme. pure.
 * @param {string} text
 * @param {{pinned?: string[], bareDomains?: boolean}} [options] pinned: the links the operator (or
 *   counsel) already approved. bareDomains false (an invoice): a domain NAMED and nothing more
 *   ("Hosting for acme.com") passes; one with a path, a scheme or www is a link and an ENS name is
 *   a wallet — both are still found
 * @returns {Array<{found: string, kind: string}>} each once, as written
 */
export const pointersIn = (text, { pinned = [], bareDomains = true } = {}) => {
  const allowed = new Set(pinned.map(bare).filter(Boolean));
  const seen = new Set();
  return [...String(text ?? '').matchAll(POINTER)].map((m) => trimmed(m[0]))
    .filter((found) => found && !allowed.has(bare(found)) && !seen.has(found.toLowerCase()) && seen.add(found.toLowerCase()))
    .map((found) => ({ found, kind: kindOf(found) }))
    .filter(({ found, kind }) => bareDomains || kind !== 'a web address' || found.includes('/'));
};
