// The official recency feeds, kept apart from their parser so source validation
// can read the same catalog without importing the citation-record cycle back.

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
].map((feed) => Object.freeze(feed)));
