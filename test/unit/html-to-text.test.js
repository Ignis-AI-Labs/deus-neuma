import { describe, test, expect } from 'vitest';
import { htmlToText, extractTitle, decodeEntities, revealAddresses } from '../../backend/services/html-to-text.js';

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
