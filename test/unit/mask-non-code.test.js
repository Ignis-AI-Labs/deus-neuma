/**
 * maskNonCode — the pure primitive the connection extractors rely on. It blanks
 * comment/string/template/regex literal interiors so a code token inside one is
 * never matched as a real call, while keeping every character position (length +
 * newlines) so a masked index maps to the exact same line/col in the original.
 * Tested directly because that length invariant is load-bearing for lineOf.
 */
import { describe, expect, it } from 'vitest';
import { maskNonCode } from '../../backend/services/mapview/extract.js';

describe('maskNonCode length + newline invariant', () => {
  const inputs = [
    'const a = fetch(x);',
    'const s = "call fetch(x)";',
    "const t = `a ${fetch(y)} b`;",
    "const p = /it's-a-regex/;",
    '// a comment with an apostrophe don\'t\nfetch(z);',
    '/* block\ncomment */\nfetch(w);',
    'const s = "line1\\nstill";',
    '`nested ${`inner ${fetch(q)}`}`',
    '`x\\',            // MALFORMED: unterminated template ending in a backslash
    "'unterminated",  // MALFORMED: unterminated string
    '`multi\nline\ntemplate ${x}`\nfetch(a);',
  ];
  for (const src of inputs) {
    it(`preserves length and newline count for: ${JSON.stringify(src).slice(0, 40)}`, () => {
      const masked = maskNonCode(src);
      expect(masked.length).toBe(src.length); // the load-bearing invariant
      expect((masked.match(/\n/g) || []).length).toBe((src.match(/\n/g) || []).length);
    });
  }
});

describe('maskNonCode blanks non-code, keeps code', () => {
  it('blanks a token inside a string but not the same token as real code', () => {
    const masked = maskNonCode('x="fetch(a)"; fetch(b);');
    expect(masked).not.toContain('fetch(a)'); // inside string → blanked
    expect(masked).toContain('fetch(b)');     // real code → kept
  });
  it('keeps a real call inside a template interpolation', () => {
    expect(maskNonCode('`r: ${fetch(u)}`')).toContain('fetch(u)');
  });
  it('blanks a regex interior so its quotes cannot open a span', () => {
    const masked = maskNonCode("const r = /it's/; fetch(real);");
    expect(masked).toContain('fetch(real)'); // real code after the regex survives
  });
});
