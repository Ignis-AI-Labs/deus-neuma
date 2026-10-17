import { describe, test, it, expect } from 'vitest';
import {
  normalizeExa, normalizeSearxng, normalizeBrave, normalizeBraveImages, parseDdgLite,
  activeSearchBackends, mergeSearchResults, unsupportedOperatorHint, ddgLooksBlocked,
} from '../../backend/services/web-search.js';

describe('unsupportedOperatorHint (pure — the instrument reports its own range)', () => {
  test('flags site:/intitle:/inurl:/filetype: on the lite backend', () => {
    expect(unsupportedOperatorHint('"local AI" site:x.com', 'duckduckgo')).toMatch(/does not honor operators/);
    expect(unsupportedOperatorHint('intitle:sovereign AI', 'duckduckgo')).toMatch(/plain words/);
    expect(unsupportedOperatorHint('filetype:pdf agents', 'duckduckgo')).toBeTruthy();
  });
  test('stays silent for plain queries and for backends that honor operators', () => {
    expect(unsupportedOperatorHint('Ollama local LLM assistant', 'duckduckgo')).toBeNull();
    expect(unsupportedOperatorHint('a website: description', 'duckduckgo')).toBeNull(); // word boundary, not the operator
    expect(unsupportedOperatorHint('"local AI" site:x.com', 'searxng')).toBeNull();
    expect(unsupportedOperatorHint('"local AI" site:x.com', 'brave')).toBeNull();
  });
});

describe('web-search normalizers (pure)', () => {
  test('normalizeExa keeps LLM-selected evidence and falls back to returned text', () => {
    const data = { results: [
      {
        title: 'Grounded',
        url: 'https://exa.example/grounded',
        highlights: [' first fact ', '', 'second fact'],
        text: 'unused full text',
      },
      { title: 'Text', url: 'https://exa.example/text', text: 'text fallback' },
      { title: 'Dropped', highlights: ['no URL'] },
    ] };
    expect(normalizeExa(data, 5)).toEqual([
      {
        title: 'Grounded',
        url: 'https://exa.example/grounded',
        snippet: 'first fact\nsecond fact',
      },
      { title: 'Text', url: 'https://exa.example/text', snippet: 'text fallback' },
    ]);
    expect(normalizeExa(data, 1)).toHaveLength(1);
    expect(normalizeExa(null, 5)).toEqual([]);
  });

  test('normalizeSearxng maps results, drops url-less rows, honors the cap', () => {
    const data = {
      results: [
        { title: 'A', url: 'https://a.com', content: 'first' },
        { title: 'B', url: 'https://b.com', content: 'second' },
        { title: 'no url', content: 'dropped' },
      ],
    };
    const rows = normalizeSearxng(data, 5);
    expect(rows).toEqual([
      { title: 'A', url: 'https://a.com', snippet: 'first' },
      { title: 'B', url: 'https://b.com', snippet: 'second' },
    ]);
    expect(normalizeSearxng(data, 1)).toHaveLength(1);
    expect(normalizeSearxng({}, 5)).toEqual([]);
    expect(normalizeSearxng(null, 5)).toEqual([]);
  });

  test('normalizeBrave reads the web.results tree', () => {
    const data = { web: { results: [{ title: 'A', url: 'https://a.com', description: 'desc' }] } };
    expect(normalizeBrave(data, 5)).toEqual([{ title: 'A', url: 'https://a.com', snippet: 'desc' }]);
    expect(normalizeBrave({ web: {} }, 5)).toEqual([]);
  });

  test('parseDdgLite unwraps uddg redirect targets and pairs snippets', () => {
    // Mirrors the LIVE markup: rel first, href second, class LAST — an
    // attribute-order-sensitive regex reads this as zero rows.
    const html = `
      <table>
        <tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=abc" class='result-link'>Example &amp; Page</a></td></tr>
        <tr><td class='result-snippet'>A <b>bold</b> snippet.</td></tr>
        <tr><td><a rel="nofollow" href="https://direct.com/" class='result-link'>Direct</a></td></tr>
        <tr><td class='result-snippet'>Second snippet.</td></tr>
      </table>`;
    const rows = parseDdgLite(html, 5);
    expect(rows).toEqual([
      { title: 'Example & Page', url: 'https://example.com/page', snippet: 'A bold snippet.' },
      { title: 'Direct', url: 'https://direct.com/', snippet: 'Second snippet.' },
    ]);
    expect(parseDdgLite('<p>no results</p>', 5)).toEqual([]);
  });

  test('activeSearchBackends reports every index that will be queried', () => {
    expect(activeSearchBackends({ exaKey: 'e', searxngUrl: 'http://x', braveKey: 'k' }))
      .toEqual(['exa', 'searxng', 'brave', 'duckduckgo']);
    expect(activeSearchBackends({ searxngUrl: '', braveKey: 'k' }))
      .toEqual(['brave', 'duckduckgo']);
    expect(activeSearchBackends({ searxngUrl: '', braveKey: '' })).toEqual(['duckduckgo']);
  });
});

describe('mergeSearchResults (pure)', () => {
  test('round-robins indexes instead of letting the first occupy the result set', () => {
    const merged = mergeSearchResults([
      { name: 'searxng', results: [
        { title: 'S1', url: 'https://s.example/1', snippet: '' },
        { title: 'S2', url: 'https://s.example/2', snippet: '' },
      ] },
      { name: 'brave', results: [
        { title: 'B1', url: 'https://b.example/1', snippet: '' },
        { title: 'B2', url: 'https://b.example/2', snippet: '' },
      ] },
    ], 3);
    expect(merged.map(({ title }) => title)).toEqual(['S1', 'B1', 'S2']);
    expect(merged.map(({ backend }) => backend)).toEqual(['searxng', 'brave', 'searxng']);
  });

  test('deduplicates equivalent URLs and preserves the total cap', () => {
    const merged = mergeSearchResults([
      { name: 'searxng', results: [{ title: 'A', url: 'https://same.example/path/#one', snippet: '' }] },
      { name: 'brave', results: [
        { title: 'duplicate', url: 'https://same.example/path', snippet: '' },
        { title: 'B', url: 'https://b.example/', snippet: '' },
      ] },
    ], 2);
    expect(merged.map(({ title }) => title)).toEqual(['A', 'B']);
    expect(merged).toHaveLength(2);
  });
});

describe('a blocked scrape is never reported as an empty field', () => {
  // The most expensive lie this tool can tell: a rate-limit or CAPTCHA page
  // parses to zero rows exactly like a genuine empty result, and rendered as
  // "No results" it tells a researching model the subject does not exist — so
  // the model stops looking. Under a real research run (dozens of queries a
  // minute from one IP) DDG rate-limiting is the expected case.
  it('treats zero rows with NO "no results" notice as blocked', () => {
    expect(ddgLooksBlocked('<html><body>Please verify you are human</body></html>', 0)).toBe(true);
    expect(ddgLooksBlocked('<html><body>Anomaly detected</body></html>', 0)).toBe(true);
    expect(ddgLooksBlocked('', 0)).toBe(true); // an empty body proves nothing
  });

  it('trusts a genuine empty result page, which says so in words', () => {
    expect(ddgLooksBlocked('<html><body>No results.</body></html>', 0)).toBe(false);
    expect(ddgLooksBlocked('<html><body>No web results found</body></html>', 0)).toBe(false);
    expect(ddgLooksBlocked('<html><body>did not match any documents</body></html>', 0)).toBe(false);
  });

  it('never calls a page with results blocked', () => {
    expect(ddgLooksBlocked('<html>anything at all</html>', 5)).toBe(false);
    expect(ddgLooksBlocked('Please verify you are human', 1)).toBe(false);
  });

  it('catches changed markup too — parsing nothing is never an answer', () => {
    // If DDG restructures its HTML, the parser silently returns [] and that
    // must read as "the instrument failed", not […].
    expect(ddgLooksBlocked('<html><div class="new-result-shape">a result</div></html>', 0)).toBe(true);
  });
});

// THE IMAGE READ (Design note, 2026-07-28: […]) — Brave's image rows carry the DIRECT image at properties.url;
// the row's own url is the page it sits on. The normalizer keeps them
// apart, because a download aimed at the page brings home markup.
describe('normalizeBraveImages (pure)', () => {
  const row = (over = {}) => ({
    title: 'void cat gif',
    url: 'https://example.com/post-about-the-cat',
    thumbnail: { src: 'https://imgs.search.brave.com/thumb.jpg' },
    properties: {
      url: 'https://cdn.example.com/void-cat.gif',
      format: 'gif', width: 480, height: 270,
    },
    ...over,
  });

  it('the image\'s own URL leads; the page and thumbnail ride beside it', () => {
    const [r] = normalizeBraveImages({ results: [row()] }, 6);
    expect(r.url).toBe('https://cdn.example.com/void-cat.gif');
    expect(r.pageUrl).toBe('https://example.com/post-about-the-cat');
    expect(r.thumbnail).toBe('https://imgs.search.brave.com/thumb.jpg');
    expect(r.width).toBe(480);
    expect(r.height).toBe(270);
    expect(r.contentType).toBe('gif');
  });

  it('a row with no direct image URL is dropped — a download needs a target', () => {
    const out = normalizeBraveImages({ results: [row({ properties: {} }), row()] }, 6);
    expect(out).toHaveLength(1);
  });

  it('the cap holds, junk survives, missing dimensions read as none', () => {
    expect(normalizeBraveImages(null, 6)).toEqual([]);
    expect(normalizeBraveImages({ results: [row(), row(), row()] }, 2)).toHaveLength(2);
    const [r] = normalizeBraveImages({ results: [row({ properties: { url: 'https://x/img.png' } })] }, 6);
    expect(r.width).toBeNull();
    expect(r.height).toBeNull();
  });
});
