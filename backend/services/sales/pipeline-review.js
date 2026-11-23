// THE PIPELINE REVIEW — a batch of an audience's leads graded at every stage against the written standard
// (pipeline-standard.js), with how long each stage took and where the companies came from.
//
// Design note, 2026-11-21: […]
// So: a small batch (the newest leads of an audience, or the leads of one run), every stage graded MEETS, WEAK or
// FAILS, each failed check named with the companies it failed on, and the time between the stages. Fix what fails,
// run the next small batch, read the review again: the numbers moving is the benchmark.
// Graded from the records alone, so the review costs nothing, spends nothing and can be read at any moment.
// The grading is PURE; readPipelineReview reads the house's files.

import { STAGES, STANDARD, gradeLead } from './pipeline-standard.js';
import { sourceYield } from './lead-run-shape.js';
import { REWORD_AFTER, REWORD_BELOW, sourceWords } from './lead-run-standing.js';
import { isFundingCampaign } from './company-entity.js';
import { domainOfAddress } from './top-first.js';
import { normalizeEmail } from './suppress-shape.js';
import { factsFor } from './sales-facts.js';

export const BATCH_DEFAULT = 25;
export const BATCH_MAX = 500;
export const SOURCE_GOOD = 0.15; // of the companies a source brings, the share that should be a fit
const LIVE_DRAFT = ['waiting', 'returned', 'sent', 'uncertain'];
const median = (xs) => { const s = xs.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const secondsBetween = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null);

/** pure — a length of time in the plainest words ("14 s", "6 min", "3.2 h", "2.1 days"). */
export const timeWords = (seconds) => {
  if (seconds == null) return 'not measured';
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 360) / 10} h`;
  return `${Math.round(seconds / 8640) / 10} days`;
};

// The steps timed, each from one record's stamp to the next one's. `whose` says who the wait belongs to.
export const STEPS = Object.freeze([
  { id: 'address', name: 'screened as a fit → lead filed with a confirmed address', whose: 'the run' },
  { id: 'research', name: 'lead filed → research card', whose: 'the sales member' },
  { id: 'email', name: 'research card → email staged', whose: 'the sales member' },
  { id: 'sent', name: 'email staged → sent', whose: 'you' },
]);
const timesOf = (x) => ({
  address: secondsBetween(x.prospect?.foundAt, x.prospect?.promotedAt ?? x.lead?.createdAt),
  research: x.card && Date.parse(x.card.at) >= Date.parse(x.lead.createdAt) ? secondsBetween(x.lead.createdAt, x.card.at) : null,
  email: x.draft && x.card ? secondsBetween(x.card.at, x.draft.at) : null,
  sent: x.draft?.sentAt ? secondsBetween(x.draft.at, x.draft.sentAt) : null,
});

/**
 * Where an audience's companies came from, and how many of each source turned out a fit.
 * @returns {{sources: Array<{source, words, scored, fit, rate, grade}>, waiting: number, grade: string}}
 */
export const discoveryOf = ({ candidates, prospects, segmentId }) => {
  const sources = [...sourceYield(candidates, prospects, segmentId)].map(([source, row]) => {
    const rate = row.scored ? row.fit / row.scored : null;
    const grade = row.scored < REWORD_AFTER ? 'none' : rate >= SOURCE_GOOD ? 'meets' : rate >= REWORD_BELOW ? 'weak' : 'fails';
    return { source, words: sourceWords(source), scored: row.scored, fit: row.fit, rate, grade };
  }).sort((a, b) => b.scored - a.scored);
  const judged = sources.filter((s) => s.grade !== 'none');
  const [scored, fit] = [judged.reduce((n, s) => n + s.scored, 0), judged.reduce((n, s) => n + s.fit, 0)];
  const rate = scored ? fit / scored : null;
  return {
    sources, scored, fit, rate,
    waiting: candidates.filter((c) => c.segmentId === segmentId && c.state === 'waiting').length,
    grade: rate == null ? 'none' : rate >= SOURCE_GOOD ? 'meets' : rate >= REWORD_BELOW ? 'weak' : 'fails',
  };
};

/**
 * Grade a batch of one audience's leads.
 * @param {object} read - the house's records: { segments, campaigns, candidates, prospects, leads, checks, research,
 *   drafts, facts, companyNames: Map<companyId, name>, runs }
 * @param {{segmentId: string, run?: ?string, size?: number, now?: number}} ask
 * @returns {object|null} the review, or null when the audience is not the house's
 */
export const reviewBatch = (read, { segmentId, run = null, size = BATCH_DEFAULT, now = Date.now() }) => {
  const segment = read.segments.find((s) => s.id === segmentId);
  if (!segment) return null;
  const campaign = read.campaigns.find((c) => c.id === segment.campaign) ?? null;
  const plan = campaign?.emailPlan?.approved ?? null;
  const funding = campaign ? isFundingCampaign(campaign) : false;
  const leadById = new Map(read.leads.map((l) => [l.id, l]));
  const checkOf = new Map(read.checks.map((c) => [c.email, c]));
  const filed = read.prospects.filter((p) => p.segmentId === segmentId && p.stage === 'promoted' && leadById.has(p.leadId))
    .sort((a, b) => String(b.promotedAt ?? b.placedAt ?? '').localeCompare(String(a.promotedAt ?? a.placedAt ?? '')));
  const perDomain = new Map();
  for (const p of filed) { const d = domainOfAddress(leadById.get(p.leadId).contact); perDomain.set(d, (perDomain.get(d) ?? 0) + 1); }
  const ofRun = run ? filed.filter((p) => (leadById.get(p.leadId).touches ?? []).some((t) => String(t.note ?? '').includes(run))) : filed;
  const want = Math.min(Math.max(parseInt(size, 10) || BATCH_DEFAULT, 1), BATCH_MAX);
  const batch = ofRun.slice(0, want);

  const rows = batch.map((prospect) => {
    const lead = leadById.get(prospect.leadId);
    const email = normalizeEmail(lead.contact);
    const draft = read.drafts.filter((d) => d.formula && LIVE_DRAFT.includes(d.state) && d.to.some((a) => normalizeEmail(a) === email)).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null;
    const x = {
      lead, email, prospect, segment, campaign, plan, funding, now, draft, never: read.never ?? [],
      check: checkOf.get(email) ?? null, card: read.research.cards.get(email) ?? null,
      fit: campaign ? read.research.fits.get(`${email}|${campaign.id}`) ?? null : null,
      entity: read.research.entities.get(prospect.domain) ?? null,
      approved: factsFor(read.facts?.approved ?? null, segment.company ?? null),
      company: read.companyNames?.get(campaign?.company) ?? segment.company ?? 'the company',
      twins: (perDomain.get(domainOfAddress(email)) ?? 1) - 1,
    };
    return { leadId: lead.id, prospectId: prospect.id, domain: prospect.domain, name: lead.name, email, status: lead.status, filedAt: prospect.promotedAt ?? lead.createdAt, emailState: draft?.state ?? null, ...gradeLead(x), times: timesOf(x) };
  });

  const stages = STAGES.map((stage) => {
    const there = rows.filter((r) => r.grades[stage.id] !== 'none');
    const count = (g) => there.filter((r) => r.grades[stage.id] === g).length;
    const checks = STANDARD.filter((c) => c.stage === stage.id).map((c) => {
      const hits = there.flatMap((r) => r.fails.filter((f) => f.check === c.id).map((f) => ({ domain: r.domain, email: r.email, why: f.why })));
      return { id: c.id, must: c.must, says: c.says, failed: hits.length, examples: hits };
    }).sort((a, b) => b.failed - a.failed || Number(b.must) - Number(a.must));
    return { ...stage, reached: there.length, meets: count('meets'), weak: count('weak'), fails: count('fails'), rate: there.length ? count('meets') / there.length : null, checks };
  });
  const steps = STEPS.map((s) => { const all = rows.map((r) => r.times[s.id]).filter((n) => n != null); const [mid, top] = [median(all), all.length ? Math.max(...all) : null]; return { ...s, measured: all.length, median: mid, slowest: top, medianWords: timeWords(mid), slowestWords: timeWords(top) }; });
  const waitingResearch = rows.filter((r) => r.grades.research === 'none' && r.grades.validate !== 'fails');
  const lastRun = (read.runs ?? []).find((r) => r.segmentId === segmentId && r.endedAt && (!run || r.id === run)) ?? null;
  return {
    at: new Date(now).toISOString(),
    segment: { id: segment.id, name: segment.name, required: (segment.required ?? []).length, firstSign: segment.positiveCriteria?.[0] ?? null },
    campaign: campaign ? { id: campaign.id, name: campaign.name, plan: Boolean(plan), funding } : null,
    run, size: rows.length, of: ofRun.length,
    // Things wrong with the SETUP, which no single lead shows.
    findings: [
      ...(!campaign ? ['this audience serves no campaign: no email can be written for it'] : []),
      ...(campaign && !plan ? [`"${campaign.name}" has no approved email plan: no first email can be written`] : []),
      ...(!(segment.required ?? []).length ? ['this audience has no hard condition: nothing is PROVED from a company\'s own words, only scored'] : []),
      ...(waitingResearch.length ? [`${waitingResearch.length} of ${rows.length} leads have a confirmed address and no research yet: the oldest has waited ${timeWords(Math.max(...waitingResearch.map((r) => secondsBetween(r.filedAt, new Date(now).toISOString()) ?? 0)))}`] : []),
    ],
    discovery: discoveryOf({ candidates: read.candidates, prospects: read.prospects, segmentId }),
    stages, steps,
    // The whole road: a lead that reached the email and meets every stage on the way.
    whole: { reachedEmail: rows.filter((r) => r.grades.email !== 'none').length, clean: rows.filter((r) => STAGES.every((s) => r.grades[s.id] === 'meets')).length, noMustFailed: rows.filter((r) => r.grades.email !== 'none' && STAGES.every((s) => r.grades[s.id] !== 'fails')).length },
    lastRun: lastRun ? { id: lastRun.id, startedAt: lastRun.startedAt, endedAt: lastRun.endedAt, seconds: secondsBetween(lastRun.startedAt, lastRun.endedAt), counts: lastRun.counts ?? null, ended: lastRun.ended ?? null } : null,
    rows,
  };
};

const pct = (rate) => (rate == null ? 'nothing to grade' : `${Math.round(rate * 100)}%`);
/**
 * A review in words, for the seat (and for a plain reading): every stage's grade, its failed checks with the
 * companies, the times, the setup's own faults. Nothing is cut: `examples` companies a check, the rest counted.
 */
export const reviewWords = (review, { examples = 6 } = {}) => [
  `PIPELINE REVIEW — "${review.segment.name}"${review.campaign ? ` (${review.campaign.name})` : ''}: ${review.size} lead(s) graded${review.run ? ` of run ${review.run}` : `, the newest of ${review.of}`}.`,
  ...review.findings.map((f) => `SETUP: ${f}`),
  `DISCOVERY — ${review.discovery.rate == null ? 'no source has been screened enough to judge' : `${review.discovery.fit} of ${review.discovery.scored} screened companies were a fit (${pct(review.discovery.rate)}; the standard is ${Math.round(SOURCE_GOOD * 100)}%)`}; ${review.discovery.waiting} gathered and not yet screened.`,
  ...review.discovery.sources.map((s) => `  · ${s.words}: ${s.scored ? `${s.fit} of ${s.scored} a fit (${pct(s.rate)})` : 'none screened yet'}${s.grade === 'fails' ? ' — FAILS: stop gathering from it for this audience' : s.grade === 'weak' ? ' — WEAK' : ''}`),
  ...review.stages.flatMap((s) => [
    `${s.name} — ${s.reached ? `${s.meets} of ${s.reached} meet the standard (${pct(s.rate)}), ${s.weak} weak, ${s.fails} FAIL` : 'no lead of the batch has reached it'}.`,
    ...s.checks.filter((c) => c.failed).map((c) => `  · ${c.must ? 'MUST' : 'SHOULD'} — ${c.says} FAILED BY ${c.failed}: ${c.examples.slice(0, examples).map((e) => `${e.domain} (${e.why})`).join(' | ')}${c.failed > examples ? ` | and ${c.failed - examples} more` : ''}`),
  ]),
  `THE WHOLE ROAD — ${review.whole.reachedEmail} of ${review.size} have an email; ${review.whole.noMustFailed} of those fail no MUST at any stage; ${review.whole.clean} meet every check of every stage.`,
  `TIME — ${review.steps.map((t) => `${t.name}: ${t.measured ? `${timeWords(t.median)} typical, ${timeWords(t.slowest)} slowest (${t.measured} measured; ${t.whose})` : 'not measured in this batch'}`).join(' · ')}.`,
  ...(review.lastRun ? [`LAST RUN — ${timeWords(review.lastRun.seconds)}${review.lastRun.counts ? `: ${review.lastRun.counts.looked ?? 0} looked at, ${review.lastRun.counts.screened ?? 0} screened, ${review.lastRun.counts.fit ?? 0} fits, ${review.lastRun.counts.leads ?? 0} leads` : ''}.`] : []),
].join('\n');
