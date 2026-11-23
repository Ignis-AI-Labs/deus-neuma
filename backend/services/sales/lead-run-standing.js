// WHERE EACH AUDIENCE STANDS FOR A LEAD RUN, AND WHAT TO DO NEXT — Design note, 2026-11-21, after a run ended at 9 leads from
// 487 companies screened: […]
//
// For each approved audience: how many gathered companies still wait to be screened, how the screened ones came out,
// which source brought the fits — and ONE next step in plain words:
//   FEW      almost nobody screened showed the audience's first sign. There are two causes and they need opposite
//            fixes, so the last misses are shown with the screener's own reason for each, and the operator reads which:
//            THE WRONG COMPANIES (a funds audience fed AI product companies: […]) — the searches are wrong, gather narrower; or THE RIGHT COMPANIES AND A SIGN NO PAGE SAYS (a
//            wish or a need: […]) — the first sign has to be something a page shows.
//   RUN      companies wait: start a run.
//   GATHER   nothing waits: the sales member gathers more, with the searches that worked named.
// The judging is PURE; readRunStanding reads the house's records.
import { examplesStanding, readExamples } from './audience-test.js';
import { readCandidates, readProspects, readSegments, readCampaigns, readSearches } from './sales-store.js';
import { wideFinds } from './wide-search.js';
import { definingFit, sourceYield, screenable, signWords, leanOf } from './lead-run-shape.js';
import { isFundingCampaign } from './company-entity.js';
import { LEAD_SOURCES } from './lead-sources.js';

export const REWORD_AFTER = 50;      // screened companies before the yield is judged
export const REWORD_BELOW = 0.08;
const MISSES_SHOWN = 8;    // fewer fits than this share of the screened: the sign, or the pool, is wrong
const n = (v) => Number(v).toLocaleString('en-US');
const SOURCE_WORDS = Object.freeze({ 'from-fits': 'named by your own fits', example: 'your own examples', 'hunter-discover': 'Hunter search', 'apollo-discover': 'Apollo search', 'tomba-discover': 'Tomba search', 'company-index': 'the company index', 'base-tokens': 'Base tokens list', 'base-protocols': 'Base protocols list' });
export const sourceWords = (source) => SOURCE_WORDS[source] ?? String(source ?? 'unknown');

/**
 * One audience's standing. pure.
 * @param {{segment: object, candidates: object[], prospects: object[], tooWide: Set<string>, running?: boolean}} q
 */
export const audienceStanding = ({ segment, candidates, prospects, tooWide, running = false, funding = false }) => {
  const mine = prospects.filter((p) => p.segmentId === segment.id);
  // Screened = judged from a page: everything scored for this audience, whatever became of it.
  const screened = mine.filter((p) => p.fit?.length).length;
  const fit = mine.filter((p) => definingFit(p)).length;
  const leads = mine.filter((p) => p.stage === 'promoted' && !p.placed).length;
  const fitsWaiting = mine.filter((p) => p.stage === 'found' && definingFit(p)).length;
  const queue = candidates.filter((c) => screenable(c, segment.id, tooWide));
  // Of those waiting, how many say something of what the audience is in what was gathered about them: a run reads these first.
  const tell = signWords(segment);
  const likely = queue.filter((c) => leanOf(c, tell, funding) > 0).length;
  const yields = sourceYield(candidates, prospects, segment.id);
  const waitingBy = queue.reduce((m, c) => m.set(c.source, (m.get(c.source) ?? 0) + 1), new Map());
  const sources = [...yields.entries()].map(([source, y]) => ({ source, name: sourceWords(source), waiting: waitingBy.get(source) ?? 0, scored: y.scored, fit: y.fit, rate: y.rate }))
    .sort((a, b) => b.rate - a.rate || b.waiting - a.waiting);
  const firstSign = segment.positiveCriteria?.[0] ?? null;
  const share = screened ? fit / screened : null;
  const poor = screened >= REWORD_AFTER && share < REWORD_BELOW;
  const best = sources.find((s) => s.scored >= 10 && s.fit > 0) ?? null;
  const waiting = queue.length;
  const kind = running ? 'running' : poor ? 'few' : waiting || fitsWaiting ? 'run' : 'gather';
  // The last companies screened and found no fit, each with the screener's own reason: what tells the two causes apart.
  const misses = mine.filter((p) => p.fit?.length && !definingFit(p)).sort((a, b) => String(b.scoredAt ?? b.foundAt ?? '').localeCompare(String(a.scoredAt ?? a.foundAt ?? ''))).slice(0, MISSES_SHOWN)
    .map((p) => ({ domain: p.domain, name: p.name ?? p.domain, why: String(p.fit[0]?.reasoning ?? '').slice(0, 220) }));
  const words = {
    running: 'A RUN IS WORKING THIS AUDIENCE NOW.',
    few: `ONLY ${n(fit)} OF ${n(screened)} COMPANIES SCREENED SHOWED WHAT THIS AUDIENCE IS (its first sign: "${firstSign}"). Read the last misses below — the reason beside each says which of two things is wrong. If they are THE WRONG KIND OF COMPANY, the searches are bringing the wrong companies: have your sales member gather narrower, by what the audience IS${waiting ? `, and expect the ${n(waiting)} still waiting to miss the same way` : ''}. If they are the right kind of company and the page simply does not SAY the first sign, the sign is a wish or a need no website states: change it to something a page shows (what the company makes, who it serves, what it runs on).`,
    run: `START A RUN: ${[waiting ? `${n(waiting)} gathered compan${waiting === 1 ? 'y waits' : 'ies wait'} to be screened (${n(likely)} of them look likely from what was gathered about them, and are read first)` : null, fitsWaiting ? `${n(fitsWaiting)} fit${fitsWaiting === 1 ? ' waits' : 's wait'} for a person` : null].filter(Boolean).join(' and ')}.${best ? ` Best source so far: ${best.name} (${n(best.fit)} of ${n(best.scored)} a fit); it is worked first.` : ''}`,
    gather: `NOTHING WAITS TO BE SCREENED. Your sales member gathers more companies for this audience first (DISCOVER), then you start a run.${best ? ` Searches like the ones through ${best.name} worked best (${n(best.fit)} of ${n(best.scored)} a fit).` : screened ? '' : ' Nothing has been gathered for it yet.'}`,
  }[kind];
  // A free public list that has given this audience fits is one press away (list-gather.js): said with every next step.
  const lists = sources.filter((x) => LEAD_SOURCES[x.source]?.list && x.fit > 0).map((x) => ({ source: x.source, name: x.name, fit: x.fit, scored: x.scored, waiting: x.waiting }));
  const listWords = lists.length && kind !== 'running' ? ` FREE AND ONE PRESS AWAY: gather more from ${lists.map((l) => `${l.name} (${n(l.fit)} of ${n(l.scored)} a fit, ${n(l.waiting)} waiting)`).join(' and ')} below.` : '';
  return { lists, id: segment.id, name: segment.name, campaignId: segment.campaign ?? null, firstSign, waiting, likely, fitsWaiting, screened, fit, leads, inHundred: share === null ? null : Math.round(share * 1000) / 10, sources, misses: kind === 'few' ? misses : [], next: { kind, words: `${words}${listWords}` } };
};

/**
 * Every approved audience's standing. impure.
 * @param {string} wallet
 * @param {{running?: Set<string>}} [o] - the audiences a run is working now
 */
export const readRunStanding = async (wallet, { running = new Set() } = {}) => {
  const [segments, candidates, prospects, searches, campaigns, tested] = await Promise.all([readSegments(wallet), readCandidates(wallet), readProspects(wallet), readSearches(wallet), readCampaigns(wallet), readExamples(wallet)]);
  const tooWide = new Set(wideFinds(searches, candidates).flatMap((f) => f.companies.map((c) => c.domain)));
  return segments.filter((s) => s.state === 'approved').map((segment) => ({
    ...audienceStanding({ segment, candidates, prospects, tooWide, running: running.has(segment.id), funding: isFundingCampaign(campaigns.find((c) => c.id === segment.campaign)) }),
    campaign: campaigns.find((c) => c.id === segment.campaign)?.name ?? null,
    // How it did against its operator's own examples of who it is for (audience-test.js); null until one was run.
    examples: examplesStanding({ segment, domains: tested.get(segment.id) ?? [], candidates, prospects, segments }),
  }));
};
