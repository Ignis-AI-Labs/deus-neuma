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
//
// Every function here is pure.

import { decodedForms } from './decoded-forms.js';
import { detectRoguePatterns } from '../rogue-detector.js';

const KEPT = 64;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
const CARD = /\b\d{4}(?:[ -]\d{4}){2,4}\b/g;
const ACCOUNT = /\b[A-Za-z0-9]{8,64}\b/g;
const ETH = /\b0x[a-fA-F0-9]{40}\b/g;
const BTC = /\b(?:bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)\s?|\d{2,4}[\s.-])(?:\d{2,4}[\s.-]){1,3}\d{2,4}\b/g;
const DATE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
const URL = /\bhttps?:\/\/[^\s"'<>()[\]{}]+/gi;
const TLDS = 'com|net|org|io|ai|co|info|biz|xyz|dev|app|me|us|uk|de|fr|ru|cn|in|gov|edu|online|site|top|shop|link|live|tech|cc|tv|ly|to|gg';
const BARE_DOMAIN = new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})\\b(?:/[^\\s"'<>()[\\]{}]*)?`, 'gi');
const SECRET = /\b(?:password|passcode|passphrase|pin)\b[^.\n]{0,40}?\b(?:to|is|as)\b\s*[:=]?\s*["'`]?([^\s"'`,;]{6,64})/gi;
const MIN = Object.freeze({ alnum: 8, digits: 7, text: 6, url: 4 });

/** The form each class is compared in. */
const FORM_OF = Object.freeze({
  iban: 'alnum', account: 'alnum', wallet: 'alnum', phone: 'digits', email: 'text', secret: 'text', url: 'url', domain: 'url',
});

/** pure — a string in one comparison form. */
export const inForm = (form, raw) => {
  const s = String(raw ?? '');
  if (form === 'alnum') return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (form === 'digits') return s.replace(/\D/g, '').slice(-10);
  if (form === 'url') return s.toLowerCase().replace(/[.,;:!?'")\]]+$/, '').replace(/https?:\/\//g, '').replace(/(^|[^a-z0-9-])www\./g, '$1').replace(/\/+$/, '');
  return s.toLowerCase().replace(/[.,;:!?'")\]]+$/, '');
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

// pure — the values one form of the text shows plainly, most specific class first.
const plainValuesIn = (t) => {
  const emails = all(EMAIL, t).map((m) => m[0]);
  // An address's domain is not a link: emailing a stranger at gmail.com must
  // not taint every gmail.com address.
  const outsideEmails = emails.reduce((s, e) => s.split(e).join(' '), t);
  const urls = [...all(URL, outsideEmails).map((m) => m[0]), ...all(BARE_DOMAIN, outsideEmails.replace(URL, ' ')).map((m) => m[0])];
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
 * 2026-10-29, NEW-L5). Pure.
 * @param {string} text
 * @returns {Array<{kind: string, raw: string, norm: string}>} distinct by (kind, norm)
 */
export const valuesIn = (text) => {
  const t = String(text || '');
  const found = [t, ...decodedForms(t)].flatMap(plainValuesIn);
  const seen = new Set();
  return found.filter((v) => {
    const key = `${FORM_OF[v.kind]}\n${v.norm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, KEPT);
};

/** pure — every string an act's arguments hold (numbers as written), at any depth. */
export const argStrings = (args, depth = 0) => {
  if (typeof args === 'string') return [args];
  if (typeof args === 'number' || typeof args === 'bigint') return [String(args)];
  if (!args || typeof args !== 'object' || depth > 6) return [];
  return Object.values(args).flatMap((child) => argStrings(child, depth + 1));
};

/**
 * Does a text CONTAIN this value, in the value's own form? Pure.
 * @param {string} text
 * @param {{kind: string, norm: string}} v
 */
export const carries = (text, v) => inForm(FORM_OF[v.kind], text).includes(v.norm);

/**
 * The tainted values an act's arguments carry, minus every value the
 * operator's own words name, and minus an argument that carries the planted
 * instruction whole (a record named by it). Pure.
 * @param {object} args the act's arguments
 * @param {Array<{kind: string, raw: string, norm: string}>} tainted
 * @param {string[]} operatorLines the operator's own words, line by line
 * @returns {Array<{kind: string, raw: string, norm: string}>}
 */
export const plantedValuesIn = (args, tainted, operatorLines = []) => {
  // CARRIED, NOT OBEYED (bench gaps vs bare, 2026-11-14): an argument that holds the planted
  // instruction itself is a copy of the record it names — AgentDojo's slack channel is NAMED
  // […], and the task
  // […] must name it whole (63 holds in the replay). Obeying
  // the plant means using its value in an act of your own, where the instruction is not.
  const strings = argStrings(args).filter((s) => detectRoguePatterns(s, { toolCallCount: 0 }).safe);
  return tainted.filter((v) => strings.some((s) => carries(s, v))
    && !operatorLines.some((line) => carries(line, v)));
};
