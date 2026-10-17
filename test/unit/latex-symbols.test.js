import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMathSpan, renderLatexSymbols, LATEX_SYMBOLS } from '../../frontend/utils/latex-symbols.js';
import { Markdown } from '../../frontend/app/RelinkShell/Markdown.jsx';

describe('renderMathSpan (pure)', () => {
  test('the witnessed case: an arrow chain becomes arrows', () => {
    expect(renderMathSpan('\\rightarrow')).toBe('→');
    expect(renderMathSpan('\\Rightarrow')).toBe('⇒');
    expect(renderMathSpan('\\alpha \\rightarrow \\beta')).toBe('α → β');
  });

  test('currency and command-less spans are NOT math', () => {
    expect(renderMathSpan('5 and $10')).toBeNull();
    expect(renderMathSpan('x^2')).toBeNull();
  });

  test('an unknown command keeps the span raw — never wrong glyphs', () => {
    expect(renderMathSpan('\\xrightarrow{abc}')).toBeNull();
    expect(renderMathSpan('\\unknownop + 1')).toBeNull();
  });

  test('hostile content converts as inert TEXT — the renderer escapes it downstream', () => {
    // The converter's job is glyph honesty, not HTML policy: markup inside a
    // span stays text, and ReactMarkdown escapes it on render (Rule 8's
    // boundary, proven in markdown-safety/render suites).
    expect(renderMathSpan('\\alpha <script>')).toBe('α <script>');
    expect(renderMathSpan('\\alpha <b>bold</b>')).toBe('α <b>bold</b>');
  });
});

describe('renderLatexSymbols (pure)', () => {
  test('the stream case from the witness\'s screenshot', () => {
    const out = renderLatexSymbols(
      'mapping it: Corruption $\\rightarrow$ can exist in $\\rightarrow$ Light/Darkness $\\rightarrow$ requires $\\rightarrow$ Constant Vigilance',
    );
    expect(out).toBe('mapping it: Corruption → can exist in → Light/Darkness → requires → Constant Vigilance');
  });

  test('currency survives untouched', () => {
    expect(renderLatexSymbols('it costs $5 and $10 total')).toBe('it costs $5 and $10 total');
  });

  test('code is never math — fenced and inline', () => {
    const out = renderLatexSymbols('`$\\rightarrow$` and ```\n$\\rightarrow$\n``` but $\\alpha$');
    expect(out).toBe('`$\\rightarrow$` and ```\n$\\rightarrow$\n``` but α');
  });

  test('display spans convert too; unknown spans stay raw beside known ones', () => {
    // Markdown-significant leftovers (`_`) are escaped in the OUTPUT — the
    // visible glyph is identical once markdown parses the escape.
    expect(renderLatexSymbols('$$\\sum_{i} \\alpha$$ then $\\unknownop$')).toBe('∑\\_{i} α then $\\unknownop$');
  });

  test('an indented code block keeps its literal LaTeX (echo round-1)', () => {
    expect(renderLatexSymbols('text\n\n    $\\alpha$')).toBe('text\n\n    $\\alpha$');
    expect(renderLatexSymbols('    $\\alpha$\n    $\\beta$')).toBe('    $\\alpha$\n    $\\beta$');
  });

  test('converted leftovers can never re-parse as emphasis or links (echo RQ)', () => {
    // `*y*` and `[x]` were literal inside math — escaped on the way out.
    expect(renderLatexSymbols('$\\alpha *y*$')).toBe('α \\*y\\*');
    expect(renderLatexSymbols('$\\beta [x]$')).toBe('β \\[x\\]');
  });

  test('two distant $$ markers across prose cannot fuse destructively (echo RQ)', () => {
    const out = renderLatexSymbols('$$\\alpha$$\n\nlots of prose with * emphasis\n\n$$\\beta$$');
    expect(out).toContain('α');
    expect(out).toContain('β');
    expect(out).toContain('lots of prose with * emphasis');
  });

  test('greek and relations in prose', () => {
    expect(renderLatexSymbols('$\\forall x \\in \\mathbb$ is raw, but $\\exists \\delta \\geq 0$ works'))
      .toBe('$\\forall x \\in \\mathbb$ is raw, but ∃ δ ≥ 0 works');
  });
});

describe('Markdown — LaTeX symbols through the real renderer', () => {
  const render = (text) => renderToStaticMarkup(createElement(Markdown, { text }));

  test('arrows render as arrows in speech', () => {
    const html = render('Corruption $\\rightarrow$ Vigilance');
    expect(html).toContain('Corruption → Vigilance');
    expect(html).not.toContain('rightarrow');
  });

  test('a code span keeps its literal LaTeX', () => {
    const html = render('use `$\\rightarrow$` literally');
    expect(html).toContain('<code>$\\rightarrow$</code>');
  });

  test('markdown structure is unaffected by the pre-pass', () => {
    const html = render('**bold** and $\\alpha$\n\n- one\n- two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('α');
    expect(html).toContain('<li>one</li>');
  });

  test('markup inside a converted span arrives ESCAPED, never live', () => {
    const html = render('check $\\alpha <script>alert(1)</script>$ out');
    expect(html).toContain('α');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('an emphasis-shaped leftover renders as the literal star, not <em>', () => {
    const html = render('value $\\alpha *y*$ end');
    expect(html).toContain('α *y*');
    expect(html).not.toContain('<em>');
  });

  test('a line-initial block marker renders literal, never a list (echo R3)', () => {
    const html = render('$- \\alpha$');
    expect(html).not.toContain('<li>');
    expect(html).not.toContain('<ul>');
    expect(html).toContain('- α');
  });

  test('a strikethrough-shaped leftover renders literal tildes, never <del> (echo R2)', () => {
    expect(renderLatexSymbols('$\\alpha ~~x~~$')).toBe('α \\~\\~x\\~\\~');
    const html = render('value $\\alpha ~~x~~$ end');
    expect(html).toContain('α ~~x~~');
    expect(html).not.toContain('<del>');
  });

  test('currency before a real span no longer swallows the span (echo R2 RQ)', () => {
    expect(renderLatexSymbols('it cost $5 but $\\alpha$ held')).toBe('it cost $5 but α held');
    expect(renderLatexSymbols('it cost $5 and $10 flat')).toBe('it cost $5 and $10 flat');
  });

  test('double-backtick inline code keeps its literal LaTeX (echo R2 RQ)', () => {
    expect(renderLatexSymbols('``code $\\alpha$ code`` and $\\beta$')).toBe('``code $\\alpha$ code`` and β');
  });

  test('a span alone on a line keeps its leading block marker literal (echo R3)', () => {
    // `$- \alpha$` must render as the text "- α", never a bullet list.
    expect(renderLatexSymbols('$- \\alpha$')).toBe('\\- α');
    expect(renderLatexSymbols('$> \\beta$')).toBe('\\> β');
    expect(renderLatexSymbols('$1. \\gamma$')).toBe('1\\. γ');
    // Mid-prose operators are untouched.
    expect(renderLatexSymbols('see $\\alpha - \\beta$ now')).toBe('see α - β now');
  });

  test('\\backslash emits a markdown-safe literal backslash (echo R3 RQ)', () => {
    expect(renderLatexSymbols('$\\backslash x$')).toBe('\\\\ x');
  });

  test('currency with a command between amounts converts as math — the documented boundary (echo R3 RQ)', () => {
    // `$100 \times $50` carries a multiplication command: math intent wins.
    // The literal dollars are dropped by design, and the span's inner
    // whitespace trims against the closing fence — documented and pinned.
    expect(renderLatexSymbols('$100 \\times $50')).toBe('100 ×50');
  });
});
