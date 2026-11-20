// A SEGMENT — one audience the Mercator sells to (the lead engine, docs/design/
// sales/lead-engine-plan.md §3). Eight targeting fields decide who is found and
// what they are told: the offer, the customer's problem, the role to reach,
// where (in words, and as the country codes it may be SENT to), how big, the signs of a fit, the signs of a non-fit, and companies
// that fit. Unlike the outbound tools this was studied from, the role is
// REQUIRED: a segment with no role picks whoever heads the company, and the
// list comes back loose.
//
// A segment sells ONE company of the house (`company`, its id): the facts a
// buyer may be told are that company's, never a sister company's.
//
// A segment opens as a DRAFT. The operator approves the pitch; only then may
// its prospects reach the ledger. Changing who it targets after approval
// returns it to DRAFT — a re-aimed segment is a new pitch, approved again.
//
// The record is append-only events, folded here:
//   { type: 'filed', segment, at }   { type: 'state', id, state, by, note?, at }
//   { type: 'campaign', id, campaign, by, at }  — the campaign it serves (sales/campaign-shape.js)
// PURE, but for makeSegment's random id.

import crypto from 'crypto';
import { requiredSigns } from './required-signs.js';

export const SEGMENT_STATES = Object.freeze(['draft', 'approved', 'paused', 'retired']);
// The fields that decide who is found and what they are told: a change re-aims.
export const TARGETING_FIELDS = Object.freeze([
  'company', 'offer', 'customerProblem', 'targetRole', 'targetGeography', 'countries', 'targetCompanySize',
  'positiveCriteria', 'negativeCriteria', 'exampleClients', 'required',
]);
const CRITERIA_MAX = 8;

const COUNTRIES_MAX = 60;

/** ISO 3166-1 alpha-2 codes, upper-cased, de-duplicated, in order; anything else is dropped. pure. */
export const countryCodes = (v) => [...new Set((Array.isArray(v) ? v : []).map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, COUNTRIES_MAX);

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const list = (v, max) => (Array.isArray(v) ? v.map((s) => clean(s, 160)).filter(Boolean).slice(0, max) : []);

/**
 * A segment, or a thrown reason naming every missing field at once.
 * @param {{id?: string, name: unknown, offer: unknown, customerProblem: unknown, targetRole: unknown,
 *   targetGeography: unknown, targetCompanySize?: unknown, positiveCriteria: unknown,
 *   negativeCriteria?: unknown, exampleClients?: unknown, required?: unknown, why: unknown, by: string, now: string}} f
 */
export const makeSegment = (f) => {
  const s = {
    name: clean(f.name, 80),
    company: clean(f.company, 40).toLowerCase(),
    campaign: clean(f.campaign, 40) || null,
    offer: clean(f.offer, 400),
    customerProblem: clean(f.customerProblem, 400),
    targetRole: clean(f.targetRole, 160),
    targetGeography: clean(f.targetGeography, 300),
    countries: countryCodes(f.countries),
    targetCompanySize: clean(f.targetCompanySize, 80),
    positiveCriteria: list(f.positiveCriteria, CRITERIA_MAX),
    negativeCriteria: list(f.negativeCriteria, CRITERIA_MAX),
    exampleClients: list(f.exampleClients, CRITERIA_MAX),
    why: clean(f.why, 400),
  };
  // What MUST be true of a company, proved from its own words (required-signs.js): a hard no, never averaged away.
  const must = requiredSigns(f.required);
  const problems = [
    ...(s.name.length < 3 ? ['name: what this audience is called'] : []),
    ...(!s.company ? ['company: the id of the house company this audience is sold for (one company per audience)'] : []),
    ...(s.offer.length < 10 ? ['offer: what you offer them, in one sentence'] : []),
    ...(s.customerProblem.length < 10 ? ['customerProblem: the problem they have'] : []),
    ...(s.targetRole.length < 2 ? ['targetRole: who to reach at the company, by what they are responsible for'] : []),
    ...(s.targetGeography.length < 2 ? ['targetGeography: where they are'] : []),
    ...(!s.countries.length ? ['countries: the ISO codes of the countries this may be sent to (e.g. ["US","DE"]) — an offer the law limits by country (crypto in the UK) leaves those countries out'] : []),
    ...(!s.positiveCriteria.length ? ['positiveCriteria: at least one sign a company fits'] : []),
    ...(s.why.length < 10 ? ['why: why this audience needs the offer'] : []),
    ...must.problems,
  ];
  if (problems.length) throw new Error(problems.join('; '));
  return Object.freeze({
    id: clean(f.id, 40) || `s-${crypto.randomBytes(4).toString('hex')}`,
    ...s,
    countries: Object.freeze(s.countries),
    positiveCriteria: Object.freeze(s.positiveCriteria),
    negativeCriteria: Object.freeze(s.negativeCriteria),
    exampleClients: Object.freeze(s.exampleClients),
    required: Object.freeze(must.required),
    filedBy: f.by,
    filedAt: f.now,
  });
};

/** Does the new filing change who the segment targets? pure. */
export const reAims = (before, after) =>
  TARGETING_FIELDS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));

/**
 * Fold the event log into the segments, oldest first. A refiled approved
 * segment that re-aims drops back to draft.
 * @param {object[]} events
 * @returns {object[]}
 */
export const foldSegments = (events) => {
  const byId = new Map();
  for (const e of events) {
    const prior = byId.get(e?.segment?.id ?? e?.id);
    if (e?.type === 'filed' && e.segment?.id) {
      const keeps = prior && !reAims(prior, e.segment);
      const standing = keeps
        ? { state: prior.state, stateAt: prior.stateAt, stateBy: prior.stateBy }
        : { state: 'draft', stateAt: e.at, stateBy: e.segment.filedBy };
      // A refiling that names no campaign keeps the one the audience already serves.
      byId.set(e.segment.id, { ...e.segment, campaign: e.segment.campaign ?? prior?.campaign ?? null, ...standing });
    } else if (e?.type === 'campaign' && prior) {
      byId.set(e.id, { ...prior, campaign: e.campaign || null });
    } else if (e?.type === 'state' && prior && SEGMENT_STATES.includes(e.state)) {
      byId.set(e.id, { ...prior, state: e.state, stateAt: e.at, stateBy: e.by });
    }
  }
  return [...byId.values()];
};

/**
 * May this segment move to `state`? pure.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export const judgeState = (segment, state) => {
  if (!segment) return { ok: false, reason: 'no such segment' };
  if (!SEGMENT_STATES.includes(state)) return { ok: false, reason: `state is one of ${SEGMENT_STATES.join(', ')}` };
  if (segment.state === 'retired') return { ok: false, reason: 'a retired segment does not move — file a new one' };
  if (segment.state === state) return { ok: false, reason: `the segment is already ${state}` };
  return { ok: true };
};

/** May a refiling land on this segment? pure. */
export const judgeRefile = (prior) =>
  (prior?.state === 'retired' ? { ok: false, reason: 'a retired segment is not refiled — file a new one' } : { ok: true });
