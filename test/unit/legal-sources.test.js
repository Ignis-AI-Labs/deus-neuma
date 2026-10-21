/**
 * THE PRAETOR'S SOURCE MAP (legal/legal-sources.js) — pure data and selection.
 * Whether each source answers the office's web tool is measured by a live
 * probe (the network is not a unit test's to depend on).
 */
import { describe, expect, test } from 'vitest';
import {
  LEGAL_SOURCES, PLAYBOOK, SOURCE_KINDS, SOURCE_JURISDICTIONS, sourcesText,
} from '../../backend/services/legal/legal-sources.js';

describe('the map', () => {
  test('every source is whole: a unique id, a kind and jurisdiction the map knows, an https route, a reach', () => {
    const ids = LEGAL_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of LEGAL_SOURCES) {
      expect(s.kinds.length).toBeGreaterThan(0);
      expect(s.kinds.every((k) => SOURCE_KINDS.includes(k)), s.id).toBe(true);
      expect(s.jurisdictions.every((j) => SOURCE_JURISDICTIONS.includes(j)), s.id).toBe(true);
      expect(s.url, s.id).toMatch(/^https:\/\//);
      expect(['web_fetch', 'needs-key', 'search-only']).toContain(s.reach);
    }
  });

  test('a source marked fetchable carries the probe that proves it; a blocked one carries none', () => {
    for (const s of LEGAL_SOURCES) {
      if (s.reach === 'web_fetch') expect(s.probe, s.id).toMatch(/^https:\/\//);
      if (s.reach === 'search-only') expect(s.probe, s.id).toBeNull();
    }
  });

  test('every kind of question has a reading order, and every kind and jurisdiction has a source', () => {
    for (const k of SOURCE_KINDS) {
      expect(PLAYBOOK[k]?.length, k).toBeGreaterThan(0);
      expect(LEGAL_SOURCES.some((s) => s.kinds.includes(k)), k).toBe(true);
    }
    for (const j of SOURCE_JURISDICTIONS) expect(LEGAL_SOURCES.some((s) => s.jurisdictions.includes(j)), j).toBe(true);
  });
});

describe('sourcesText — what the office reads', () => {
  test('a Wyoming statute question: Wyoming and federal sources, the PDF find route, the playbook, the citation record', () => {
    const t = sourcesText({ kind: 'statute', jurisdiction: 'US-WY' });
    expect(t).toContain('wyoleg');
    expect(t).toContain('uscode');
    expect(t).toContain('find');
    expect(t).not.toMatch(/^- legislation-gov-uk:/m); // a UK statute is not a source for Wyoming
    expect(t).toContain('Playbook (statute)');
    expect(t).toContain('Record every citation as');
  });

  test('blocked sources say how to reach them; unofficial mirrors say what to cite', () => {
    const eu = sourcesText({ jurisdiction: 'EU' });
    expect(eu).toMatch(/eur-lex: .*blocked to fetching/);
    expect(eu).toMatch(/ai-act-explorer: .*unofficial/);
  });

  test('an unknown kind or jurisdiction is ignored, never an empty answer', () => {
    const t = sourcesText({ kind: 'astrology', jurisdiction: 'MARS' });
    expect(t).toContain(`(verified`);
    expect(t.split('\n- ').length - 1).toBe(LEGAL_SOURCES.length);
  });

  test('small enough to load on demand (every source, no filter)', () => {
    expect(sourcesText({}).length).toBeLessThan(12_000);
  });
});
