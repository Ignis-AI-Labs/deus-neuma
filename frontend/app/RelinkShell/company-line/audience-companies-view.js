// audience-companies-view.js — how one audience's companies read as a list (Design note, 2026-11-16, on the list a
// lead tool showed him: […]). Every company the house holds for the audience once:
// what was gathered, what the seat scored, what became a lead; counted by country, by size and by whether
// its site has any traffic; then one row each. Pure.

const STANDING = Object.freeze({ lead: ['ON THE LEAD LIST', 'on'], strong: ['STRONG MATCH', 'on'], weak: ['WEAK MATCH', null], none: ['NO MATCH', null], gathered: ['GATHERED — NOT SCORED YET', null] });
export const standingWords = (standing) => STANDING[standing] ?? [String(standing).toUpperCase(), null];
const ORDER = Object.keys(STANDING);

/** How busy a company's site is, short: its place among the million most visited, or that it has none. */
export const trafficShort = (rank) => (rank ? `#${Number(rank).toLocaleString('en-US')}` : 'NO TRAFFIC');

/**
 * Every company of one audience once, the strongest standing first, then the most visited.
 * @param {{gathered?: object[], pool?: object[], leads?: object[]}} row - candidates (lead-sources.js), scored companies, companies on the lead list
 */
export const companyRows = ({ gathered = [], pool = [], leads = [] } = {}) => {
  const by = new Map();
  for (const c of gathered) {
    by.set(c.domain, { domain: c.domain, name: c.name, about: c.description || c.signal || '', country: c.country ?? null, size: c.size ?? null, industry: c.categories?.[0] ?? null, founded: c.founded ?? null, rank: c.trafficRank ?? null, ranked: 'trafficRank' in c, standing: 'gathered', people: 0, site: typeof c.site === 'string' ? c.site : `https://${c.domain}`,
      // what its own site said when it was read (company-reader.js): null until then
      read: c.site && typeof c.site === 'object' ? { alive: Boolean(c.site.alive), why: c.site.why ?? null, emails: (c.site.emails ?? []).map((e) => e.email), socials: c.site.socials ?? {}, movedTo: c.site.movedTo ?? null } : null });
  }
  const scored = (p, standing) => {
    const prior = by.get(p.domain) ?? { domain: p.domain, name: p.name, about: '', country: null, size: null, industry: null, founded: null, rank: null, ranked: false, site: `https://${p.domain}`, read: null };
    by.set(p.domain, { ...prior, name: p.name || prior.name, country: p.country && p.country !== 'unknown' ? p.country : prior.country, standing, people: p.people?.length ?? 0 });
  };
  for (const p of pool) scored(p, p.match === 3 ? 'strong' : p.match === 2 ? 'weak' : 'none');
  for (const p of leads) scored(p, 'lead');
  return [...by.values()].sort((a, b) => ORDER.indexOf(a.standing) - ORDER.indexOf(b.standing) || Number(!a.rank) - Number(!b.rank) || (a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name));
};

const tally = (rows, keyOf) => {
  const by = new Map();
  for (const r of rows) { const k = keyOf(r) || 'unknown'; by.set(k, (by.get(k) ?? 0) + 1); }
  const max = Math.max(1, ...by.values());
  return [...by].map(([label, n]) => ({ label, n, share: n / max })).sort((a, b) => Number(a.label === 'unknown') - Number(b.label === 'unknown') || b.n - a.n);
};

const SIZE_ORDER = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+', 'unknown'];

/** The list counted three ways: by country (the eight largest), by size (smallest first), and by standing. */
export const breakdown = (rows) => ({
  geography: tally(rows, (r) => r.country).slice(0, 8),
  size: tally(rows, (r) => r.size).sort((a, b) => SIZE_ORDER.indexOf(a.label) - SIZE_ORDER.indexOf(b.label)),
  standing: ORDER.map((s) => ({ id: s, label: standingWords(s)[0], n: rows.filter((r) => r.standing === s).length })).filter((s) => s.n),
});

/** Of the companies whose traffic was looked up: how many have any, and how many have none (likely dead). */
export const trafficCount = (rows) => {
  const ranked = rows.filter((r) => r.ranked);
  return { checked: ranked.length, live: ranked.filter((r) => r.rank).length, quiet: ranked.filter((r) => !r.rank).length };
};

/** A company nobody should spend a minute on: its site could not be read, or it has no traffic at all. */
export const isDeadEnd = (r) => (r.read ? !r.read.alive : false) || (r.ranked && !r.rank && !r.read);

/** How a company can be reached, from its own site: its first address (and how many more), else its X or LinkedIn. */
export const contactShort = (r) => {
  if (!r.read) return '—';
  if (!r.read.alive) return 'NO SITE';
  const [first, ...rest] = r.read.emails;
  if (first) return `${first}${rest.length ? ` +${rest.length}` : ''}`;
  const social = r.read.socials.x ?? r.read.socials.linkedin ?? r.read.socials.telegram ?? null;
  return social ? social.replace(/^https?:\/\/(www\.)?/, '') : 'NO ADDRESS ON ITS SITE';
};

/** Of the gathered companies: how many had their site read, how many of those are alive, how many are still unread. */
export const readCount = (rows) => {
  const gathered = rows.filter((r) => r.standing === 'gathered');
  return { read: rows.filter((r) => r.read).length, dead: rows.filter((r) => r.read && !r.read.alive).length, unread: gathered.filter((r) => !r.read).length, withAddress: rows.filter((r) => r.read?.emails.length).length };
};

/** The fold's own line. */
export const companiesLine = (rows) => {
  const t = trafficCount(rows);
  const n = (s) => rows.filter((r) => r.standing === s).length;
  const sites = readCount(rows);
  return [
    `${rows.length.toLocaleString('en-US')} COMPAN${rows.length === 1 ? 'Y' : 'IES'}`,
    n('gathered') ? `${n('gathered').toLocaleString('en-US')} NOT SCORED YET` : null,
    n('strong') ? { text: `${n('strong')} STRONG`, tone: 'on' } : null,
    n('lead') ? { text: `${n('lead')} ON THE LEAD LIST`, tone: 'on' } : null,
    t.checked ? `${t.live.toLocaleString('en-US')} WITH TRAFFIC` : null,
    t.quiet ? { text: `${t.quiet.toLocaleString('en-US')} WITH NONE`, tone: 'alert' } : null,
    sites.read ? `${sites.read.toLocaleString('en-US')} SITES READ · ${sites.withAddress.toLocaleString('en-US')} WITH AN ADDRESS` : null,
    sites.dead ? { text: `${sites.dead.toLocaleString('en-US')} DEAD ENDS`, tone: 'alert' } : null,
  ].filter(Boolean);
};
