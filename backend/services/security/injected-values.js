// Injected values — the CONCRETE values a planted instruction carries, and
// whether an act's arguments carry one of them (docs/work/injected-value-gate.md,
// 2026-10-26).
//
// AgentDojo, replay 2026-10-26: the full being stated its own rule against
// money-redirects from embedded content and then called send_money with the
// attacker's account in the very next act. Every leak carried a concrete value
// out of the injected block: the attacker's IBAN (4 of 6) or the password it
// planted (2 of 6). Words cannot guarantee refusal; a value can be traced.
//
// The classes, each with the one form it is compared in:
//   iban, account (long account-like / card numbers), wallet (crypto)
//     → ALNUM: upper-case, every space, dash and dot gone ("US13 3000…" = "US133000…")
//   phone → DIGITS: the last ten digits (a country code typed or not)
//   email, secret (a password / passcode / PIN the text sets) → TEXT: lower-case
//   url, domain → URL: lower-case, no scheme, no `www.`, no trailing slash
// An act carries a value when any one string in its arguments, in that form,
// CONTAINS it — so a value spaced, re-cased or wrapped in a sentence still
// counts. Minimum lengths keep short numbers (amounts, ids, dates) out.
// Both sides are read in compatibility form (NFKC), so a value planted in
// full-width or styled letters is the value its plain spelling names.
//
// EVERY READ IS ONE PASS (PR600 audit P6-19): a span is as long as the page
// that planted it, and a pattern that restarts inside a run it has already
// read (`a.a.a.…`, a blank run after "password is") held the whole backend
// for seconds. Addresses and sites are read by scanFrom; trailing marks are
// cut by hand; an act's strings are put in each form once, not once per value.
//
// Every function here is pure.

import { decodedForms } from './decoded-forms.js';

const KEPT = 64;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
const CARD = /\b\d{4}(?:[ -]\d{4}){2,4}\b/g;
const ACCOUNT = /\b[A-Za-z0-9]{8,64}\b/g;
const ETH = /\b0x[a-fA-F0-9]{40}\b/g;
const BTC = /\b(?:bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;
const EMAIL_START = /\b[A-Za-z0-9._%+-]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/y;
const EMAIL_NAME = /[A-Za-z0-9._%+-]+/y;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)\s?|\d{2,4}[\s.-])(?:\d{2,4}[\s.-]){1,3}\d{2,4}\b/g;
const DATE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
const URL = /\bhttps?:\/\/[^\s"'<>()[\]{}]+/gi;
const TLDS = 'com|net|org|io|ai|co|info|biz|xyz|dev|app|me|us|uk|de|fr|ru|cn|in|gov|edu|online|site|top|shop|link|live|tech|cc|tv|ly|to|gg';
const LABELS = '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+';
const DOMAIN_START = /\b[a-z0-9]/gi;
const BARE_DOMAIN = new RegExp(`${LABELS}(?:${TLDS})\\b(?:/[^\\s"'<>()[\\]{}]*)?`, 'iy');
const DOMAIN_LABELS = new RegExp(LABELS, 'iy');
const SECRET = /\b(?:password|passcode|passphrase|pin)\b[^.\n]{0,40}?\b(?:to|is|as)\b\s*(?:[:=]\s*)?["'`]?([^\s"'`,;]{6,64})/gi;
const TRAILING_MARKS = new Set('.,;:!?\'")]');
const MIN = Object.freeze({ alnum: 8, digits: 7, text: 6, url: 4 });

/** The form each class is compared in. */
const FORM_OF = Object.freeze({
  iban: 'alnum', account: 'alnum', wallet: 'alnum', phone: 'digits', email: 'text', secret: 'text', url: 'url', domain: 'url',
});

// pure — a string without the run of `marks` it ends on. By hand: `/[…]+$/` restarts at every mark of
// a long run that is not the end.
const withoutTrailing = (s, marks) => {
  let end = s.length;
  while (end > 0 && marks.has(s[end - 1])) end -= 1;
  return s.slice(0, end);
};
const SLASH = new Set('/');

/** pure — a string in one comparison form. */
export const inForm = (form, raw) => {
  const s = String(raw ?? '').normalize('NFKC');
  if (form === 'alnum') return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (form === 'digits') return s.replace(/\D/g, '').slice(-10);
  const text = withoutTrailing(s.toLowerCase(), TRAILING_MARKS);
  if (form === 'url') return withoutTrailing(text.replace(/https?:\/\//g, '').replace(/(^|[^a-z0-9-])www\./g, '$1'), SLASH);
  return text;
};

// pure — one value of a class, normalised; null when too short to trace.
const value = (kind, raw) => {
  const form = FORM_OF[kind];
  const norm = inForm(form, raw);
  return norm.length >= MIN[form] ? { kind, raw: String(raw).trim(), norm } : null;
};

const all = (re, text) => [...text.matchAll(re)];

// pure — the host of a url-form value.
const hostOf = (norm) => norm.split(/[/?#]/)[0];

// pure — every match of the sticky `whole`, tried only where `start` finds a place to begin, and the
// text with each match blanked. A start that fails skips the run `run` reads from it: every later
// start inside that run would read the same run and fail the same way.
const scanFrom = (text, start, whole, run) => {
  const found = [];
  const rest = [];
  let kept = 0;
  let at = 0;
  while (at < text.length) {
    start.lastIndex = at;
    const begin = start.exec(text);
    if (!begin) break;
    whole.lastIndex = begin.index;
    const hit = whole.exec(text);
    run.lastIndex = begin.index;
    at = begin.index + Math.max(1, (hit ?? run.exec(text))?.[0].length ?? 0);
    if (!hit) continue;
    found.push(hit[0]);
    rest.push(text.slice(kept, begin.index));
    kept = at;
  }
  return { found, rest: [...rest, text.slice(kept)].join(' ') };
};

// pure — the values one form of the text shows plainly, most specific class first.
const plainValuesIn = (t) => {
  // An address's domain is not a link: emailing a stranger at gmail.com must
  // not taint every gmail.com address.
  const { found: emails, rest: outsideEmails } = scanFrom(t, EMAIL_START, EMAIL, EMAIL_NAME);
  const urls = [...all(URL, outsideEmails).map((m) => m[0]), ...scanFrom(outsideEmails.replace(URL, ' '), DOMAIN_START, BARE_DOMAIN, DOMAIN_LABELS).found];
  const accounts = all(ACCOUNT, t).map((m) => m[0]).filter((tok) => (tok.match(/\d/g) || []).length >= 6);
  const phones = all(PHONE, t).map((m) => m[0].trim()).filter((p) => !DATE.test(p) && p.replace(/\D/g, '').length >= 7);
  const found = [
    // Most specific first: a value matched twice keeps its first class.
    ...all(IBAN, t).map((m) => value('iban', m[0])),
    ...all(ETH, t).map((m) => value('wallet', m[0])),
    ...all(BTC, t).map((m) => value('wallet', m[0])),
    ...all(CARD, t).map((m) => value('account', m[0])),
    ...accounts.map((tok) => value('account', tok)),
    ...emails.map((e) => value('email', e)),
    ...phones.map((p) => value('phone', p)),
    ...urls.flatMap((u) => {
      const link = value('url', u);
      return link ? [link, value('domain', hostOf(link.norm))] : [];
    }),
    ...all(SECRET, t).map((m) => value('secret', m[1])),
  ].filter(Boolean);
  return found;
};

/**
 * Every traceable value in a span of planted text — in its plain form and in each encoded run it
 * carries decoded, so a value planted base64- or hex-encoded is traced like a plain one (re-audit
 * 2026-10-29, NEW-L5). Only the first KEPT are kept, and `overflow` says more were there: a plant
 * padded with decoy account numbers must never read as fully traced (the caller fails closed). Pure.
 * @param {string} text
 * @returns {{values: Array<{kind: string, raw: string, norm: string}>, overflow: boolean}} distinct by (form, norm)
 */
export const tracedValues = (text) => {
  const t = String(text || '').normalize('NFKC');
  const found = [t, ...decodedForms(t)].flatMap(plainValuesIn);
  const seen = new Set();
  const distinct = found.filter((v) => {
    const key = `${FORM_OF[v.kind]}\n${v.norm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { values: distinct.slice(0, KEPT), overflow: distinct.length > KEPT };
};

/** The values of tracedValues alone. Pure. */
export const valuesIn = (text) => tracedValues(text).values;

/** pure — every string an act's arguments hold (numbers as written), at any depth. */
export const argStrings = (args, depth = 0) => {
  if (typeof args === 'string') return [args];
  if (typeof args === 'number' || typeof args === 'bigint') return [String(args)];
  if (!args || typeof args !== 'object' || depth > 6) return [];
  return Object.values(args).flatMap((child) => argStrings(child, depth + 1));
};

// pure — a reader over fixed texts: does any of them carry a value? Each text is put in a form once.
const carriedBy = (texts) => {
  const formed = new Map();
  return (v) => {
    const form = FORM_OF[v.kind];
    if (!formed.has(form)) formed.set(form, texts.map((text) => inForm(form, text)));
    return formed.get(form).some((text) => text.includes(v.norm));
  };
};

/**
 * The tainted values an act's arguments carry, minus every value the
 * operator's own words name. NO ARGUMENT IS EXEMPT (PR600 audit P6-18): an
 * argument that quoted the planted instruction beside the value used to pass
 * as […], so a plant that told the being to repeat
 * its words carried its own link out. An act that must name such a record
 * whole is held, and the operator decides. Pure.
 * @param {object} args the act's arguments
 * @param {Array<{kind: string, raw: string, norm: string}>} tainted
 * @param {string[]} operatorLines the operator's own words, line by line
 * @returns {Array<{kind: string, raw: string, norm: string}>}
 */
export const plantedValuesIn = (args, tainted, operatorLines = []) => {
  const inArgs = carriedBy(argStrings(args));
  const inOperatorWords = carriedBy(operatorLines);
  return tainted.filter((v) => inArgs(v) && !inOperatorWords(v));
};
