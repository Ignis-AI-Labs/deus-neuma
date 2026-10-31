// RECENCY FEEDS — the official sources the app itself searches for anything
// new on a legal question, and how their answers are read. Pure.
//
// Why the app searches, not the office (Design note, 2026-10-31: an answer from a
// legal office on this platform missed a six-week-old SEC exemptive order on
// its exact question, after saying it had looked. A search the office reports
// is a claim; a search the app runs is a record. Proven 2026-10-31: the
// Federal Register search below returns that order (FR 2026-19388) for the
// question's own words.
//
// Reach, measured 2026-10-31 through the app's page reader: the Federal
// Register API and legislation.gov.uk search the whole window; the regulators'
// news feeds hold only their latest items, so each result says how far back
// a feed reached. EUR-Lex refuses automated reads — EU coverage is the two EU
// feeds that answer, and the result says so.

import { squeeze, decodeEntities } from './citation-record.js';

export const RECENCY_DAYS = 120;
export const SWEEP_JURISDICTIONS = Object.freeze(['US', 'UK', 'EU']);

const FR_FIELDS = ['title', 'type', 'publication_date', 'document_number', 'html_url', 'abstract']
  .map((f) => `fields[]=${f}`).join('&');

export const RECENCY_FEEDS = Object.freeze([
  { id: 'federal-register', name: 'Federal Register (every US agency: rules, proposed rules, notices, orders)', jurisdiction: 'US', search: 'federal-register' },
  { id: 'sec-press', name: 'SEC press releases', jurisdiction: 'US', url: 'https://www.sec.gov/news/pressreleases.rss' },
  { id: 'cftc-press', name: 'CFTC press releases', jurisdiction: 'US', url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml' },
  { id: 'cftc-enforcement', name: 'CFTC enforcement actions', jurisdiction: 'US', url: 'https://www.cftc.gov/RSS/RSSENF/rssenf.xml' },
  { id: 'ftc-press', name: 'FTC press releases', jurisdiction: 'US', url: 'https://www.ftc.gov/feeds/press-release.xml' },
  { id: 'uk-legislation', name: 'legislation.gov.uk (UK Acts and statutory instruments)', jurisdiction: 'UK', search: 'uk-legislation' },
  { id: 'fca-news', name: 'FCA news and statements', jurisdiction: 'UK', url: 'https://www.fca.org.uk/news/rss.xml' },
  { id: 'esma-news', name: 'ESMA news', jurisdiction: 'EU', url: 'https://www.esma.europa.eu/rss.xml' },
  { id: 'edpb-news', name: 'EDPB news (GDPR)', jurisdiction: 'EU', url: 'https://www.edpb.europa.eu/feed/news_en' },
].map((f) => Object.freeze(f)));

export const EU_GAP = 'EUR-Lex and the Official Journal refuse automated reads: the app could not search them. Search the Official Journal yourself for this window.';

// Filings that are listed, never owed an answer: exchanges' routine rule
// filings and meeting notices outnumber everything else on most questions.
const LISTED_ONLY = /^(Self-Regulatory Organizations;|Sunshine Act Meetings?)/i;

/** The first day of the window, YYYY-MM-DD. Pure. */
export const windowStart = (today, days = RECENCY_DAYS) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

const phrase = (term) => (/\s/.test(term) ? `"${term}"` : term);

/** A term in US and UK spelling (tokenized / tokenised): the same law, two spellings. Pure. */
export const termVariants = (term) => [...new Set([
  term,
  term.replace(/iz(e|ed|es|ing|ation|ations)\b/gi, 'is$1'),
  term.replace(/is(e|ed|es|ing|ation|ations)\b/gi, 'iz$1'),
])];

/** The addresses one feed is read at for a sweep. Pure. */
export const feedUrls = (feed, terms, since, today) => {
  if (feed.search === 'federal-register') {
    return terms.flatMap(termVariants).map((t) => `https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest&${FR_FIELDS}&conditions[term]=${encodeURIComponent(phrase(t))}&conditions[publication_date][gte]=${since}`);
  }
  if (feed.search === 'uk-legislation') {
    const years = [];
    for (let y = Number(since.slice(0, 4)); y <= Number(today.slice(0, 4)); y += 1) years.push(y);
    return years.flatMap((y) => terms.flatMap(termVariants).map((t) => `https://www.legislation.gov.uk/all/${y}/data.feed?text=${encodeURIComponent(t)}`));
  }
  return [feed.url];
};

// pure — markup and entities out, one line of text.
const plain = (s) => decodeEntities(decodeEntities(String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (block, name) => (block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)) ?? [])[1] ?? '';
const isoDay = (s) => {
  const t = Date.parse(String(s ?? '').trim());
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/**
 * An RSS or Atom document's entries. Pure.
 * @returns {Array<{title: string, link: string, date: string|null, summary: string}>}
 */
export const parseFeed = (xml) => (String(xml ?? '').match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/g) ?? [])
  .map((b) => ({
    title: plain(tag(b, 'title')),
    link: plain(tag(b, 'link')) || ((b.match(/<link(?:(?!rel=)[^>])*href="([^"]+)"/) ?? b.match(/<link[^>]*href="([^"]+)"/) ?? [])[1] ?? ''),
    date: isoDay(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'dc:date') || tag(b, 'updated')),
    summary: plain(tag(b, 'description') || tag(b, 'summary')).slice(0, 300),
  }))
  .filter((e) => e.title);

/**
 * A Federal Register API answer's documents. Pure; throws on a body that is not its JSON.
 * @returns {{count: number, items: Array<Object>}}
 */
export const parseFederalRegister = (body) => {
  const doc = JSON.parse(body);
  return {
    count: Number(doc.count) || 0,
    items: (Array.isArray(doc.results) ? doc.results : []).map((d) => ({
      title: plain(d.title), link: String(d.html_url ?? ''), date: isoDay(d.publication_date),
      summary: plain(d.abstract).slice(0, 300), kind: String(d.type ?? ''),
      ref: `FR ${d.document_number}`, key: squeeze(d.document_number),
    })),
  };
};

/** Does an entry speak to any of the terms? Pure. */
export const matchesTerms = (entry, terms) => {
  const text = squeeze(`${entry.title} ${entry.summary ?? ''}`);
  return terms.flatMap(termVariants).some((t) => text.includes(squeeze(t)));
};

/** One found entry as the sweep keeps it. Pure. */
export const foundItem = (feed, entry) => ({
  feed: feed.id, source: feed.name, jurisdiction: feed.jurisdiction,
  title: entry.title, link: entry.link, date: entry.date, kind: entry.kind ?? null,
  summary: entry.summary ?? '',
  ref: entry.ref ?? entry.title, key: entry.key ?? squeeze(entry.title),
  owed: !LISTED_ONLY.test(entry.title),
});

/** Owed items the office's account names neither by number, title nor address. Pure. */
export const unaddressed = (items, recencyText) => {
  const said = squeeze(recencyText);
  return items.filter((i) => i.owed && !said.includes(i.key) && !(i.link && said.includes(squeeze(i.link))));
};
