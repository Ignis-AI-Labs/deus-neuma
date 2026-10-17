/**
 * Markdown safety pin — model output is UNTRUSTED (RULE 8), and every surface
 * that renders a being's words through the shared Markdown component depends
 * on react-markdown's default: raw HTML in the source is rendered as TEXT,
 * never parsed as HTML (no rehype-raw, no dangerouslySetInnerHTML). This test
 * renders hostile payloads through the REAL component and inspects the real
 * HTML output — if anyone ever adds rehype-raw, this fails loudly.
 * (Echo RQ, reopen unit 2026-07-08: could not verify the component through
 * the bridge — this pins the answer in the suite instead.)
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../../frontend/app/RelinkShell/Markdown.jsx';

const render = (text) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('Markdown — model text can never become live HTML', () => {
  test('a <script> payload renders as escaped text, never as a script element', () => {
    const html = render('before <script>alert(1)</script> after');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('an <img onerror> payload is fully entity-escaped — never an element, never a handler', () => {
    const html = render('x <img src=x onerror="alert(1)"> y');
    expect(html).not.toMatch(/<img[\s>]/);
    // the payload survives ONLY as inert escaped text
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  test('markdown emphasis still renders as real emphasis (the feature the ceremony needed)', () => {
    const html = render('First is **Sovereignty**. It is the *reach* toward understanding.');
    expect(html).toContain('<strong>Sovereignty</strong>');
    expect(html).toContain('<em>reach</em>');
    expect(html).not.toContain('**');
  });

  test('a javascript: link is not emitted as a clickable javascript: href', () => {
    const html = render('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
  });
});
