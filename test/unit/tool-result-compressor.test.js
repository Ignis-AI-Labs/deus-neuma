/**
 * compressToolResult — pure two-stage compression over real inputs, real
 * outputs, nothing to mock (RULE 0). Chars are JS string length throughout:
 * that is the unit the cap itself is measured in.
 */
import { describe, expect, it } from 'vitest';
import { compressToolResult } from '../../core/runtime/tool-result-compressor.js';

const REF = 'tr_deadbeef_03_cafef00d';

// Deterministic pseudo-varied multi-line content — no randomness, same
// bytes every call (LCG over Math.imul stays in 32-bit space).
const lcgContent = (chars, seed = 42) => {
  let x = seed >>> 0;
  const next = () => {
    x = (Math.imul(1103515245, x) + 12345) >>> 0;
    return x;
  };
  let out = '';
  while (out.length < chars) {
    const len = Math.max(1, next() % 80);
    const word = next() % 10 === 0 ? 'error in segment ' : 'data segment ';
    out += `${(word + next()).slice(0, len)}\n`;
  }
  return out.slice(0, chars);
};

// Non-marker body: drop the head line and every interior gap-marker line.
const GAP_LINE_RE = /^\[… \d+ chars omitted @ offset \d+/;
const reconstructBody = (res) =>
  res.compressed.split('\n').slice(1).filter((l) => !GAP_LINE_RE.test(l)).join('\n');
const keptText = (content, res) =>
  res.keptRanges.map(([s, e]) => content.slice(s, e)).join('\n');
const keptChars = (res) => res.keptRanges.reduce((n, [s, e]) => n + (e - s), 0);

describe('compressToolResult — verbatim', () => {
  it('returns under-cap content unchanged with the full kept range', () => {
    const content = 'hello\nworld';
    const res = compressToolResult(content, { cap: 4000, ref: REF });
    expect(res.compressed).toBe(content);
    expect(res.kind).toBe('verbatim');
    expect(res.keptRanges).toEqual([[0, content.length]]);
    expect(res.originalChars).toBe(content.length);
  });

  it('treats content.length === cap as verbatim (boundary)', () => {
    const content = 'x'.repeat(4000);
    const res = compressToolResult(content, {});
    expect(res.kind).toBe('verbatim');
    expect(res.compressed).toBe(content);
  });

  it('freezes the result, keptRanges, and each range pair', () => {
    const res = compressToolResult('small', { ref: REF });
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.keptRanges)).toBe(true);
    expect(Object.isFrozen(res.keptRanges[0])).toBe(true);
  });
});

describe('compressToolResult — stage 1 lossless reformat', () => {
  const items = (n) =>
    Array.from({ length: n }, (_, i) => ({ index: i, name: `component-${i}`, ok: true }));

  it('densifies pretty JSON when dense fits the cap and beats 0.9x', () => {
    const value = { items: items(60) };
    const pretty = JSON.stringify(value, null, 4);
    expect(pretty.length).toBeGreaterThan(4000); // over-cap precondition
    const res = compressToolResult(pretty, { cap: 4000, ref: REF });
    expect(res.kind).toBe('reformatted');
    expect(res.compressed.length).toBeLessThanOrEqual(4000);
    expect(res.compressed.length).toBeLessThan(0.9 * pretty.length);
    expect(JSON.parse(res.compressed)).toEqual(value); // value-lossless round trip
    expect(res.originalChars).toBe(pretty.length);
    expect(res.keptRanges).toEqual([[0, pretty.length]]);
  });

  it('falls through to anchored when even dense JSON exceeds the cap', () => {
    const pretty = JSON.stringify({ items: items(300) }, null, 4);
    const res = compressToolResult(pretty, { cap: 4000, ref: REF });
    expect(res.kind).toBe('anchored');
    expect(res.compressed.length).toBeLessThanOrEqual(4000);
  });
});

describe('compressToolResult — stage 2 anchored', () => {
  it('keptRanges slices exactly reconstruct the non-marker output', () => {
    const content = Array.from(
      { length: 300 },
      (_, i) => `line ${String(i).padStart(3, '0')} some filler text`,
    ).join('\n');
    const res = compressToolResult(content, { cap: 1000, ref: REF });
    expect(res.kind).toBe('anchored');
    expect(res.compressed.length).toBeLessThanOrEqual(1000);
    expect(reconstructBody(res)).toBe(keptText(content, res));
  });

  it('keeps error lines from the omitted region whole', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `filler line ${i} padding padding padding`);
    lines[70] = 'ERROR: db exploded';
    lines[80] = 'Traceback (most recent call last):';
    const content = lines.join('\n');
    const res = compressToolResult(content, { cap: 3000, ref: REF });
    expect(res.kind).toBe('anchored');
    expect(res.compressed).toContain('ERROR: db exploded');
    expect(res.compressed).toContain('Traceback (most recent call last):');
    expect(res.compressed.length).toBeLessThanOrEqual(3000);
    expect(reconstructBody(res)).toBe(keptText(content, res));
  });

  it('head marker states the ref, real kept count, and true originalChars', () => {
    const content = lcgContent(12345);
    const res = compressToolResult(content, { cap: 4000, ref: REF });
    const head = res.compressed.split('\n')[0];
    expect(head).toBe(
      `[ccr:${REF} — kept ${keptChars(res)} of 12345 chars (front/back/sampled); record/retrieve_result {"ref":"${REF}","offset":0} starts exact pages; follow next_offset]`,
    );
    expect(res.originalChars).toBe(12345);
  });

  it('falls back to the honest no-ref marker when ref is undefined', () => {
    const content = lcgContent(9000);
    const res = compressToolResult(content, { cap: 4000 });
    expect(res.kind).toBe('anchored');
    expect(res.compressed.split('\n')[0]).toBe('[truncated — 9000 chars total]');
    expect(res.compressed).not.toContain('ccr:');
    expect(res.compressed).not.toContain('retrieve_result');
    expect(res.compressed.length).toBeLessThanOrEqual(4000);
    expect(reconstructBody(res)).toBe(keptText(content, res));
  });

  it('interior gap markers state omitted chars, offset, and the ref', () => {
    const content = lcgContent(20000);
    const res = compressToolResult(content, { cap: 2000, ref: REF });
    const gaps = res.compressed
      .split('\n')
      .filter((l) => GAP_LINE_RE.test(l));
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      const m = gap.match(/^\[… (\d+) chars omitted @ offset (\d+) — ccr:(.+)\]$/);
      expect(m).not.toBeNull();
      expect(m[3]).toBe(REF);
      // Each announced gap must be a real hole between kept ranges.
      const offset = Number(m[2]);
      const omitted = Number(m[1]);
      const inRange = res.keptRanges.some(([s, e]) => offset >= s && offset < e);
      expect(inRange).toBe(false);
      expect(offset + omitted).toBeLessThanOrEqual(content.length);
    }
  });
});

describe('compressToolResult — determinism', () => {
  it('double call is byte-equal (with ref and without)', () => {
    const content = lcgContent(50000);
    const a = compressToolResult(content, { cap: 4000, ref: REF });
    const b = compressToolResult(content, { cap: 4000, ref: REF });
    expect(b.compressed).toBe(a.compressed);
    expect(b.keptRanges).toEqual(a.keptRanges);
    expect(b.kind).toBe(a.kind);
    const c = compressToolResult(content, { cap: 4000 });
    const d = compressToolResult(content, { cap: 4000 });
    expect(d.compressed).toBe(c.compressed);
  });
});

describe('compressToolResult — cap invariant sweep (markers included)', () => {
  const sizes = [4001, 10000, 100000];
  const caps = [512, 4000];
  for (const size of sizes) {
    for (const cap of caps) {
      it(`holds compressed.length <= ${cap} for ${size}-char multi-line content`, () => {
        const content = lcgContent(size, size);
        for (const ref of [REF, undefined]) {
          const res = compressToolResult(content, { cap, ref });
          expect(res.compressed.length).toBeLessThanOrEqual(cap);
          expect(res.originalChars).toBe(size);
        }
      });
      it(`holds compressed.length <= ${cap} for a ${size}-char single-line blob`, () => {
        const content = 'x'.repeat(size);
        const res = compressToolResult(content, { cap, ref: REF });
        expect(res.compressed.length).toBeLessThanOrEqual(cap);
      });
    }
  }
});

describe('compressToolResult — pathological inputs', () => {
  it('anchors a single-line blob with no newlines (front + back ranges)', () => {
    const content = 'z'.repeat(10000);
    const res = compressToolResult(content, { cap: 4000, ref: REF });
    expect(res.kind).toBe('anchored');
    expect(res.compressed.length).toBeLessThanOrEqual(4000);
    expect(res.keptRanges.length).toBe(2);
    expect(res.keptRanges[0][0]).toBe(0);
    expect(res.keptRanges[1][1]).toBe(10000);
    expect(reconstructBody(res)).toBe(keptText(content, res));
  });

  it('counts multibyte content in JS string length and never strands a surrogate', () => {
    // Emoji built from char codes — surrogate pairs, 2 units each.
    const emoji = String.fromCharCode(0xd83d, 0xde00);
    const content = emoji.repeat(3000); // 6000 JS chars
    const res = compressToolResult(content, { cap: 4000, ref: REF });
    expect(res.originalChars).toBe(6000);
    expect(res.compressed).toContain('of 6000 chars');
    expect(res.compressed.length).toBeLessThanOrEqual(4000);
    // A lone surrogate would not survive a UTF-8 round trip.
    expect(Buffer.from(res.compressed, 'utf8').toString('utf8')).toBe(res.compressed);
  });

  it('passes an empty string through verbatim', () => {
    const res = compressToolResult('', { ref: REF });
    expect(res.kind).toBe('verbatim');
    expect(res.compressed).toBe('');
    expect(res.keptRanges).toEqual([[0, 0]]);
    expect(res.originalChars).toBe(0);
  });

  it('anchors whitespace-only content over the cap', () => {
    const content = ' '.repeat(5000);
    const res = compressToolResult(content, { cap: 4000, ref: REF });
    expect(res.kind).toBe('anchored');
    expect(res.compressed.length).toBeLessThanOrEqual(4000);
    expect(res.originalChars).toBe(5000);
  });

  it('anchors malformed JSON that starts with a brace instead of crashing stage 1', () => {
    const content = `{"a": ${'1,'.repeat(3000)}oops}`;
    const res = compressToolResult(content, { cap: 4000, ref: REF });
    expect(res.kind).toBe('anchored');
    expect(res.compressed.length).toBeLessThanOrEqual(4000);
  });
});

describe('degenerate tiny-cap branch', () => {
  it('emits the honest no-ref truncation marker when it fits within the cap', () => {
    const text = 'x'.repeat(5000);
    const cap = 150; // far below headMax + gap reserve for a full ref marker set
    const out = compressToolResult(text, { cap, ref: 'tr_aabbccdd_1_deadbeef' });
    expect(out.compressed.length).toBeLessThanOrEqual(cap);
    expect(out.compressed).toContain('[truncated — 5000 chars total]');
    expect(out.originalChars).toBe(5000);
    const [start, end] = out.keptRanges[0];
    expect(text.slice(start, end)).toBe(out.compressed.slice(0, end - start));
  });

  it('falls to a bare slice only when even the short marker cannot fit', () => {
    const text = 'y'.repeat(500);
    const cap = 10;
    const out = compressToolResult(text, { cap, ref: 'tr_aabbccdd_1_deadbeef' });
    expect(out.compressed.length).toBeLessThanOrEqual(cap);
    expect(out.compressed).toBe('y'.repeat(10));
    expect(out.originalChars).toBe(500);
  });
});
