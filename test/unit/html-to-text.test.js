import { performance } from 'node:perf_hooks';
import { describe, test, expect } from 'vitest';
import { htmlToText, extractTitle, decodeEntities, revealAddresses } from '../../backend/services/html-to-text.js';
import { interpretBody } from '../../backend/services/web-fetch.js';

describe('html-to-text.js', () => {
  test('drops script/style/template CONTENT, keeps the readable text', () => {
    const html = '<html><head><style>body{color:red}</style><title>Hi</title></head>'
      + '<body><script>alert(1)</script><template><b>x</b></template><p>Real words.</p></body></html>';
    const text = htmlToText(html);
    expect(text).toBe('Real words.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color');
  });

  test('block tags become line boundaries; inline tags vanish without gluing words', () => {
    const html = '<div>One <b>two</b></div><div>Three</div><p>Four<br>Five</p>';
    expect(htmlToText(html)).toBe('One two\nThree\nFour\nFive');
  });

  test('entities decode — named, decimal, hex; unknown named entities pass through', () => {
    expect(decodeEntities('&amp; &lt; &gt; &quot; &#39; &nbsp; &#65; &#x41; &bogus;'))
      .toBe('& < > " \'   A A &bogus;');
  });

  test('extractTitle reads and decodes the title, null when absent', () => {
    expect(extractTitle('<title> A &amp; B </title>')).toBe('A & B');
    expect(extractTitle('<p>none</p>')).toBeNull();
  });

  test('blank lines collapse and the cap truncates with a marker', () => {
    const html = '<p>a</p>\n\n\n\n<p>b</p>';
    expect(htmlToText(html)).toBe('a\nb');
    const long = `<p>${'x'.repeat(100)}</p>`;
    const capped = htmlToText(long, 40);
    expect(capped.endsWith('[… truncated]')).toBe(true);
    expect(capped.length).toBeLessThan(60);
  });

  test('an address the page publishes outside its words is read as published: Cloudflare-protected, or only in a mailto link', () => {
    // Cloudflare's form: the first byte is the key, every other byte the address XORed with it.
    const protect = (email, key = 0x5a) => [key, ...[...email].map((c) => c.charCodeAt(0) ^ key)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const hex = protect('team@venice.example');
    expect(htmlToText(`<p>Write to <a href="/cdn-cgi/l/email-protection#${hex}"><span class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</span></a> today</p>`)).toBe('Write to team@venice.example today');
    expect(htmlToText(`<p><a class="x" href="/cdn-cgi/l/email-protection#${hex}">Email support</a></p>`)).toBe('Email support team@venice.example');
    expect(htmlToText('<p><a href="mailto:hi%40x.example?subject=a">Email us</a> or <a href="mailto:jo@x.example">jo@x.example</a></p>')).toBe('Email us (hi@x.example) or jo@x.example');
    // Hex that does not decode to an address is left exactly as the page shows it: nothing is invented.
    expect(htmlToText('<span data-cfemail="zz">[email&#160;protected]</span> <span data-cfemail="5a3b38">x</span>')).toMatch(/^\[email.protected\] x$/);
    expect(revealAddresses('<p>plain</p>')).toBe('<p>plain</p>');
  });
});

// PR600 audit P6-125: a fetched page is a stranger's, read on the backend's one thread. Before the fix
// 100,000 `<` took 14 s and 200,000 took 57 s (the audit's run; 24,000 took 0.1 s here and grew with the
// square), and every lane and wallet route waited. Sizes: web_fetch's 200,000 kept characters, and its
// 1 MB body cap. The real functions, hostile pages, no mocks.
describe('a hostile page is read in one pass (P6-125)', () => {
  const LIMIT_MS = 1000;
  const fill = (unit, size) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
  const ms = (run) => { const started = performance.now(); run(); return performance.now() - started; };
  const UNITS = ['<', '<script ', '<script></style>', '<p ', '<a ', '<a href="', '<a href="mailto:x@y.z">', '<a href="mailto:x@y.z"></abbr>',
    '<span data-cfemail="', '<a href="/cdn-cgi/l/email-protection#', '<title>', '<title', '</ ', '&#x41', '<a>x</a>'];

  test.each([200_000, 1_000_000])('every reader, on every shape, at %i characters', (size) => {
    for (const unit of UNITS) {
      const page = fill(unit, size);
      expect(ms(() => htmlToText(page)), `htmlToText ${unit}`).toBeLessThan(LIMIT_MS);
      expect(ms(() => extractTitle(page)), `extractTitle ${unit}`).toBeLessThan(LIMIT_MS);
      expect(ms(() => revealAddresses(page)), `revealAddresses ${unit}`).toBeLessThan(LIMIT_MS);
      // one endless tag that does close: the page reads empty, so the shell-page patterns run on it
      expect(ms(() => interpretBody(`${page}>`, 'text/html', 200)), `interpretBody ${unit}`).toBeLessThan(LIMIT_MS);
    }
  });

  test('the words at the far end of a hostile page are still read, and its address still revealed', () => {
    const page = `${fill('<script ', 200_000)}></script>${fill('<a ', 200_000)}></a><p>Real words.</p><a href="mailto:jo@x.example">Email us</a><title>Late &amp; found</title>`;
    expect(htmlToText(page)).toBe('Real words.\nEmail us (jo@x.example) Late & found');
    expect(extractTitle(page)).toBe('Late & found');
  });

  test('tags read as they always did: unclosed blocks stay, a bare < is text, case and spacing do not matter', () => {
    expect(htmlToText('<SCRIPT>a()</ script ><P>One</P><Br/>Two')).toBe('One\nTwo');
    expect(htmlToText('<script>never closed <p>still read</p>')).toBe('never closed\nstill read');
    expect(htmlToText('<b>bold</b> goes, <> stays and 1 < 2')).toBe('bold goes, <> stays and 1 < 2');
    expect(htmlToText('<style>a{}</style><style>b{}</style>kept<svg><path/></svg>')).toBe('kept');
    expect(extractTitle('<title>open, never closed')).toBeNull();
    expect(extractTitle('<TITLE lang="en">Up</TITLE><title>second</title>')).toBe('Up');
  });

  test('a script-only shell page is still told apart from an empty one', () => {
    const shell = `<html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
    expect(interpretBody(shell, 'text/html', 200).wall).toContain('carried no readable text');
    expect(interpretBody('<html><body></body></html>', 'text/html', 200).wall).toBeNull();
  });
});
