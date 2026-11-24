// A SEARCH TOO WIDE TO BE AN AUDIENCE'S (Design note, 2026-11-21: […]).
//
// What went wrong, on the house's own records: a company search asked with loose words ("token, base, liquidity",
// match any) matched 118,423 companies, and the gather kept the first 1,327 — which a company database orders by
// how many addresses it holds, so what came back was Dentsu, IBM, Freddie Mac and Jet Aviation under an audience of
// crypto funds. About 2,900 of the house's 14,000 gathered companies came from thirteen such searches. The searches
// that did find the audience matched between 100 and 4,600.
//
// So a search that matches more than WIDE_MATCH companies keeps NOTHING: it does not describe an audience, and its
// first page is the biggest companies, not the right ones. The seat is told the count and how to narrow. A paid
// search stops after its first page, so a wide one costs one credit, not five. And what such searches already
// brought in can be passed over in one press — only the companies nobody has worked yet. PURE.
export const WIDE_MATCH = 10_000;

/** pure — whether a search's match count is too wide to be one audience's. A source that reports no count (0) is never judged. */
export const isWide = (matched) => Number(matched) > WIDE_MATCH;

const count = (n) => Number(n).toLocaleString('en-US');

/** pure — what the seat is told when its search was too wide: the count, why nothing was kept, how to narrow. */
export const wideRefusal = ({ matched, source, spent = 0 }) => `That search matched ${count(matched)} companies at ${source} — more than ${count(WIDE_MATCH)} is not this audience, it is a slice of the whole database, and what comes back first is whoever holds the most addresses (the biggest companies), not who fits. NOTHING WAS KEPT${spent ? ` (${spent} credit(s) spent on the look)` : ''}. Narrow it until it describes only the audience: name the industry the audience is in AND the words only they use (match: "all"; phrases such as "crypto venture capital", never single common words like "base", "token" or "fund" alone); cut sizes that cannot be them. With Hunter, look first for free with sales/discover and gather only once the count is under ${count(WIDE_MATCH)} and the first fifteen read as the audience. With a provider's keywords, a single common word ("token", "crypto", "base", "software") matches every company that mentions it: use phrases of two or three words that say what the company IS ("defi protocol", "decentralized exchange", "lending protocol"), which is what a search that worked looked like (measured 2026-11-24: 319 companies, 10 leads from the first 71 read).`;

/** pure — the same warning on a free look (sales/discover), before anything is gathered. */
export const wideLookWords = (matched) => (isWide(matched) ? `TOO WIDE: ${count(matched)} matches is more than ${count(WIDE_MATCH)} — a gather with these fields keeps nothing. Narrow it (the industry AND words only this audience uses, match: "all") and look again.` : null);

/**
 * pure — each too-wide search with the companies it brought: those gathered for the same audience from the same
 * source after the search before it and up to it (a gather writes its companies, then its search).
 * @param {Array<{segmentId: string, source: string, matched: number, gathered: number, asked?: string, at: string}>} searches
 * @param {Array<{domain: string, segmentId: string, source: string, gatheredAt: string}>} candidates
 * @returns {Array<{search: object, companies: object[]}>}
 */
export const wideFinds = (searches = [], candidates = []) => {
  const lanes = new Map();
  for (const s of [...searches].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const key = `${s.segmentId}\u0000${s.source}`;
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key).push(s);
  }
  const out = [];
  for (const [key, list] of lanes) {
    const mine = candidates.filter((c) => `${c.segmentId}\u0000${c.source}` === key);
    list.forEach((search, i) => {
      if (!isWide(search.matched) || !(search.gathered > 0)) return;
      const from = i ? String(list[i - 1].at) : '';
      const companies = mine.filter((c) => String(c.gatheredAt) > from && String(c.gatheredAt) <= String(search.at));
      if (companies.length) out.push({ search, companies });
    });
  }
  return out;
};

/** pure — whether nobody has worked a gathered company yet: not kept or passed, its site not read, not scored. */
export const untouched = (c) => !c.shortlist && !c.siteRead && c.state !== 'scored';

/** pure — the count the desk shows: how many too-wide searches there were, what they brought, and what of it still waits in FILTER. */
export const wideSummary = (searches, candidates) => {
  const finds = wideFinds(searches, candidates);
  const companies = finds.flatMap((f) => f.companies);
  return { searches: finds.length, companies: companies.length, left: companies.filter(untouched).length, limit: WIDE_MATCH };
};
