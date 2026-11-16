// POOL VIEW — every company the house gathered, seen whole and filtered down (Design note, 2026-11-16: […]).
//
// A wide net (hunter-discover.js) fills the pool with thousands; the briefing names eight. This is
// the seat's way through all of them: each company with everything the house knows — its size, the
// addresses Hunter holds there (the count Hunter's own screen shows), how busy its site is, what its
// site said when it was read, whether it was scored, and the people already pulled — filtered by any
// of those, sorted, a page at a time, under a count of the whole pool. PURE.

import { heldWords } from './hunter-discover.js';
import { topFirst } from './top-first.js';

export const POOL_PAGE = 50;
export const POOL_PAGE_MAX = 100;
const SORTS = Object.freeze(['addresses', 'people', 'traffic', 'newest']);
const SITES = Object.freeze(['any', 'unread', 'alive', 'dead']);
const STATES = Object.freeze(['waiting', 'scored', 'all']);

const total = (c) => Number(c.hunterEmails?.total) || (Number(c.hunterEmails?.personal) || 0) + (Number(c.hunterEmails?.generic) || 0);
const named = (c) => Number(c.hunterEmails?.personal) || 0;
const siteOf = (c) => (!c.siteRead ? 'unread' : c.siteRead.alive ? 'alive' : 'dead');

/**
 * The filter as asked, made whole: unknown values fall back to the broadest. Pure.
 * @param {object} raw the act's fields
 */
export const poolFilter = (raw = {}) => ({
  segment: String(raw.segment ?? '').trim() || null,
  state: STATES.includes(raw.state) ? raw.state : 'waiting',
  minAddresses: Math.max(0, parseInt(raw.minAddresses, 10) || 0),
  minPeople: Math.max(0, parseInt(raw.minPeople, 10) || 0),
  sizes: (Array.isArray(raw.sizes) ? raw.sizes : raw.sizes ? [raw.sizes] : []).map(String),
  words: String(raw.words ?? '').trim().toLowerCase().slice(0, 80),
  site: SITES.includes(raw.site) ? raw.site : 'any',
  pulled: raw.pulled === true || raw.pulled === false ? raw.pulled : null,
  source: String(raw.source ?? '').trim() || null,
  sort: SORTS.includes(raw.sort) ? raw.sort : 'addresses',
  offset: Math.max(0, parseInt(raw.offset, 10) || 0),
  limit: Math.min(Math.max(parseInt(raw.limit, 10) || POOL_PAGE, 1), POOL_PAGE_MAX),
});

/**
 * The pool filtered and sorted: the page asked for, and how many matched in all. Pure.
 * @param {object[]} candidates readCandidates
 * @param {ReturnType<typeof poolFilter>} f
 * @param {Map<string, object[]>} held the people already pulled, by company (top-first.js peopleByCompany)
 */
export const filterPool = (candidates, f, held = new Map()) => {
  const words = f.words;
  const matched = candidates.filter((c) => (!f.segment || c.segmentId === f.segment)
    && (f.state === 'all' || c.state === f.state)
    && total(c) >= f.minAddresses && named(c) >= f.minPeople
    && (!f.sizes.length || f.sizes.includes(c.size))
    && (!words || `${c.name} ${c.domain} ${c.description ?? ''} ${c.siteRead?.description ?? ''} ${(c.categories ?? []).join(' ')}`.toLowerCase().includes(words))
    && (f.site === 'any' || siteOf(c) === f.site)
    && (f.pulled === null || held.has(c.domain) === f.pulled)
    && (!f.source || c.source === f.source));
  const by = {
    addresses: (a, b) => total(b) - total(a),
    people: (a, b) => named(b) - named(a) || total(b) - total(a),
    traffic: (a, b) => Number(!a.trafficRank) - Number(!b.trafficRank) || (a.trafficRank ?? 0) - (b.trafficRank ?? 0),
    newest: (a, b) => String(b.gatheredAt).localeCompare(String(a.gatheredAt)),
  }[f.sort];
  const sorted = [...matched].sort((a, b) => by(a, b) || a.name.localeCompare(b.name));
  return { matched: sorted.length, page: sorted.slice(f.offset, f.offset + f.limit) };
};

/** The whole pool of an audience, counted the ways a filter can narrow it. Pure. */
export const poolCounts = (candidates, held = new Map()) => ({
  all: candidates.length,
  waiting: candidates.filter((c) => c.state === 'waiting').length,
  withAddresses: candidates.filter((c) => total(c) > 0).length,
  withPeople: candidates.filter((c) => named(c) > 0).length,
  read: candidates.filter((c) => c.siteRead).length,
  dead: candidates.filter((c) => c.siteRead && !c.siteRead.alive).length,
  pulled: candidates.filter((c) => held.has(c.domain)).length,
});

/** One company with everything the house knows about it, on one line. Pure. */
export const poolLine = (c, held = new Map()) => {
  const people = topFirst(held.get(c.domain) ?? []);
  const site = !c.siteRead ? 'site not read yet'
    : !c.siteRead.alive ? `NO SITE (${c.siteRead.why ?? 'unreachable'})`
      : `site ALIVE${c.siteRead.description ? `: "${String(c.siteRead.description).slice(0, 140)}"` : ''}${c.siteRead.emails?.length ? `, publishes ${c.siteRead.emails.map((e) => e.email).slice(0, 3).join(', ')}` : ''}`;
  return [
    `[${c.id}] ${c.name}`, c.domain,
    c.size ? `${c.size} people` : 'size unknown',
    c.hunterEmails ? heldWords(c.hunterEmails) : null,
    'trafficRank' in c ? (c.trafficRank ? `traffic #${Number(c.trafficRank).toLocaleString('en-US')}` : 'NO TRAFFIC') : null,
    site,
    people.length ? `${people.length} pulled — top: ${people[0].name}, ${people[0].role} (${people[0].email})` : null,
    c.state === 'scored' ? 'SCORED' : null,
  ].filter(Boolean).join(' — ');
};
