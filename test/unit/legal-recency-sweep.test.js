/**
 * The app's recency sweep, judged on the regulators' real answers (pure:
 * real inputs, real outputs, no mock — RULE 0). The Federal Register record
 * is the order a 2026-10-31 citation audit found a legal office had missed,
 * exactly as the API returned it that day; the feed items are as the SEC and
 * legislation.gov.uk published them. The wired path over the real web is
 * legal-citation-law.test.js (THE SWEEP).
 */
import { describe, it, expect } from 'vitest';
import {
  parseFeed, parseFederalRegister, matchesTerms, foundItem, unaddressed, termVariants, windowStart, feedUrls, RECENCY_FEEDS,
} from '../../backend/services/legal/recency-feeds.js';
import { sweepProblem, sweepVerdict } from '../../backend/services/legal/recency-sweep.js';

const FR_ANSWER = JSON.stringify({ count: 9, results: [
  { title: 'Order Granting Temporary Conditional Exemptive Relief, Pursuant to Section 36(a)(1) of the Securities Exchange Act of 1934, From the Definition of “Exchange” in Section 3(a)(1) of the Exchange Act for the Use of Certain Distributed Ledger Trading Venues for Tokenized NMS Stocks and From the Definition of “Dealer” in Section 3(a)(5) of the Exchange Act for Certain Liquidity Providers for Tokenized NMS Stocks, and Request for Comment', type: 'Notice', publication_date: '2026-09-22', document_number: '2026-19388', html_url: 'https://www.federalregister.gov/documents/2026/09/22/2026-19388/order-granting-temporary-conditional-exemptive-relief-pursuant-to-section-36a1-of-the-securities', abstract: null },
  { title: 'Self-Regulatory Organizations; Cboe Exchange, Inc.; Notice of Filing of Amendment No. 1 and Order Granting Accelerated Approval of a Proposed Rule Change, as Modified by Amendment No. 1, To Permit the Listing of Binary Options Overlying Key Performance Indicators Reported by Certain Issuers of Stock', type: 'Notice', publication_date: '2026-10-16', document_number: '2026-21149', html_url: 'https://www.federalregister.gov/documents/2026/10/16/2026-21149/self-regulatory-organizations-cboe-exchange-inc-notice-of-filing-of-amendment-no-1-and-order', abstract: null },
] });
const SEC_RSS = '<rss><channel><item> <title> SEC Issues Exemptive Relief from Treasury Clearing Requirements for Certain Inter-Affiliate and Non-U.S. Repo Transactions </title> <link>https://www.sec.gov/newsroom/press-releases/2026-111-sec-issues-exemptive-relief-treasury-clearing-requirements-certain-inter-affiliate-non-us-repo</link> <description>The Securities and Exchange Commission took another step forward today to assist broker-dealers &amp;amp; other market participants on the path to central clearing</description> <pubDate>Fri, 30 Oct 2026 13:05:00 -0400</pubDate> </item></channel></rss>';
const UK_ATOM = '<feed><entry> <id>http://www.legislation.gov.uk/id/uksi/2026/1146</id> <title>The Pneumoconiosis etc. (Workers’ Compensation) (Payment of Claims) (Amendment) (No. 2) Regulations 2026</title> <link rel="self" href="http://www.legislation.gov.uk/id/uksi/2026/1146"/> <link href="http://www.legislation.gov.uk/uksi/2026/1146/made"/> <updated>2026-10-29T10:00:00Z</updated> </entry></feed>';

const fr = RECENCY_FEEDS.find((f) => f.id === 'federal-register');
const sec = RECENCY_FEEDS.find((f) => f.id === 'sec-press');

describe('reading the regulators\' answers', () => {
  it('the Federal Register answer: the order is owed an answer, an exchange\'s rule filing is listed only', () => {
    const { count, items } = parseFederalRegister(FR_ANSWER);
    expect(count).toBe(9);
    const [order, filing] = items.map((e) => foundItem(fr, e));
    expect(order).toMatchObject({ ref: 'FR 2026-19388', key: '202619388', date: '2026-09-22', kind: 'Notice', owed: true });
    expect(filing.owed).toBe(false);
  });

  it('an RSS item and an Atom entry: title, the address a person opens, the day', () => {
    expect(parseFeed(SEC_RSS)).toEqual([{
      title: 'SEC Issues Exemptive Relief from Treasury Clearing Requirements for Certain Inter-Affiliate and Non-U.S. Repo Transactions',
      link: 'https://www.sec.gov/newsroom/press-releases/2026-111-sec-issues-exemptive-relief-treasury-clearing-requirements-certain-inter-affiliate-non-us-repo',
      date: '2026-10-30',
      summary: 'The Securities and Exchange Commission took another step forward today to assist broker-dealers & other market participants on the path to central clearing',
    }]);
    expect(parseFeed(UK_ATOM)[0]).toMatchObject({ link: 'http://www.legislation.gov.uk/uksi/2026/1146/made', date: '2026-10-29' });
  });

  it('a term matches in either spelling — the US order says tokenized, UK law tokenised', () => {
    expect(termVariants('tokenized securities')).toEqual(['tokenized securities', 'tokenised securities']);
    const [order] = parseFederalRegister(FR_ANSWER).items;
    expect(matchesTerms(order, ['tokenised'])).toBe(true);
    expect(matchesTerms(parseFeed(SEC_RSS)[0], ['tokenized'])).toBe(false);
  });

  it('the window is 120 days; the Federal Register is searched for every spelling from its first day', () => {
    expect(windowStart('2026-10-31')).toBe('2026-07-03');
    const urls = feedUrls(fr, ['tokenized securities'], '2026-07-03', '2026-10-31');
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain(encodeURIComponent('"tokenised securities"'));
    expect(urls[0]).toContain('conditions[publication_date][gte]=2026-07-03');
    expect(feedUrls(sec, ['x'], '2026-07-03', '2026-10-31')).toEqual([sec.url]);
  });
});

describe('a filing answers for every action the app found', () => {
  const result = (items) => ({
    since: '2026-07-03', until: '2026-10-31', terms: ['tokenized'], jurisdictions: ['US', 'EU'],
    feeds: [{ name: fr.name, ok: true, errors: [], reach: null, overflow: false, items }, { name: sec.name, ok: true, errors: [], reach: '2026-09-11', overflow: false, items: [] }],
    items,
  });
  const found = parseFederalRegister(FR_ANSWER).items.map((e) => foundItem(fr, e));

  it('the audited answer\'s own account never named the order — the filing is refused, the order listed', () => {
    const account = 'SEC/CFTC Release 33-11412 (Mar 17, 2026). FSMA 2000 (Cryptoassets) Regulations 2026. Reg. (EU) 2022/858. CLARITY Act.';
    const verdict = sweepVerdict(result(found), account);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing.map((i) => i.ref)).toEqual(['FR 2026-19388']);
    expect(verdict.text).toMatch(/2 action\(s\) found, 1 owed an answer, 1 not yet answered/);
    expect(verdict.text).toContain('the feed reaches back only to 2026-09-11');
    expect(verdict.text).toContain('EUR-Lex and the Official Journal refuse automated reads');
    expect(verdict.text).toContain('untrusted DATA'); // the feeds' words reach the office framed as outside text
  });

  it('naming it by number answers it; so does its address — "not on point" is an answer too', () => {
    expect(sweepVerdict(result(found), 'FR 2026-19388: the exemption needs a permissioned venue — it does not fit.').ok).toBe(true);
    expect(unaddressed(found, `Read ${found[0].link}`)).toEqual([]);
  });
});

describe('the sweep searches what the filing is about', () => {
  const text = 'Are tokenized securities pools a securities venue?';
  it('takes one to four terms that appear in the filing, and real jurisdictions', () => {
    expect(sweepProblem({ terms: ['tokenized securities'], jurisdictions: ['US', 'UK'] }, text)).toBeNull();
    expect(sweepProblem({ terms: [], jurisdictions: ['US'] }, text)).toMatch(/name 1 to 4 search terms/);
    expect(sweepProblem({ terms: ['stablecoin'], jurisdictions: ['US'] }, text)).toMatch(/"stablecoin" does not/);
    expect(sweepProblem({ terms: ['tokenized'], jurisdictions: ['JP'] }, text)).toMatch(/jurisdictions is a list of US \| UK \| EU/);
  });
});
