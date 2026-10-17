/**
 * web_fetch must never let a cut, or a wall, read as the whole truth.
 *
 * Two silent lies were measured on 2026-07-27 against the real web:
 *   · a GitHub API response and a raw README each came back at exactly 20,000
 *     chars with `truncated: false` and no marker — amputated mid-sentence and
 *     indistinguishable from a complete document
 *   · reddit.com answered HTTP 200 with 0 chars of text and the title
 *     […] — reported as a successful read
 *     of an empty page, so a researching model concludes the source is empty
 *     rather than blocked
 *
 * Both are worse than a failed fetch: research built on a half-document nobody
 * knows is half cannot be corrected, because nothing looks wrong.
 *
 * WHY THIS TESTS A PURE FUNCTION AND NOT A SOCKET (RULE 0): `interpretBody` is
 * the whole decision, and it is pure — real inputs, real outputs, no mock
 * anywhere, which is exactly the one shape RULE 0 permits without a live path.
 * It cannot be driven through a local HTTP server because `web-guard.js`
 * rightly refuses loopback (a being fetching 127.0.0.1 would be a confused
 * deputy reading the platform's own control plane), and weakening that guard to
 * make a test convenient would be the trade this repo exists not to make. The
 * wired path over a real socket is covered by `web-tools-live.test.js`.
 */
import { describe, it, expect } from 'vitest';
import { interpretBody, interpretRefusal, WEB_TEXT_MAX } from '../../backend/services/web-fetch.js';

const html = (title, body) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

describe('a cut says it was cut', () => {
  it('marks an over-long non-HTML body', () => {
    const raw = `[${'"x",'.repeat(WEB_TEXT_MAX / 4 + 10)}"end"]`;
    expect(raw.length).toBeGreaterThan(WEB_TEXT_MAX); // the case is real before we assert on it
    const r = interpretBody(raw, 'application/json', 200);
    expect(r.overflowed).toBe(true);
    expect(r.text).toMatch(/\[… truncated\]$/);
    expect(r.text.length).toBeLessThan(raw.length);
  });

  it('leaves a complete body byte-for-byte intact and unflagged', () => {
    const raw = JSON.stringify({ ok: true, note: 'complete' });
    const r = interpretBody(raw, 'application/json', 200);
    expect(r.overflowed).toBe(false);
    expect(r.text).toBe(raw); // no marker, no slice
    expect(JSON.parse(r.text)).toEqual({ ok: true, note: 'complete' });
  });

  it('does not mark exactly-at-the-limit content as cut', () => {
    const raw = 'y'.repeat(WEB_TEXT_MAX);
    const r = interpretBody(raw, 'text/plain', 200);
    expect(r.overflowed).toBe(false);
    expect(r.text).toBe(raw);
  });
});

describe('a long page rides whole up to the ceiling', () => {
  // Was 20k: a long article lost its second half for good. The turn now keeps
  // an over-cap result retrievable, so the page's own text is not cut early.
  it('a 60k-char article and a 60k-char HTML page come back whole and unflagged', () => {
    const text = 'paragraph of a long article. '.repeat(2100);
    expect(text.length).toBeGreaterThan(60000);
    const plain = interpretBody(text, 'text/plain', 200);
    expect(plain).toMatchObject({ overflowed: false, text });
    const page = interpretBody(html('Long', `<p>${text}</p>`), 'text/html', 200);
    expect(page.text).toBe(text.trim());
  });
});

describe('a wall says it is a wall', () => {
  // Real challenge pages are tens of KB of markup carrying no prose — that
  // shape is the signal, so the fixtures carry it too.
  it('refuses an HTML 200 that carried no readable text, and names the tell', () => {
    const shell = `<div id="c">${'<span class="cf-t"></span>'.repeat(120)}</div>`;
    const r = interpretBody(html('Please wait for verification', shell), 'text/html', 200);
    expect(r.wall).toBeTruthy();
    expect(r.wall).toMatch(/no readable text/);
    expect(r.wall).toMatch(/bot-verification wall|JavaScript/);
    expect(r.wall).toContain('Please wait for verification');
  });

  it('treats a JS shell with no prose as a wall, not an empty source', () => {
    const shell = `<div id="root"></div><script>${'boot();'.repeat(400)}</script>`;
    const r = interpretBody(html('App', shell), 'text/html', 200);
    expect(r.wall).toBeTruthy();
  });

  it('treats a small framework root plus external script as a JS shell', () => {
    const raw = html('Client app', '<div id="root"></div><script src="/assets/app.js"></script>');
    expect(raw.length).toBeLessThan(2000);
    const r = interpretBody(raw, 'text/html', 200);
    expect(r.wall).toMatch(/builds itself with JavaScript/);
  });

  it('does NOT mistake a genuine page for a wall', () => {
    const body = `<article>${'This is a genuine sentence of content. '.repeat(20)}</article>`;
    const r = interpretBody(html('A Real Page', body), 'text/html', 200);
    expect(r.wall).toBeNull();
    expect(r.title).toBe('A Real Page');
    expect(r.text).toMatch(/genuine sentence of content/);
  });

  it('never calls a non-HTML body a wall — a small JSON reply is a real answer', () => {
    const r = interpretBody('{"count":0}', 'application/json', 200);
    expect(r.wall).toBeNull();
    expect(r.text).toBe('{"count":0}');
  });

  it('never calls a genuinely empty response a wall — there is nothing to be blocked', () => {
    const r = interpretBody('', 'text/html', 200);
    expect(r.wall).toBeNull();
  });

  // The regression that a bare text-length floor caused, kept as a fixture.
  // example.com is 559 bytes of markup extracting to 127 chars of real content;
  // an earlier threshold called it blocked and the live suite went red.
  it('never calls a SMALL genuine page a wall (the example.com shape)', () => {
    const raw = '<!doctype html><html><head><title>Example Domain</title></head><body>'
      + '<div><h1>Example Domain</h1><p>This domain is for use in documentation examples '
      + 'without needing permission. Avoid use in operations.</p><p><a href="/">Learn more</a>'
      + '</p></div></body></html>';
    expect(raw.length).toBeLessThan(2000); // a small page, by construction
    const r = interpretBody(raw, 'text/html', 200);
    expect(r.wall).toBeNull();
    expect(r.title).toBe('Example Domain');
    expect(r.text).toMatch(/documentation examples/);
  });

  it('still catches a wall that is markup-heavy and word-poor', () => {
    const raw = html('Just a moment…', `<div id="cf">${'<span class="x"></span>'.repeat(200)}</div>`);
    expect(raw.length).toBeGreaterThan(2000);
    const r = interpretBody(raw, 'text/html', 200);
    expect(r.wall).toBeTruthy();
  });
});

describe('a refusal explains itself', () => {
  // A non-200 used to be reported as a bare number with the body thrown away.
  // Told only "403", a researching model cannot tell a bot wall from a dead
  // link — and picks the wrong next move.
  it('surfaces the words a 403 page actually carried', () => {
    const body = html('Access denied', '<p>Please verify you are a human before continuing.</p>');
    const why = interpretRefusal(body, 'text/html');
    expect(why).toContain('Access denied');
    expect(why).toContain('verify you are a human');
  });

  it('reads a plain-text or JSON refusal too', () => {
    expect(interpretRefusal('{"error":"rate limit exceeded, retry in 60s"}', 'application/json'))
      .toContain('rate limit exceeded');
  });

  it('collapses whitespace so the reason reads as one line', () => {
    expect(interpretRefusal('too\n\n   many\t\trequests', 'text/plain')).toBe('too many requests');
  });

  it('returns null for a body with nothing to say, so no empty "it said:" is appended', () => {
    expect(interpretRefusal('', 'text/html')).toBeNull();
    expect(interpretRefusal('   \n  ', 'text/plain')).toBeNull();
    expect(interpretRefusal(html('', '<div></div>'), 'text/html')).toBeNull();
  });

  it('excerpts a long refusal rather than pasting a whole page into the turn', () => {
    const why = interpretRefusal('x'.repeat(5000), 'text/plain');
    expect(why.length).toBeLessThan(600);
    expect(why.endsWith('…')).toBe(true);
  });
});
