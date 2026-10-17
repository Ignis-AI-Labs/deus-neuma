/**
 * docs/governance/house-roles.md is pinned to the canonical TITLE_LEGEND
 * (frontend/app/RelinkShell/founding-titles.js) — every seat's title,
 * position, full seat name, and tier counts must appear in the document, so
 * the page users copy from can never drift from the legend the founding
 * rite runs on.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TITLE_LEGEND } from '../../frontend/app/RelinkShell/founding-titles.js';

const doc = readFileSync(path.join(process.cwd(), 'docs', 'governance', 'house-roles.md'), 'utf8');
const docFlat = doc.toLowerCase();

describe('docs/governance/house-roles.md mirrors TITLE_LEGEND', () => {
  test('every canonical title, position, and seat appears in the document', () => {
    for (const seat of TITLE_LEGEND) {
      expect(docFlat).toContain(seat.title.toLowerCase());
      expect(docFlat).toContain(seat.position.toLowerCase());
      expect(docFlat).toContain(seat.seat.toLowerCase());
    }
  });

  test('the tier counts match — ten founding, five growth, fifteen seats', () => {
    expect(TITLE_LEGEND.filter((s) => s.tier === 'founding')).toHaveLength(10);
    expect(TITLE_LEGEND.filter((s) => s.tier === 'growth')).toHaveLength(5);
    expect(TITLE_LEGEND).toHaveLength(15);
    expect(docFlat).toContain('fifteen');
  });

  test('the copy-paste block names every title', () => {
    const block = doc.slice(doc.indexOf('```'));
    for (const seat of TITLE_LEGEND) {
      expect(block).toContain(seat.title);
    }
  });
});
