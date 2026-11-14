// reply-tier — the TIER of one answer the seated CMO would send under a
// mandate (Design note, 2026-11-11: […]). EASY — thanks, a
// question answered, a pointer, warm words — goes out on its own. AWARENESS
// waits on the operator as an ordinary draft, carrying the reasons it waits.
//
// Both sides are read: what the person said and what the CMO would answer.
// Money on EITHER side is awareness, even when the answer only points to the
// docs (ruling, 2026-11-11: a bare "Exactly." to […]
// agrees to a promise without saying a number). The claims check's open hits
// on the answer count too, so the company's MAY BE ASSERTED list is honoured.
//
// Like the reply categories it is an honest heuristic: it can send a careful
// answer to the operator that did not need them, and it cannot see a claim
// it has no word for. That is why the seat may raise any answer to
// awareness itself — never lower one. Pure.

import { openHits } from '../claims-check.js';

// The reply categories (reply-candidates.js) that always ask, in the
// operator's words. 'support' is a question — easy unless the answer says
// more; 'outreach' is a stranger's post that never replied to the house.
const CATEGORY_WORDS = Object.freeze({
  threat: 'a threat',
  legal: 'legal talk',
  financial: 'a money complaint',
  abuse: 'abuse',
  criticism: 'an argument',
  outreach: 'a post that is not a reply to the house',
});

// Word families read on both sides. Over-reading sends an answer to the
// operator; under-reading sends one out unseen — so the lists lean wide.
const MONEY = /\b(?:fees?|yields?|apr|apy|tvl|liquidity|lps?|stak(?:e|ed|es|ing)|lock(?:ed|ing|s|up)?|unlock\w*|vest\w*|tokenomics|tokens?(?!\s*(?:per\s+second|\/\s*s\b))|mint(?:s|ed|ing)?|referrals?|reward(?:s|ed|ing)?|incentiv\w*|payouts?|paid out|distributions?|dividends?|earn(?:s|ed|ing|ings)?|returns?|profits?|revenue|income|invest\w*|airdrops?|emissions?|supply|burn(?:s|ed)?|treasury|deposits?|withdraw\w*|pric(?:e|es|ed|ing)|refunds?|money|cash|usdc|usdt|usd|eth|btc|sol|crypto\w*|pools?|trad(?:e|es|ed|ing)(?!-offs?))\b|\$\s?\d(?:[\d,.]*\d)?|\b\d+(?:[.,]\d+)?\s?%/gi;
const MIGRATION = /\b(?:migrat\w*|snapshots?|bridg(?:e|es|ed|ing)|relaunch\w*|redeploy\w*|new contract|contract address|v[2-9]|token swap|swap (?:your|their|the|old) tokens?|claim (?:your|their|the) tokens?)\b/gi;
// Read on the answer alone: what the house would be promising.
const PROMISE = /\b(?:we(?:'|’)ll|we will|we(?:'|’)re going to|we are going to|it(?:'|’)ll|it will|you(?:'|’)ll (?:get|see|have|earn)|you will (?:get|see|have|earn)|soon|coming (?:next|up|this|in)|upcoming|shortly|next step|tomorrow|tonight|(?:this|next) (?:week|month|quarter|year|update|release|phase)|by (?:the )?end of|q[1-4]|guarantee\w*|promis\w*|risk[- ]free|no risk|can(?:'|’)?t lose|(?:is|are|stays?|totally|completely|100%) safe)\b/gi;

const wordsOf = (re, text) => [...new Set([...String(text || '').matchAll(re)].map((m) => m[0].trim().toLowerCase()))];

/**
 * The tier of one answer. Pure.
 * @param {{answering?: string, category?: string, text?: string,
 *   hits?: Array<{label: string, match: string, approved: boolean}>, raised?: boolean}} reply
 *   answering — what the person said; category — its reply category;
 *   text — the CMO's answer; hits — the claims check over the answer;
 *   raised — the CMO asked for the operator's eyes itself
 * @returns {{tier: 'easy'|'awareness', reasons: Array<{kind: string, words: string[]}>}}
 */
export const replyTier = ({ answering = '', category = 'ordinary', text = '', hits = [], raised = false } = {}) => {
  const reasons = [];
  if (raised) reasons.push({ kind: 'raised', words: [] });
  if (CATEGORY_WORDS[category]) reasons.push({ kind: 'category', words: [CATEGORY_WORDS[category]] });
  const money = wordsOf(MONEY, `${answering}\n${text}`);
  if (money.length) reasons.push({ kind: 'money', words: money });
  const migration = wordsOf(MIGRATION, `${answering}\n${text}`);
  if (migration.length) reasons.push({ kind: 'migration', words: migration });
  const promise = wordsOf(PROMISE, text);
  if (promise.length) reasons.push({ kind: 'promise', words: promise });
  const claims = openHits(hits).map((h) => `${h.label}: ${h.match}`);
  if (claims.length) reasons.push({ kind: 'claim', words: claims });
  return { tier: reasons.length ? 'awareness' : 'easy', reasons };
};

const REASON_WORDS = Object.freeze({
  raised: () => 'you asked for your operator\'s eyes',
  category: (words) => words[0],
  money: (words) => `money (${words.join(', ')})`,
  migration: (words) => `migration (${words.join(', ')})`,
  promise: (words) => `a promise (${words.join(', ')})`,
  claim: (words) => `a claim to check (${words.join('; ')})`,
});

/** Why an answer waits, in one line. Pure. */
export const tierWords = ({ reasons = [] } = {}) => reasons.map((r) => REASON_WORDS[r.kind]?.(r.words) ?? r.kind).join('; ');

/**
 * A waiting reply as the desk reads it: its tier rides beside the LEGAL flag
 * the claims check put on it (withLegalFlags runs first). Pure.
 * @param {object} entry - a queue entry
 */
export const withReplyTier = (entry) => (entry?.kind === 'reply' && entry.status === 'draft'
  ? { ...entry, tier: replyTier({ answering: entry.reply?.toTextPreview, category: entry.reply?.category, text: entry.text, hits: entry.legal?.hits }) }
  : entry);
