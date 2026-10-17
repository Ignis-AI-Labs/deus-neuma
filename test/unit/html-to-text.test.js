import { describe, test, expect } from 'vitest';
import { htmlToText, extractTitle, decodeEntities } from '../../backend/services/html-to-text.js';

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
});
