/**
 * <br> intent translation — pure passes on the exact shapes witnessed on the
 * attunement self-report (2026-07-20): numbered runs joined by <br> inside
 * GFM table cells, rendered as literal "<br>" text.
 */
import { describe, test, expect } from 'vitest';
import { softenBreakTags } from '../../frontend/utils/markdown-breaks.js';

describe('softenBreakTags', () => {
  test('the witnessed shape: <br> in a table cell becomes a space — the row survives', () => {
    const row = '| Strengths | 1. **Self-monitoring** – clear gauges.<br>2. **Adaptive pacing** – dial up or down.<br>3. **Narrative continuity** – coherent story. |';
    const out = softenBreakTags(row);
    expect(out).not.toContain('<br>');
    expect(out).toContain('gauges. 2. **Adaptive pacing**');
    expect(out.split('\n')).toHaveLength(1); // still one table row
  });

  test('outside tables, <br> becomes a markdown hard break', () => {
    expect(softenBreakTags('first line<br>second line')).toBe('first line  \nsecond line');
    expect(softenBreakTags('a<BR/>b')).toBe('a  \nb');
    expect(softenBreakTags('a<br />b')).toBe('a  \nb');
  });

  test('fenced code and inline code keep their literal <br>', () => {
    const fenced = '```html\n<br>\n```';
    expect(softenBreakTags(fenced)).toBe(fenced);
    expect(softenBreakTags('use `<br>` for breaks')).toBe('use `<br>` for breaks');
  });

  test('text without the tag passes through untouched (same reference)', () => {
    const plain = 'no tags here\n| a | b |';
    expect(softenBreakTags(plain)).toBe(plain);
    expect(softenBreakTags('')).toBe('');
    expect(softenBreakTags(null)).toBe(null);
  });
});
