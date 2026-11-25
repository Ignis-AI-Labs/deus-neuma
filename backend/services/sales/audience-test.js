// THE AUDIENCE TEST — an audience checked against companies its operator already knows are right for it, before it
// is trusted with a search.
//
// Found on the sales bench (2026-11-22): an audience for funds that back AI kept rejecting real AI funds, run after
// run, because its first sign named four narrow things ([…]) and a fund that simply […] showed none of them. Nothing told the operator:
// the runs just came back thin. Founder: […]
// The fundamental problem is that an audience is only words until it meets a company. So the operator (or the sales
// seat) names a handful of companies that ARE the audience — the ones they would be glad to hear back from — and the
// house screens exactly those, from their own pages, the way a run screens anyone. Most of them kept: the audience
// says what it means. Many lost: it is too narrow, and each lost one says in the screener's own words which part of
// the first sign its page did not show — which is the part to widen.
// Append-only in the house's revenue office: { segmentId, domains, by, at }, one line a test.
// The standing is PURE; the store and the start are impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { normalizeDomain } from './prospect-shape.js';
import { definingFit } from './lead-run-shape.js';
import { readSegments, readCandidates, addCandidates } from './sales-store.js';

const FILE = 'audience-examples.jsonl';
export const EXAMPLES_MAX = 20;
export const EXAMPLES_MIN = 3;       // fewer than this judged, and the test says nothing either way
export const NARROW_BELOW = 0.7;     // of the examples judged, the share that must be kept
const serialize = createWriteChain();
const fileOf = (wallet) => officeFile(wallet, 'revenue', FILE);

/** pure — the company domains in what was typed (addresses, commas, lines), each once, at most EXAMPLES_MAX. */
export const exampleDomains = (given) => [...new Set((Array.isArray(given) ? given : String(given ?? '').split(/[\s,;]+/)).map(normalizeDomain).filter(Boolean))].slice(0, EXAMPLES_MAX);

/**
 * pure — how an audience did against its own examples.
 * @param {{segment: object, domains: string[], candidates: object[], prospects: object[], segments?: object[]}} q
 * @returns {?{domains: number, kept: object[], lost: object[], unread: string[], waiting: string[], elsewhere: object[], judged: number, share: ?number, verdict: 'holds'|'narrow'|'few'|'waiting', words: string}}
 */
export const examplesStanding = ({ segment, domains, candidates, prospects, segments = [] }) => {
  if (!domains?.length) return null;
  const kept = []; const lost = []; const unread = []; const waiting = []; const elsewhere = [];
  for (const domain of domains) {
    const scored = prospects.filter((p) => p.domain === domain && p.fit?.length);
    const here = scored.find((p) => p.segmentId === segment.id) ?? null;
    const other = scored.find((p) => p.segmentId !== segment.id) ?? null;
    const read = candidates.find((c) => c.domain === domain && c.siteRead);
    if (here && definingFit(here)) kept.push({ domain, name: here.name ?? domain, score: here.fit[0].score, why: String(here.fit[0].reasoning ?? '').slice(0, 240) });
    else if (here) lost.push({ domain, name: here.name ?? domain, score: here.fit[0]?.score ?? 0, why: String(here.fit[0]?.reasoning ?? here.dropReason ?? '').slice(0, 240) });
    // A company stands under ONE audience of the house: one already scored for another is not judged here, and is said so.
    else if (other) elsewhere.push({ domain, audience: segments.find((s) => s.id === other.segmentId)?.name ?? 'another audience' });
    else if (read && (!read.siteRead.alive || read.siteRead.blocked)) unread.push(domain);
    else waiting.push(domain);
  }
  const judged = kept.length + lost.length;
  const share = judged ? kept.length / judged : null;
  const verdict = waiting.length && !judged ? 'waiting' : judged < EXAMPLES_MIN ? 'few' : share >= NARROW_BELOW ? 'holds' : 'narrow';
  const first = segment.positiveCriteria?.[0] ?? '';
  const words = {
    waiting: 'THE TEST HAS NOT RUN YET: its companies wait to be screened.',
    few: `ONLY ${judged} OF YOUR EXAMPLES COULD BE JUDGED${unread.length ? ` (${unread.length} site${unread.length === 1 ? '' : 's'} could not be read)` : ''}${elsewhere.length ? ` (${elsewhere.length} already stand${elsewhere.length === 1 ? 's' : ''} under another audience)` : ''}: name at least ${EXAMPLES_MIN} whose sites can be read.`,
    holds: `THIS AUDIENCE SAYS WHAT YOU MEAN: ${kept.length} of ${judged} of your own examples were kept.`,
    narrow: `THIS AUDIENCE IS TOO NARROW: only ${kept.length} of ${judged} of your own examples were kept. Its first sign ("${first}") asks for more than those companies' own pages say. Each one lost says below what its page did not show — that is the part to widen, in the first sign's words.`,
  }[verdict];
  return { domains: domains.length, kept, lost, unread, waiting, elsewhere, judged, share, verdict, words };
};

/** The examples an audience was last tested against (its own example clients until a test names others). */
export const readExamples = async (wallet) => {
  const by = new Map();
  for (const e of (await readJsonLines(fileOf(wallet)).catch(() => ({ records: [] }))).records) if (e?.segmentId && Array.isArray(e.domains)) by.set(e.segmentId, e.domains);
  return by;
};

/**
 * Test an audience against companies that ARE it: they are added to its pool and screened now, and nothing else is.
 * @param {string} wallet
 * @param {{segmentId: string, domains: string[]|string, by?: string}} ask
 * @param {{start: Function}} deps - start(wallet, {segmentId, want, screenOnly, only}) → the lead run's own answer
 * @returns {Promise<{ok: true, run: object, domains: string[]} | {ok: false, reason: string}>}
 */
export const startAudienceTest = (wallet, { segmentId, domains, by = 'operator' }, { start }) => serialize(async () => {
  const segment = (await readSegments(wallet)).find((s) => s.id === segmentId);
  if (!segment) return { ok: false, reason: 'that is not one of this house\'s audiences' };
  const list = exampleDomains(domains);
  if (list.length < EXAMPLES_MIN) return { ok: false, reason: `name at least ${EXAMPLES_MIN} companies that ARE this audience, by their site (acme.com) — the ones you would be glad to hear back from` };
  const known = new Set((await readCandidates(wallet)).map((c) => c.domain));
  const fresh = list.filter((d) => !known.has(d));
  if (fresh.length) await addCandidates(wallet, segment.id, fresh.map((domain) => ({ source: 'example', domain, name: domain.split('.')[0] })), by);
  await appendJsonLine(fileOf(wallet), { segmentId: segment.id, domains: list, by, at: new Date().toISOString() });
  const started = await start(wallet, { segmentId: segment.id, want: list.length, screenOnly: true, only: list });
  return started.ok ? { ok: true, run: started.run, domains: list } : { ok: false, reason: started.reason };
});
