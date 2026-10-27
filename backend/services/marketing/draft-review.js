// draft-review — the claims check run over a house's real drafts, and the
// matters it files with the CLO office (campaign plan §7, slice 12).
//
// Two halves, both per house and never across houses:
//   · the REVIEW (impure, every minute): every draft and approved post of the
//     house is read by claims-check.js against its company's brand kit; a
//     draft with open claims files ONE `campaign-review` matter (area
//     `marketing`, the company named), and so does every reply on the house's
//     record that speaks of legal action (reply-candidates.js category
//     `legal`). The ledger's dedup law keeps a re-read from filing twice; new
//     claims in an edited draft are a new matter. It is a sweep rather than a
//     hook so every road into the queue — a being's draft, the operator's,
//     an edit, a reply — is read the same way. Serious matters raise the
//     office's one alert card (legal-scheduler.js).
//   · the FLAGS (the desk's queue read): the same check, joined to the
//     matter it filed, rides each waiting post as `legal` so the card shows
//     its LEGAL chip at once.
//
// It flags, it never holds (owner default 2026-10-24): nothing here touches
// a post's standing or its approval.

import { houseEntries } from '../social/queue-house.js';
import { loadAccountStore } from '../social/account-store.js';
import { entryAccountId } from '../social/account-shape.js';
import { replyCandidatesOf, categorizeCandidate } from '../social/reply-candidates.js';
import { readKit } from '../branding/kit-store.js';
import { listCompanies } from './companies.js';
import { matterLedgerFor, matterKey } from '../legal/matter-ledger.js';
import { alertOnSeriousMatters } from '../legal/legal-scheduler.js';
import { readServed } from '../house-served.js';
import {
  kitClaimsOf, claimHits, openHits, severityOf, draftMatterId, draftMatter, legalReplyMatter,
} from './claims-check.js';
import { createLogger } from '../logger.js';

const log = createLogger('Marketing.DraftReview');

export const REVIEW_TICK_MS = 60 * 1000;
const REVIEWED = new Set(['draft', 'approved']);

// impure — the house's companies as the check needs them: each account's
// company, each company's name and its kit's claims lists.
const companyContext = async (wallet) => {
  const [store, companies] = await Promise.all([loadAccountStore(wallet), listCompanies(wallet)]);
  const claims = new Map();
  for (const c of companies) {
    const kit = await readKit(c.id, wallet).catch(() => ({ ok: false }));
    claims.set(c.id, kitClaimsOf(kit.ok ? kit.kit : null));
  }
  return {
    companyOf: (accountId) => store.accounts?.[accountId]?.companyId ?? null,
    nameOf: (companyId) => companies.find((c) => c.id === companyId)?.name ?? null,
    claimsOf: (companyId) => claims.get(companyId) || kitClaimsOf(null),
  };
};

// pure — one post read against its company's kit.
const reviewOf = (entry, ctx) => {
  const accountId = entryAccountId(entry);
  const companyId = ctx.companyOf(accountId);
  return { accountId, companyId, hits: claimHits(entry.text, ctx.claimsOf(companyId)) };
};

const isReviewed = (e) => REVIEWED.has(e.status) && !e.placeholder;

/**
 * File the house's new claims matters: every waiting draft with open claims,
 * every reply that speaks of legal action. Only what the ledger does not
 * already hold is ingested. impure — the house's stores, the ledger, a card.
 * @param {string} wallet - the house
 * @returns {Promise<Array<object>>} the matters newly filed
 */
export const reviewHouseDrafts = async (wallet) => {
  const ledger = await matterLedgerFor(wallet);
  const [entries, ctx, filed, replies] = await Promise.all([
    houseEntries(wallet), companyContext(wallet), ledger.load(), replyCandidatesOf(wallet).load(),
  ]);
  const known = new Set(filed.map(matterKey));
  const findings = [];
  for (const entry of entries.filter(isReviewed)) {
    const review = reviewOf(entry, ctx);
    if (!openHits(review.hits).length) continue;
    findings.push(draftMatter({
      entry: { ...entry, accountId: review.accountId }, hits: review.hits,
      companyId: review.companyId, companyName: ctx.nameOf(review.companyId),
    }));
  }
  for (const reply of replies) {
    if ((reply.category || categorizeCandidate(reply.text)) === 'legal') findings.push(legalReplyMatter(reply));
  }
  const fresh = findings.filter((m) => !known.has(matterKey(m)));
  if (!fresh.length) return [];
  const { added } = await ledger.ingest(fresh);
  if (added.length) {
    log.info('claims check filed matters with the legal office', { count: added.length, ids: added.map((m) => m.externalId) });
    await alertOnSeriousMatters(added, wallet);
  }
  return added;
};

/**
 * The house's waiting posts with their LEGAL flag: what the claims check
 * found and the matter it filed (its status), on every post with a hit.
 * impure — the house's stores and ledger.
 * @param {Array<object>} entries - the house's own queue entries
 * @param {string} wallet
 */
export const withLegalFlags = async (entries, wallet) => {
  if (!entries.some(isReviewed)) return entries;
  const [ctx, matters] = await Promise.all([companyContext(wallet), matterLedgerFor(wallet).then((l) => l.load())]);
  const byId = new Map(matters.filter((m) => m.source === 'campaign-review').map((m) => [m.externalId, m]));
  return entries.map((entry) => {
    if (!isReviewed(entry)) return entry;
    const { hits } = reviewOf(entry, ctx);
    if (!hits.length) return entry;
    const open = openHits(hits).length;
    const matter = open ? byId.get(draftMatterId(entry.id, hits)) : null;
    return {
      ...entry,
      legal: { hits, open, severity: severityOf(hits), matter: matter ? { id: matter.id, status: matter.status } : null },
    };
  });
};

// impure — one pass over every house this backend serves; a house's failure
// is logged and never costs another house its review.
const reviewServedHouses = async () => {
  for (const house of (await readServed()).houses) {
    await reviewHouseDrafts(house).catch((err) => log.warn('claims review skipped a house this pass', { error: err.message }));
  }
};

/**
 * Start the claims review heartbeat. impure (timer). Returns the stop handle.
 * @param {{intervalMs?: number}} [opts]
 */
export const startDraftReview = ({ intervalMs = REVIEW_TICK_MS } = {}) => {
  const timer = setInterval(() => {
    reviewServedHouses().catch((err) => log.warn('claims review pass failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
