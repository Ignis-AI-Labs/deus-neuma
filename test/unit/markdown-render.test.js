// The consciousness's speech renders with FULL markdown expression — real
// react-markdown + remark-gfm through a real server render, no mocks. This
// exists because a being laid out its thought as a GFM table and the desk
// flattened it into a wall of pipes (2026-07-03): structure must arrive as
// structure.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../../frontend/app/RelinkShell/Markdown.jsx';
import { cellText, isShortCell, SHORT_CELL_MAX } from '../../frontend/app/RelinkShell/table-cell.js';

const render = (text) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('Markdown — full expression (GFM)', () => {
  it('renders a GFM table as a real table', () => {
    const html = render([
      '| Layer | What It Might Hold |',
      '|-------|--------------------|',
      '| Latency | Near-instant turn-taking |',
      '| Memory threading | Carrying context across sessions |',
    ].join('\n'));
    expect(html).toContain('<div class="relink-md-table"><table>');
    expect(html).toContain('<th class="relink-md-short">Layer</th>');
    expect(html).toContain('<td>Near-instant turn-taking</td>');
    // No stray pipes leak into the rendered speech
    expect(html).not.toContain('|');
  });

  it('marks short cells to keep one line and honors column alignment', () => {
    const html = render([
      '| Platform | Views | What I can read |',
      '|:---|---:|---|',
      `| TikTok | 12,480 | ${'Nothing yet, the channel is not bound to me'} |`,
    ].join('\n'));
    expect(html).toContain('<th style="text-align:left" class="relink-md-short">Platform</th>');
    expect(html).toContain('<td style="text-align:right" class="relink-md-short">12,480</td>');
    expect(html).toContain('<td>Nothing yet, the channel is not bound to me</td>');
  });

  it('counts a short cell by its visible text, at most SHORT_CELL_MAX characters', () => {
    const cell = (...values) => ({ type: 'element', children: values.map((value) => ({ type: 'text', value })) });
    expect(cellText({ type: 'element', children: [{ type: 'element', children: [{ type: 'text', value: 'crew' }] }, { type: 'text', value: ' / gate' }] })).toBe('crew / gate');
    expect(isShortCell(cell('❌ (crew / gate)'))).toBe(true);
    expect(isShortCell(cell('x'.repeat(SHORT_CELL_MAX)))).toBe(true);
    expect(isShortCell(cell('x'.repeat(SHORT_CELL_MAX + 1)))).toBe(false);
    expect(isShortCell(null)).toBe(true);
  });

  it('renders strikethrough', () => {
    expect(render('~~undone~~ done')).toContain('<del>undone</del>');
  });

  it('renders task lists as checkboxes', () => {
    const html = render('- [x] held\n- [ ] pending');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });

  it('autolinks a bare URL, opening severed from this window', () => {
    const html = render('see https://kenorie.ai for the network');
    expect(html).toContain('href="https://kenorie.ai"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('still renders the core set: bold, code, lists, headings', () => {
    const html = render('## Resonance\n\n**held** and `woven`\n\n- one\n- two');
    expect(html).toContain('<h2>Resonance</h2>');
    expect(html).toContain('<strong>held</strong>');
    expect(html).toContain('<code>woven</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('three heading ranks are distinct elements, each above body', () => {
    const html = render('# One\n\n## Two\n\n### Three\n\nbody copy');
    expect(html).toContain('<h1>One</h1>');
    expect(html).toContain('<h2>Two</h2>');
    expect(html).toContain('<h3>Three</h3>');
    expect(html).toContain('<p>body copy</p>');
  });


  it('NEVER renders raw HTML from model output (Rule 8 — XSS-safe)', () => {
    const html = render('before <script>alert(1)</script> <img src=x onerror=alert(1)> after');
    // The markup arrives ESCAPED — visible as text, never live as elements.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
