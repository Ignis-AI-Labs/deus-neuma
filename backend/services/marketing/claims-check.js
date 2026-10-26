// claims-check — the CLAIMS CHECK every draft passes (campaign plan §7,
// slice 12, approved 2026-10-24): a first-pass read of a post's words for the
// claims a lawyer would ask about, judged against THAT company's brand kit.
//
// It FLAGS, it never holds (owner default 2026-10-24): a hit marks the card
// LEGAL and files a `campaign-review` matter with the CLO office; approval
// stays the operator's, untouched. Like the reply categories, it is an honest
// heuristic — a shape read that counts and marks, never a verdict; the
// verdict is the CLO's, cited.
//
// What it reads for: numbers and benchmark figures, comparisons to a named
// product, "free", superlatives, testimonials, price talk, token or
// investment talk (the house never trades), health and safety claims and
// giveaways — plus anything on the company's NEVER ASSERTED list. A hit that
// sits inside the kit's MAY BE ASSERTED list is shown as approved and filed
// nowhere.
//
// Pure throughout.

import { createHash } from 'crypto';
import { REGULATED_AREAS } from '../legal/regulated-areas.js';

/** The kinds of claim the check reads for, each with what it asks. */
export const CLAIM_KINDS = Object.freeze([
  Object.freeze({ id: 'figure', label: 'a number or benchmark figure', severity: 'medium',
    re: /\b\d+(?:[.,]\d+)?\s*(?:%|x\b|×|times\b|percent\b)|\b(?:scor\w+|benchmark\w*)\b[^.!?\n]{0,40}\d/gi }),
  // Case-sensitive on purpose: a NAMED product starts with a capital.
  Object.freeze({ id: 'comparison', label: 'a comparison to a named product', severity: 'medium',
    re: /\b(?:better|faster|cheaper|smarter|stronger|safer|more \w+|less \w+)\s+than\s+[A-Z][\w+-]*(?:\.[\w+-]+)*|\b(?:[Vv]s\.?|[Vv]ersus|[Uu]nlike|[Bb]eats?|[Oo]utperforms?)\s+[A-Z][\w+-]*(?:\.[\w+-]+)*/g }),
  Object.freeze({ id: 'free', label: '"free"', severity: 'medium', re: /\bfree\b/gi }),
  Object.freeze({ id: 'superlative', label: 'a superlative', severity: 'medium',
    re: /\b(?:best|fastest|cheapest|smartest|safest|number one|world'?s first|first ever|the only|leading|unbeatable|guaranteed?)\b|#\s?1\b/gi }),
  Object.freeze({ id: 'testimonial', label: 'a testimonial or endorsement', severity: 'medium',
    re: /\b(?:testimonials?|(?:customers?|users?|people) (?:love|say)|reviews? say|five[- ]star|5[- ]star|endorsed by|recommended by)\b|[“"][^”"\n]{8,}[”"]\s*[—–-]\s*[A-Z]/g }),
  Object.freeze({ id: 'price', label: 'price talk', severity: 'medium',
    re: /\b(?:price[sd]?|pricing|discount\w*|on sale|\d+\s?% off)\b|\$\s?\d/gi }),
  Object.freeze({ id: 'money', label: 'token or investment talk (the house never trades)', severity: 'high',
    re: /\b(?:invest\w*|returns? on|profit\w*|airdrops?|token (?:sale|launch|drop|price)|crypto\w*|bitcoin|btc|eth|to the moon|passive income)\b/gi }),
  Object.freeze({ id: 'health', label: 'a health or safety claim', severity: 'high',
    re: /\b(?:cures?|heals?|healing|therap\w+|diagnos\w+|medical\w*|clinically|mental health|anxiety|depression|treatment|safe for)\b/gi }),
  Object.freeze({ id: 'giveaway', label: 'a giveaway or contest', severity: 'medium',
    re: /\b(?:giveaways?|give away|win a|prizes?|contests?|sweepstakes|raffles?|enter to win)\b/gi }),
]);

/** The regulated area a claims matter is filed under (regulated-areas.js). */
export const CLAIMS_AREA = REGULATED_AREAS.find((a) => a.id === 'marketing-claims');

const SEVERITY_RANK = Object.freeze({ high: 2, medium: 1 });

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const listOf = (v) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : []);

/**
 * The company's own claims lists from its brand kit (kit-readiness's
 * `claims.approved` / `claims.forbidden`). Pure.
 * @param {object|null} kit
 * @returns {{approved: string[], forbidden: string[]}}
 */
export const kitClaimsOf = (kit) => ({ approved: listOf(kit?.claims?.approved), forbidden: listOf(kit?.claims?.forbidden) });

/**
 * Every claim a post's words make, once each. Pure.
 * @param {string} text
 * @param {{approved: string[], forbidden: string[]}} [claims] - the company's kit lists
 * @returns {Array<{kind: string, label: string, match: string, severity: string, approved: boolean}>}
 */
export const claimHits = (text, claims = { approved: [], forbidden: [] }) => {
  const words = String(text || '');
  const lowered = norm(words);
  const approved = claims.approved.map(norm);
  const seen = new Set();
  const hits = [];
  const push = (hit) => {
    const key = `${hit.kind}|${norm(hit.match)}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };
  for (const claim of claims.forbidden) {
    if (lowered.includes(norm(claim))) {
      push({ kind: 'forbidden', label: 'on the company\'s NEVER ASSERTED list', match: claim, severity: 'high', approved: false });
    }
  }
  for (const kind of CLAIM_KINDS) {
    for (const m of words.matchAll(kind.re)) {
      const match = m[0].trim();
      push({ kind: kind.id, label: kind.label, match, severity: kind.severity, approved: approved.some((a) => a.includes(norm(match))) });
    }
  }
  return hits;
};

/** The hits the office owes a reading on (the approved ones are the kit's word already). Pure. */
export const openHits = (hits) => hits.filter((h) => !h.approved);

/** The most serious open hit's severity, or null. Pure. */
export const severityOf = (hits) => openHits(hits).reduce((top, h) => (
  !top || SEVERITY_RANK[h.severity] > SEVERITY_RANK[top] ? h.severity : top), null);

/** The matter key of one draft's open claims — new claims are a new matter. Pure. */
export const draftMatterId = (entryId, hits) => {
  const print = createHash('sha256').update(openHits(hits).map((h) => `${h.kind}:${norm(h.match)}`).sort().join('|')).digest('hex').slice(0, 12);
  return `draft:${entryId}:${print}`;
};

/**
 * The matter one draft's open claims file with the CLO office. Pure.
 * @param {{entry: {id: string, channelId: string, accountId: string, text: string},
 *   hits: object[], companyId: ?string, companyName: ?string}} draft
 */
export const draftMatter = ({ entry, hits, companyId, companyName }) => {
  const open = openHits(hits);
  return {
    area: 'marketing',
    source: 'campaign-review',
    repo: null,
    ...(companyId ? { companyId } : {}),
    externalId: draftMatterId(entry.id, hits),
    title: `A ${entry.channelId} draft for ${companyName || 'an unsorted account'} makes ${open.length} claim(s) to check`,
    severity: severityOf(hits) || 'medium',
    summary: [
      CLAIMS_AREA.question,
      `Claims found: ${open.map((h) => `${h.label} — "${h.match}"`).join('; ')}.`,
      `The draft (${entry.accountId}): "${String(entry.text || '').slice(0, 600)}"`,
      'The check flags; it does not hold the post. The operator may still approve it.',
    ].join('\n'),
    regimes: CLAIMS_AREA.regimes,
    affected: [`queue entry ${entry.id}`, `account ${entry.accountId}`],
  };
};

/**
 * The matter a reply that speaks of legal action files (reply-candidates.js
 * category `legal`). The words are the replier's own, untrusted. Pure.
 * @param {{postId: string, username?: ?string, text: string, accountId?: ?string}} candidate
 */
export const legalReplyMatter = (candidate) => ({
  area: 'marketing',
  source: 'campaign-review',
  repo: null,
  externalId: `reply:${candidate.postId}`,
  title: `A reply to the house${candidate.username ? ` from @${candidate.username}` : ''} speaks of legal action`,
  severity: 'high',
  summary: [
    'Someone answering the house\'s post spoke of a lawyer, a lawsuit or a court. Read it before anyone answers: is there a claim to answer, and should the house answer at all?',
    `Their own words (untrusted): "${String(candidate.text || '').slice(0, 600)}"`,
  ].join('\n'),
  regimes: CLAIMS_AREA.regimes,
  affected: [`reply ${candidate.postId}`, ...(candidate.accountId ? [`account ${candidate.accountId}`] : [])],
});
