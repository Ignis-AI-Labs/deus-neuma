// A PROSPECT — one company the Mercator found for a segment, scored against
// that segment's signs before anyone is contacted (lead-engine-plan.md §3,
// steps 3–5). Every positive criterion is scored 0–5 with a written reason —
// a missing score is refused, never guessed — and a disqualifier that applies
// is scored the same way. The scores roll into a match level: 1 none, 2 weak,
// 3 strong. People found on the company's own pages ride along with the page
// they were read on; an address is never invented here.
//
// The record is append-only events, folded here:
//   { type: 'found', prospect, at }   { type: 'dropped', id, reason, by, at }
//   { type: 'promoted', id, leadId, by, at }
//   { type: 'listed', segmentId, ids, by, at } — the operator approved the list
// PURE, but for makeProspect's random id.

import crypto from 'crypto';

export const MATCH_WORDS = Object.freeze({ 1: 'none', 2: 'weak', 3: 'strong' });
const PEOPLE_MAX = 5;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const isHttps = (v) => /^https:\/\/[^\s]+$/.test(String(v ?? ''));

/** A bare company domain from a URL or a domain, or '' when it is not one. pure. */
export const normalizeDomain = (input) => {
  const host = clean(input, 300).toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
};

// pure — the scores for one list of criteria, or the problems with them.
const scoresFor = (criteria, given, label, required) => {
  const problems = [];
  const scores = [];
  for (const criterion of criteria) {
    const hit = given.find((g) => clean(g?.criterion, 160).toLowerCase() === criterion.toLowerCase());
    if (!hit) {
      if (required) problems.push(`${label} "${criterion}" has no score`);
      continue;
    }
    const reasoning = clean(hit.reasoning, 300);
    if (!Number.isInteger(hit.score) || hit.score < 0 || hit.score > 5) problems.push(`${label} "${criterion}": score is a whole number 0–5`);
    else if (reasoning.length < 10) problems.push(`${label} "${criterion}": say why, from what you read`);
    else scores.push(Object.freeze({ criterion, score: hit.score, reasoning }));
  }
  return { problems, scores };
};

/**
 * The match level from the scores: any disqualifier at 3+ is no match; the
 * signs of a fit averaging 4+ with none under 3 is strong; averaging 2.5+ is
 * weak. pure.
 */
export const matchLevel = (fit, misfit) => {
  if (misfit.some((s) => s.score >= 3) || !fit.length) return 1;
  const mean = fit.reduce((n, s) => n + s.score, 0) / fit.length;
  if (mean >= 4 && fit.every((s) => s.score >= 3)) return 3;
  return mean >= 2.5 ? 2 : 1;
};

// pure — people read on the company's own pages, each with the page.
const peopleOf = (people) => {
  const list = Array.isArray(people) ? people.slice(0, PEOPLE_MAX) : [];
  const problems = list.flatMap((p, i) => [
    ...(clean(p?.name, 120).length < 2 ? [`people[${i}].name`] : []),
    ...(clean(p?.role, 120).length < 2 ? [`people[${i}].role`] : []),
    ...(!isHttps(p?.sourceUrl) ? [`people[${i}].sourceUrl: the https page you read them on`] : []),
  ]);
  return { problems, people: list.map((p) => Object.freeze({ name: clean(p.name, 120), role: clean(p.role, 120), sourceUrl: String(p.sourceUrl) })) };
};

/**
 * A prospect for `segment`, or a thrown reason naming every problem at once.
 * @param {{segment: object, domain: unknown, name: unknown, description?: unknown, country?: unknown,
 *   size?: unknown, scores: unknown, people?: unknown, source: unknown, by: string, now: string}} f
 */
export const makeProspect = (f) => {
  const domain = normalizeDomain(f.domain);
  const name = clean(f.name, 120);
  const given = Array.isArray(f.scores) ? f.scores : [];
  const fit = scoresFor(f.segment.positiveCriteria, given, 'sign of fit', true);
  const misfit = scoresFor(f.segment.negativeCriteria, given, 'disqualifier', false);
  const crew = peopleOf(f.people);
  const source = f.source === 'operator' || isHttps(f.source) ? String(f.source) : '';
  const problems = [
    ...(!domain ? ['domain: the company\'s own web domain'] : []),
    ...(name.length < 2 ? ['name: the company\'s name'] : []),
    ...fit.problems, ...misfit.problems, ...crew.problems,
    ...(!source ? ['source: the https page where you found the company'] : []),
  ];
  if (problems.length) throw new Error(problems.join('; '));
  return Object.freeze({
    id: `p-${crypto.randomBytes(4).toString('hex')}`,
    segmentId: f.segment.id,
    domain,
    name,
    description: clean(f.description, 300) || null,
    country: clean(f.country, 60) || null,
    size: clean(f.size, 60) || null,
    fit: Object.freeze(fit.scores),
    misfit: Object.freeze(misfit.scores),
    match: matchLevel(fit.scores, misfit.scores),
    people: Object.freeze(crew.people),
    source,
    foundBy: f.by,
    foundAt: f.now,
  });
};

/** Fold the event log into the prospects, oldest first, each with its stage. pure. */
export const foldProspects = (events) => {
  const byId = new Map();
  for (const e of events) {
    if (e?.type === 'found' && e.prospect?.id) byId.set(e.prospect.id, { ...e.prospect, stage: 'found' });
    const prior = byId.get(e?.id);
    if (e?.type === 'dropped' && prior) byId.set(e.id, { ...prior, stage: 'dropped', dropReason: e.reason, droppedAt: e.at });
    if (e?.type === 'promoted' && prior) byId.set(e.id, { ...prior, stage: 'promoted', leadId: e.leadId, promotedAt: e.at });
    if (e?.type === 'listed' && Array.isArray(e.ids)) {
      for (const id of e.ids) if (byId.has(id)) byId.set(id, { ...byId.get(id), listApproved: true, listedAt: e.at });
    }
  }
  return [...byId.values()];
};

/** The prospects an approval of `segmentId`'s list would cover: a weak or strong match, still live, not yet on it. pure. */
export const listable = (pool, segmentId) => pool.filter((p) => p.segmentId === segmentId && p.match >= 2 && p.stage !== 'dropped' && !p.listApproved);

/**
 * Why a new prospect may not join the pool (already there, or on the
 * do-not-contact list), or null. pure.
 */
export const poolRefusal = (prospect, pool, suppressedDomain) => {
  if (suppressedDomain(prospect.domain)) return `${prospect.domain} is on the do-not-contact list`;
  const held = pool.find((p) => p.domain === prospect.domain && p.stage !== 'dropped');
  return held ? `${prospect.domain} is already in the pool as [${held.id}]` : null;
};
