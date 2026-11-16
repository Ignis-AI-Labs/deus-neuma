/**
 * EACH GATHERED COMPANY'S OWN SITE, READ IN BULK — Design note, 2026-11-16: […]
 *
 * Rule 0: a real HTTP server on this machine serving real pages (a home page, a contact page, a
 * protected address, a redirect, a 404), read by the real reader and kept in the real revenue office on
 * tmp disk. The platform's web guard refuses this machine's own address by design, so the pages are
 * handed to the reader by a plain request here; the guard itself is driven for real against loopback.
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { useTempRealm } from '../helpers/temp-realm.js';
import { describedAs, addressesOn, socialsOn, morePages, siteLine, readCompanySite, readSites, guardedPage, READ_MAX } from '../../backend/services/sales/company-reader.js';
import { readAudienceSites } from '../../backend/services/sales/site-reads.js';
import { addCandidates, readCandidates } from '../../backend/services/sales/sales-store.js';
import { foldContacts } from '../../backend/services/sales/contact-book.js';
import { companyRows, contactShort, isDeadEnd, readCount, companiesLine, pageOf } from '../../frontend/app/RelinkShell/company-line/audience-companies-view.js';

const WALLET = '0x00000000000000000000000000000000000000c1';
// "hello@harbor.example" as Cloudflare protects it: the key byte, then each character XOR the key.
const cf = (email, key = 0x2a) => [key, ...[...email].map((c) => c.charCodeAt(0) ^ key)].map((b) => b.toString(16).padStart(2, '0')).join('');
const HOME = `<!doctype html><html><head><title>Harbor &amp; Co — field apps</title>
<meta name="description" content="Harbor builds field apps for marine surveyors: inspections filed from the dock.">
</head><body>
<a href="/contact">Contact</a> <a href="/about-us#team">About</a> <a href="/blog/contact-lenses.pdf">pdf</a> <a href="https://elsewhere.example/contact">other</a>
<a href="https://twitter.com/harborapp">X</a> <a href="https://twitter.com/intent/tweet?x=1">share</a> <a href="https://www.linkedin.com/company/harbor-co/">in</a> <a href="https://github.com/harbor-co/app">code</a>
<a href="/cdn-cgi/l/email-protection#${cf('hello@harbor.example')}">write</a> <img src="logo@2x.png"> widget@vendor-widgets.example
</body></html>`;
const CONTACT = '<html><head><title>Contact</title></head><body><a href="mailto:Ada@harbor.example?subject=hi">Ada</a> or harbor.studio@fastmail.com, never name@example.com</body></html>';

let server; let base;
const served = [];
// The reader asks for https://<domain>/…; this serves each domain's pages from the one local server.
const fetchPage = async (url) => {
  const u = new URL(url);
  served.push(`${u.hostname}${u.pathname}`);
  const res = await fetch(`${base}/${u.hostname}${u.pathname}`, { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) return fetchPage(res.headers.get('location'));
  return res.status === 200 ? { ok: true, url, html: await res.text() } : { ok: false, why: `it answered ${res.status}` };
};

beforeAll(async () => {
  useTempRealm();
  server = http.createServer((req, res) => {
    const page = { '/harbor.example/': HOME, '/harbor.example/contact': CONTACT, '/harbor.example/about-us': '<html><body>We are two people.</body></html>', '/bare.example/': '<html><head><title>Bare</title></head><body>hi</body></html>', '/newowner.example/': '<html><head><title>New Owner</title></head><body>x</body></html>' }[req.url];
    if (req.url === '/sold.example/') { res.writeHead(301, { location: 'https://newowner.example/' }); return res.end(); }
    if (!page) { res.writeHead(404); return res.end('gone'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(page);
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => { server.close(resolve); }));

describe('reading a page (pure)', () => {
  test('what it says it is, the addresses that are its own, its socials, and its own contact pages', () => {
    expect(describedAs(HOME)).toBe('Harbor builds field apps for marine surveyors: inspections filed from the dock.');
    expect(describedAs('<meta property="og:description" content=\'Second kind of tag, long enough\'>')).toBe('Second kind of tag, long enough');
    expect(describedAs('<meta name="description" content="short">')).toBe('');
    // The protected address is decoded; an image name, a vendor's address and a placeholder are never kept.
    expect(addressesOn(HOME, 'harbor.example')).toEqual(['hello@harbor.example']);
    expect(addressesOn(CONTACT, 'harbor.example')).toEqual(['ada@harbor.example', 'harbor.studio@fastmail.com']);
    expect(socialsOn(HOME)).toEqual({ x: 'https://x.com/harborapp', linkedin: 'https://www.linkedin.com/company/harbor-co', github: 'https://github.com/harbor-co' });
    expect(morePages(HOME, 'https://harbor.example/')).toEqual(['https://harbor.example/contact', 'https://harbor.example/about-us']);
  });
});

describe('reading a company', () => {
  test('alive: its own words, every address with the page it stands on, from the home page and two more', async () => {
    served.length = 0;
    const site = await readCompanySite('harbor.example', { fetchPage, now: () => 'NOW' });
    expect(site).toEqual({
      alive: true, title: 'Harbor & Co — field apps', description: 'Harbor builds field apps for marine surveyors: inspections filed from the dock.',
      emails: [{ email: 'hello@harbor.example', page: 'https://harbor.example/' }, { email: 'ada@harbor.example', page: 'https://harbor.example/contact' }, { email: 'harbor.studio@fastmail.com', page: 'https://harbor.example/contact' }],
      socials: { x: 'https://x.com/harborapp', linkedin: 'https://www.linkedin.com/company/harbor-co', github: 'https://github.com/harbor-co' },
      movedTo: null, pagesRead: 3, readAt: 'NOW',
    });
    expect(served).toEqual(['harbor.example/', 'harbor.example/contact', 'harbor.example/about-us']);
    expect(siteLine('harbor.example', site)).toMatch(/^harbor\.example — ALIVE — Harbor builds field apps.* — publishes hello@harbor\.example, ada@harbor\.example, harbor\.studio@fastmail\.com — /);
  });

  test('a dead site is a dead end with why; a site that says nothing still counts as alive; a sold one is named', async () => {
    expect(await readCompanySite('gone.example', { fetchPage, now: () => 'NOW' })).toEqual({ alive: false, why: 'it answered 404', readAt: 'NOW' });
    expect(siteLine('gone.example', { alive: false, why: 'it answered 404' })).toBe('gone.example — NO SITE: it answered 404');
    expect(await readCompanySite('bare.example', { fetchPage })).toMatchObject({ alive: true, description: 'Bare', emails: [], socials: {}, pagesRead: 1 });
    expect(await readCompanySite('sold.example', { fetchPage })).toMatchObject({ alive: true, movedTo: 'newowner.example' });
    expect((await readSites(['harbor.example', 'gone.example', 'bare.example'], { fetchPage, concurrency: 2 })).map((r) => [r.domain, r.site.alive])).toEqual([['harbor.example', true], ['gone.example', false], ['bare.example', true]]);
    expect(READ_MAX).toBe(60);
  });

  test('the real guard never reads this machine: a company\'s "site" at a private address is refused', async () => {
    expect(await guardedPage(`${base}/harbor.example/`)).toEqual({ ok: false, why: 'the address was refused (forbidden-host)' });
    expect(await guardedPage('ftp://harbor.example/')).toMatchObject({ ok: false });
  });
});

describe('an audience\'s gathered companies are read once, kept, and shown', () => {
  test('the most visited unread ones are read; what was read stays with the company and fills the list', async () => {
    const row = (domain, name, trafficRank) => ({ source: 'company-index', domain, name, description: '', signal: '1-10 people', categories: ['computer software'], country: 'US', size: '1-10', trafficRank });
    await addCandidates(WALLET, 's-1', [row('gone.example', 'Gone', null), row('harbor.example', 'Harbor', 5000), row('bare.example', 'Bare', 90000)], 'merc');
    await addCandidates(WALLET, 's-2', [row('other.example', 'Other Audience', 1)], 'merc');

    const said = [];
    const first = await readAudienceSites(WALLET, 's-1', { count: 2, by: 'operator', fetchPage, onProgress: (words) => said.push(words) });
    expect(said.at(-1)).toMatch(/^2 of 2 sites read — 2 alive, last /);
    expect(first.ok && first.read.map((r) => r.domain)).toEqual(['harbor.example', 'bare.example']);
    expect(first.left).toBe(1);
    const second = await readAudienceSites(WALLET, 's-1', { by: 'merc', fetchPage });
    expect(second.read.map((r) => [r.domain, r.site.alive])).toEqual([['gone.example', false]]);
    expect(await readAudienceSites(WALLET, 's-1', { by: 'merc', fetchPage })).toEqual({ ok: false, reason: 'every company gathered for this audience and not yet scored has already been read' });

    const kept = (await readCandidates(WALLET)).filter((c) => c.segmentId === 's-1');
    const harbor = kept.find((c) => c.domain === 'harbor.example');
    expect(harbor.description).toBe('Harbor builds field apps for marine surveyors: inspections filed from the dock.');
    expect(harbor.site.emails).toHaveLength(3);
    expect((await readCandidates(WALLET)).find((c) => c.domain === 'other.example').site).toBeUndefined();

    // The list: what it is, how to reach it, and the dead end named and hidden on a press.
    const rows = companyRows({ gathered: kept });
    expect(rows.map((r) => [r.domain, contactShort(r), isDeadEnd(r)])).toEqual([['harbor.example', 'hello@harbor.example +2', false], ['bare.example', 'NO ADDRESS ON ITS SITE', false], ['gone.example', 'NO SITE', true]]);
    expect(rows[0].about).toBe(harbor.description);
    expect(readCount(rows)).toEqual({ read: 3, dead: 1, unread: 0, withAddress: 1 });
    expect(companiesLine(rows)).toEqual(['3 COMPANIES', '3 NOT SCORED YET', '2 WITH TRAFFIC', { text: '1 WITH NONE', tone: 'alert' }, '3 SITES READ · 1 WITH AN ADDRESS', { text: '1 DEAD ENDS', tone: 'alert' }]);
    expect(pageOf(rows, { liveOnly: true }).rows.map((r) => r.domain)).toEqual(['harbor.example', 'bare.example']);

    // The contact book gains every address a company publishes, with the page it stands on.
    const book = foldContacts({ candidates: kept });
    expect(book.map((c) => [c.email, c.company, c.state, c.source])).toEqual([['hello@harbor.example', 'Harbor', 'published', 'https://harbor.example/'], ['ada@harbor.example', 'Harbor', 'published', 'https://harbor.example/contact'], ['harbor.studio@fastmail.com', 'Harbor', 'published', 'https://harbor.example/contact']]);
  });
});
