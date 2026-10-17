import { describe, test, expect } from 'vitest';
import {
  normalizePageBreaks, expandBoxes, pressBody
} from '../../backend/services/doc-press/markdown-press.js';
import { DEFAULT_KIT } from '../../backend/services/doc-press/brand-kit.js';

// A kit with icon logos loaded, as brand-kit.js would produce it.
const iconKit = {
  ...DEFAULT_KIT,
  logos: { primary: 'p.svg', badge: 'b.svg', star: 's.svg' },
  logoData: { primary: 'data:image/svg+xml;base64,AA==', badge: 'data:image/svg+xml;base64,BB==', star: 'data:image/svg+xml;base64,CC==' }
};

describe('normalizePageBreaks (pure)', () => {
  test('normalizes every page-break spelling to the marker div', () => {
    const out = normalizePageBreaks('a\n[PAGEBREAK]\nb\n<!--pagebreak-->\nc\n[page_break]\nd\n  [page-break]  \ne');
    expect((out.match(/class="page-break"/g) || []).length).toBe(4);
  });
  test('leaves ordinary text alone', () => {
    expect(normalizePageBreaks('the [PAGEBREAK] token mid-sentence stays')).toContain('the [PAGEBREAK] token');
  });
});

describe('expandBoxes (pure)', () => {
  test('expands a titled box and closes it', () => {
    const out = expandBoxes('::: summary The Gist\ninner **markdown**\n:::');
    expect(out).toContain('<div class="press-box press-summary">');
    expect(out).toContain('<div class="press-box-title">The Gist</div>');
    expect(out).toContain('</div>');
    expect(out).toContain('inner **markdown**');
  });
  test('escapes markup in box titles', () => {
    const out = expandBoxes('::: warning <script>x</script>\nbody\n:::');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
  test('unknown container types pass through untouched', () => {
    const src = '::: spoiler hidden\ntext\n:::';
    expect(expandBoxes(src)).toContain('::: spoiler hidden');
  });
  test('an unclosed box is closed at the end of the document', () => {
    const out = expandBoxes('::: note\ndangling');
    expect((out.match(/<\/div>/g) || []).length).toBe(1);
  });
});

describe('pressBody (pure)', () => {
  test('renders GFM tables', () => {
    const html = pressBody('| A | B |\n|---|---|\n| 1 | 2 |', DEFAULT_KIT);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });
  test('markdown inside boxes renders as markdown', () => {
    const html = pressBody('::: feature Big One\nSome **bold** text\n:::', DEFAULT_KIT);
    expect(html).toContain('press-box press-feature');
    expect(html).toContain('<strong>bold</strong>');
  });
  test('chartjs fences become SVG chart containers', () => {
    const spec = JSON.stringify({ type: 'bar', data: { labels: ['x'], datasets: [{ data: [1] }] } });
    const html = pressBody('```chartjs\n' + spec + '\n```', DEFAULT_KIT);
    expect(html).toContain('chart-container');
    expect(html).toContain('<svg');
  });
  test('pagebreak fences and markers become page-break divs', () => {
    const html = pressBody('a\n\n```pagebreak\n```\n\nb\n\n[PAGEBREAK]\n\nc', DEFAULT_KIT);
    expect((html.match(/class="page-break"/g) || []).length).toBe(2);
  });
  test('code fences get real syntax highlighting', () => {
    const html = pressBody('```js\nconst x = 1;\n```', DEFAULT_KIT);
    expect(html).toContain('hljs');
    expect(html).toContain('hljs-keyword');
  });
  test('icon placeholders become spans for kit logo keys (primary excluded)', () => {
    const html = pressBody('## @badge[Section badge] Heading\n\nInline @star here, @primary stays text.', iconKit);
    expect(html).toContain('press-icon press-icon-badge');
    expect(html).toContain('aria-label="Section badge"');
    expect(html).toContain('press-icon press-icon-star');
    expect(html).toContain('@primary');
  });
  test('icon placeholders inside code are never touched', () => {
    const html = pressBody('```\n@badge[not an icon]\n```\n\nAnd `@star` inline.', iconKit);
    expect(html).not.toContain('press-icon');
    expect(html).toContain('@badge[not an icon]');
  });
  test('a kit with no logos renders @tokens as plain text', () => {
    const html = pressBody('Ping @badge[x]', DEFAULT_KIT);
    expect(html).toContain('@badge[x]');
    expect(html).not.toContain('press-icon');
  });
});
