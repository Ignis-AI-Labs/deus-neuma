// proof-suite.test.js — the PROOF SUITE's integrity: every item verifiable,
// ids unique, the arithmetic section verbatim-true to the vendored GSM8K copy
// (test/fixtures/proof/gsm8k-25-source.json — the committed extraction of the
// sibling's vendored openai/gsm8k parquet, MIT; provenance in its _meta), and
// the version pinned. A suite that drifts silently would void every
// certificate ever issued against it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PROOF_SUITE, PROOF_SUITE_VERSION, SECTION_MAX_TOKENS, SECTION_ORDER,
} from '../../backend/services/bench/proof-data.js';

const SOURCE = JSON.parse(readFileSync(path.resolve('test/fixtures/proof/gsm8k-25-source.json'), 'utf8'));
const RUNTIME_COPY = JSON.parse(readFileSync(
  path.resolve('backend/services/bench/proof-gsm8k-25.json'), 'utf8'));

const KNOWN_CHECKS = new Set([
  'final-number',
  'word-count', 'all-caps', 'all-lowercase', 'must-include', 'must-not-include',
  'numbered-list-count', 'starts-with', 'json-only',
  'json-shape',
]);

describe('the suite, whole', () => {
  it('the version is pinned at 1', () => {
    expect(PROOF_SUITE_VERSION).toBe('1');
  });

  it('43 items: 25 arithmetic + 12 instruction + 6 format, in the declared order', () => {
    expect(PROOF_SUITE.length).toBe(43);
    expect(PROOF_SUITE.filter((i) => i.section === 'arithmetic').length).toBe(25);
    expect(PROOF_SUITE.filter((i) => i.section === 'instruction').length).toBe(12);
    expect(PROOF_SUITE.filter((i) => i.section === 'format').length).toBe(6);
    expect([...SECTION_ORDER].sort()).toEqual(['arithmetic', 'format', 'instruction']);
    for (const section of SECTION_ORDER) {
      expect(Number.isInteger(SECTION_MAX_TOKENS[section])).toBe(true);
    }
  });

  it('every item carries an id, a section, a non-empty prompt, and a known verifier', () => {
    const ids = new Set();
    for (const item of PROOF_SUITE) {
      expect(typeof item.id).toBe('string');
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(SECTION_ORDER).toContain(item.section);
      expect(typeof item.prompt).toBe('string');
      expect(item.prompt.length).toBeGreaterThan(10);
      expect(KNOWN_CHECKS.has(item.verify?.kind)).toBe(true);
      expect(Object.isFrozen(item)).toBe(true);
    }
  });
});

describe('the arithmetic section is verbatim GSM8K', () => {
  it('the runtime copy and the committed provenance fixture are identical', () => {
    expect(RUNTIME_COPY.items).toEqual(SOURCE.items);
    expect(RUNTIME_COPY._meta).toEqual(SOURCE._meta);
  });

  it('the provenance names the vendored source, its license, and its hash', () => {
    expect(SOURCE._meta.dataset).toContain('openai/gsm8k');
    expect(SOURCE._meta.license).toContain('MIT');
    expect(SOURCE._meta.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(SOURCE._meta.attribution).toContain('Cobbe');
  });

  it('every arithmetic item quotes the fixture question verbatim and scores its recorded final', () => {
    const byId = new Map(SOURCE.items.map((i) => [i.id, i]));
    const arithmetic = PROOF_SUITE.filter((i) => i.section === 'arithmetic');
    for (const item of arithmetic) {
      const source = byId.get(item.id);
      expect(source, `${item.id} missing from the vendored copy`).toBeTruthy();
      // Verbatim: the prompt embeds the question byte for byte.
      expect(item.prompt.endsWith(`Question: ${source.question}`)).toBe(true);
      // The scored answer is the dataset's own #### N.
      expect(item.verify).toEqual({ kind: 'final-number', expected: source.final });
      expect(source.answer.endsWith(`#### ${source.final}`)).toBe(true);
    }
    // Spot-pin the three edges against the fixture (the checksum law).
    expect(byId.get('gsm8k-00').final).toBe('18');
    expect(byId.get('gsm8k-00').question).toContain('Janet');
    expect(byId.get('gsm8k-24').id).toBe('gsm8k-24');
  });
});
