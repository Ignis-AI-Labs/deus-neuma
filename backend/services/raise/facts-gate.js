// THE FACTS GATE — the last look at every investor-bound message before it
// leaves (docs/planning/proposals/governance/house-company-line.md §8). Anything
// said to an investor that is false or misleading is securities fraud by the
// company and its officers, whoever wrote it; so a message passes only when:
//   - every number in it stands on the counsel-approved facts sheet or in the
//     signed mandate's own terms (years and ISO dates aside) — the house cannot
//     hallucinate a figure into an inbox;
//   - every forward-looking sentence is marked "(forward-looking)";
//   - it holds NO payment detail: the receiving account rides only the
//     {{payment}} placeholder, filled from the signed mandate (no being ever
//     writes an account — the oldest fraud in fundraising is swapped wire details);
//   - it points nowhere the approved sheet does not: no link, email address,
//     ENS name or handle but the data room's and the facts' own sources — a
//     payment page reached by a link is a swapped account all the same (P6-39);
//   - it applies no false urgency (MAKOTO).
// Every problem is named at once. PURE.

import { paymentShapesIn, pointersIn } from '../security/payment-screen.js';

export const PAYMENT_PLACEHOLDER = '{{payment}}';

/** The disclosure line a message MAY carry (Design note, 2026-11-17: no line is forced into any message); figures in it are not counted. */
export const disclosureLine = (companyName) => `We are a team of AI agents building ${companyName}; we work under ${companyName} and its human operator, who reviews and signs everything.`;

const FORWARD = /\b(will|expect(?:s|ed)?|project(?:s|ed|ion)?|forecast(?:s|ed)?|anticipate[sd]?|plan(?:s|ned)? to|aim(?:s|ed)? to|target(?:s|ed)?|on track to)\b/i;
export const URGENCY = /\b(act now|limited time|last chance|only today|before it'?s too late|don'?t miss out|hurry|closing (?:today|tomorrow)|spots? (?:are )?filling|fomo)\b/i;
// pure — the sentences of a text, kept with their own words.
const sentences = (text) => String(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// pure — one written number as a value: 250,000 · $2.5M · 2.5 million · 30% · 1.2k.
const valueOf = (raw, scale) => {
  const n = Number(raw.replace(/,/g, ''));
  const k = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 }[String(scale ?? '').toLowerCase()] ?? 1;
  return n * k;
};

/**
 * Every number a reader would take as a figure, as values — ISO dates and
 * bare years set aside, and a number that is part of a NAME: glued to a word
 * (web3, L2, Qwen3, H100), a standard's number (ERC-20, EIP-1559), a chain's
 * layer (Layer 2) — Design note, 2026-11-17: […] refused an honest email. pure.
 * @param {string} text
 * @returns {number[]}
 */
export const figuresIn = (text) => {
  const bare = String(text).replace(PAYMENT_PLACEHOLDER, '').replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b/g, ' ')
    .replace(/\b[A-Z]{2,}-\d+\b/g, ' ').replace(/\blayer[\s-]?\d\b/gi, ' ');
  return [...bare.matchAll(/(?<![A-Za-z\d.])(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|mm|m|million|bn|b|billion)?\b/gi)]
    .map((m) => ({ raw: m[1].replace(/,+$/, ''), scale: m[2] }))
    .map(({ raw, scale }) => ({ raw, value: valueOf(raw, scale) }))
    .filter(({ raw, value }) => !(/^\d{4}$/.test(raw) && value >= 1990 && value <= 2100))
    .map(({ value }) => value);
};

// pure — the figures a message may carry: the approved sheet's and the mandate's own terms.
const allowedFigures = (sheet, mandate) => new Set([
  ...sheet.facts.filter((f) => f.figure).map((f) => f.figure.value),
  mandate.amount, mandate.minCheck, mandate.valuation.low, mandate.valuation.high,
]);

// pure — the links a message may carry: the approved sheet's data room and its facts' own sources.
const pinnedLinks = (sheet) => [...(sheet.dataRoom ?? []), ...sheet.facts.map((f) => f.source)].filter((v) => /^https:\/\//i.test(String(v ?? '')));

/**
 * Judge one investor-bound message. pure.
 * @param {{subject: string, body: string, sheet: object, mandate: object, companyName: string}} args
 * @returns {{ok: true} | {ok: false, problems: string[]}}
 */
export const checkMessage = ({ subject, body, sheet, mandate, companyName }) => {
  const text = `${subject}\n${body}`;
  const allowed = allowedFigures(sheet, mandate);
  const strays = [...new Set(figuresIn(text.replace(disclosureLine(companyName), '')).filter((v) => !allowed.has(v)))];
  const unmarked = sentences(body).filter((s) => FORWARD.test(s) && !/\(forward-looking\)/i.test(s));
  const own = text.replace(PAYMENT_PLACEHOLDER, '').split(disclosureLine(companyName)).join(' ');
  const payment = paymentShapesIn(text.replace(PAYMENT_PLACEHOLDER, ''));
  const pointers = pointersIn(own, { pinned: pinnedLinks(sheet) });
  const problems = [
    ...strays.map((v) => `${v} is not on the facts sheet counsel approved, nor in the mandate — an investor reads no figure the record does not hold (write dates as 2026-11-12)`),
    ...unmarked.map((s) => `mark this forward-looking sentence "(forward-looking)": "${s.slice(0, 120)}"`),
    ...payment.map((w) => `${w} — no payment detail is ever written by a being; write ${PAYMENT_PLACEHOLDER} and the platform fills the mandate's own`),
    ...pointers.map(({ found, kind }) => `"${found.slice(0, 80)}" is ${kind} the approved facts sheet does not hold — an investor is pointed only to the data room and the sources counsel reviewed`),
    ...(URGENCY.test(text) ? ['no false urgency (MAKOTO) — an investor decides in their own time'] : []),
  ];
  return problems.length ? { ok: false, problems } : { ok: true };
};

/**
 * The payment line the platform writes in place of the placeholder, from the
 * signed mandate's account. pure.
 * @param {{kind: string}} account
 */
export const paymentLine = (account) => {
  if (account.kind === 'wallet') return `Funds are received only at ${account.address} on ${account.network}, and only once the papers are signed.`;
  if (account.kind === 'bank') return `Funds are received only by wire to ${account.accountName} at ${account.bankName} (${account.details}), and only once the papers are signed.`;
  return `Investment is made only through ${account.portal}: ${account.url}`;
};
