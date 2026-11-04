/**
 * LEGAL RESEARCH APIS (legal/legal-research-api.js) — the official legal databases
 * that take a key, reached by the CLO office without it ever holding the key.
 * The request builder and scrubber are pure; the live calls go to the REAL APIs
 * (CourtListener needs its free token, search included, since 2026-11; Congress.gov
 * takes the public DEMO_KEY). No mocks (RULE 0) — and no network unless summoned:
 * a unit lane never depends on a third party answering. RUN_LEGAL_API_LIVE=1 runs
 * them; the CourtListener call also needs COURTLISTENER_API_TOKEN.
 */
import { describe, expect, test } from 'vitest';
import { LEGAL_APIS, buildRequest, callLegalApi, safeApiPath, scrubKey } from '../../backend/services/legal/legal-research-api.js';

const KEYS = { 'api-data-gov': 'adg-secret-123456', courtlistener: 'cl-secret-abcdef', openstates: 'os-secret-987654' };
const keyFor = (id) => KEYS[id] || '';
const none = () => '';

describe('only the API\'s own host, ever', () => {
  test('a path is a path on the API, nothing else', () => {
    for (const ok of ['/v3/bill', '/bills', '/search/', '/v4/documents?filter[searchTerm]=x']) expect(safeApiPath(ok), ok).toBe(true);
    for (const bad of ['//evil.example/x', 'https://evil.example', '/../../etc', '/a b', '/a#frag', '/@evil.example', 'v3/bill', null]) expect(safeApiPath(bad), String(bad)).toBe(false);
    expect(buildRequest({ api: 'congress', path: '//evil.example/steal' }, keyFor)).toMatchObject({ ok: false });
    expect(buildRequest({ api: 'evil' }, keyFor)).toMatchObject({ ok: false });
  });

  test('every API is an https official host', () => {
    for (const [id, spec] of Object.entries(LEGAL_APIS)) expect(spec.base, id).toMatch(/^https:\/\/(api\.congress\.gov|api\.govinfo\.gov|api\.regulations\.gov|www\.courtlistener\.com|v3\.openstates\.org)/);
  });
});

describe('the saved key, placed where each API wants it', () => {
  test('api.data.gov APIs take it as api_key; a caller cannot point it elsewhere or override it', () => {
    const r = buildRequest({ api: 'congress', path: '/v3/bill', query: { limit: 1, api_key: 'mine' } }, keyFor);
    expect(new URL(r.url).host).toBe('api.congress.gov');
    expect(new URL(r.url).searchParams.get('api_key')).toBe(KEYS['api-data-gov']);
  });
  test('CourtListener takes a Token header; Open States an X-API-KEY header', () => {
    expect(buildRequest({ api: 'courtlistener', path: '/search/', query: { q: 'x' } }, keyFor).init.headers.Authorization).toBe(`Token ${KEYS.courtlistener}`);
    expect(buildRequest({ api: 'openstates', path: '/bills' }, keyFor).init.headers['X-API-KEY']).toBe(KEYS.openstates);
  });
  test('the citation check posts the text, and needs the token', () => {
    const r = buildRequest({ api: 'citations', text: '129 F.3d 327' }, keyFor);
    expect(r).toMatchObject({ ok: true, init: { method: 'POST' } });
    expect(r.url).toBe('https://www.courtlistener.com/api/rest/v4/citation-lookup/');
    expect(buildRequest({ api: 'citations', text: '129 F.3d 327' }, none).ok).toBe(false);
  });
  test('no key saved: data.gov falls back to the public demo key, the rest (case-law search too) say where to save one', () => {
    const search = buildRequest({ api: 'courtlistener', path: '/search/' }, none);
    expect(search.ok).toBe(false);
    expect(search.error).toContain('Settings → API');
    expect(new URL(buildRequest({ api: 'govinfo', path: '/packages' }, none).url).searchParams.get('api_key')).toBe('DEMO_KEY');
    const missing = buildRequest({ api: 'openstates', path: '/bills' }, none);
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('Settings → API');
    expect(missing.error).toContain('https://');
  });
});

describe('scrubKey — the key never comes back', () => {
  test('raw and URL-encoded', () => {
    const key = 'k3y/with+special=chars';
    expect(scrubKey(`next: https://x/?api_key=${encodeURIComponent(key)} and ${key}`, key)).toBe('next: https://x/?api_key=<key> and <key>');
  });
});

const LIVE = process.env.RUN_LEGAL_API_LIVE === '1';
const COURTLISTENER_TOKEN = process.env.COURTLISTENER_API_TOKEN || '';

describe.skipIf(!LIVE)('the real APIs (RUN_LEGAL_API_LIVE=1)', () => {
  test.skipIf(!COURTLISTENER_TOKEN)('CourtListener case-law search answers with the saved token', async () => {
    const out = await callLegalApi({ api: 'courtlistener', path: '/search/', query: { q: '"member-managed"', type: 'o' } },
      { keyFor: (id) => (id === 'courtlistener' ? COURTLISTENER_TOKEN : '') });
    expect(out.ok, out.error).toBe(true);
    expect(out.text).toContain('"results"');
  }, 30_000);

  test('Congress.gov answers, and the key it echoes in its next-page links is scrubbed', async () => {
    const out = await callLegalApi({ api: 'congress', path: '/v3/bill', query: { format: 'json', limit: 2 } }, { keyFor: none });
    expect(out.ok, out.error).toBe(true);
    expect(out.text).toContain('"bills"');
    expect(out.text).not.toContain('DEMO_KEY');
  }, 30_000);
});
