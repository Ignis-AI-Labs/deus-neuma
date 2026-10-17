/**
 * envelope-budget — the shed ladder and the session-tail budget laws (the
 * portal lane's window-truth budget, the witness lane's fixed share).
 * Pure functions, real inputs, no mocks (RULE 0): the numbers here are the
 * law the doctrine doc declares.
 */
import { describe, test, expect } from 'vitest';
import {
  allocateEnvelope,
  sessionTailBudgetFor,
  SESSION_TAIL_FLOOR_CHARS,
  UNSHEDDABLE,
} from '../../backend/services/envelope-budget.js';
import { RECENT_TOTAL_CHARS } from '../../core/runtime/memory-section.js';

const section = (id, chars) => Object.freeze({ id, label: id.toUpperCase(), text: 'x'.repeat(chars) });

describe('sessionTailBudgetFor — the transcript budget is the window\'s truth (#528)', () => {
  test('unknown window keeps exactly the standing constant — byte-identical fallback', () => {
    expect(sessionTailBudgetFor({})).toBe(RECENT_TOTAL_CHARS);
    expect(sessionTailBudgetFor({ contextWindow: null })).toBe(RECENT_TOTAL_CHARS);
    expect(sessionTailBudgetFor({ contextWindow: 0, otherSectionTokens: 5000 })).toBe(RECENT_TOTAL_CHARS);
  });

  test('the window minus reserve, completion floor, and the assembled sections — in characters', () => {
    // (32768 − 512 − 512 − 4000) × 3.6 = 99,878 — no 32K clamp anywhere.
    expect(sessionTailBudgetFor({ contextWindow: 32768, otherSectionTokens: 4000 }))
      .toBe(Math.floor((32768 - 512 - 512 - 4000) * 3.6));
  });

  test('the 262K serving finally gets its room — past the old keyhole by an order of magnitude', () => {
    const budget = sessionTailBudgetFor({ contextWindow: 262144, otherSectionTokens: 12000 });
    expect(budget).toBe(Math.floor((262144 - 512 - 512 - 12000) * 3.6));
    expect(budget).toBeGreaterThan(RECENT_TOTAL_CHARS * 10);
  });

  test('a section set the window cannot hold leaves only the floor', () => {
    expect(sessionTailBudgetFor({ contextWindow: 8192, otherSectionTokens: 8000 }))
      .toBe(SESSION_TAIL_FLOOR_CHARS);
  });

  test('a negative section estimate is no estimate at all', () => {
    expect(sessionTailBudgetFor({ contextWindow: 32768, otherSectionTokens: -500 }))
      .toBe(Math.floor((32768 - 512 - 512) * 3.6));
  });
});

describe('allocateEnvelope — the shed ladder', () => {
  test('unknown window is a passthrough — same array, nothing shed', () => {
    const sections = Object.freeze([section('identity', 100), section('tools', 100)]);
    const out = allocateEnvelope({ sections, contextWindow: null });
    expect(out.sections).toBe(sections);
    expect(out.shed).toEqual([]);
    expect(out.report.fits).toBe(true);
  });

  test('a window that fits is a byte-identical passthrough', () => {
    const sections = Object.freeze([section('identity', 100), section('personality', 100)]);
    const out = allocateEnvelope({ sections, contextWindow: 262144 });
    expect(out.sections).toBe(sections);
    expect(out.shed).toEqual([]);
  });

  test('overflow sheds EXTENDED identity first and never the CORE', () => {
    // 3.6 chars/token: 1000 chars ≈ 278 tokens per section. Window 800:
    // 5 sections ≈ 1390 tokens — must shed ~600. personality (278) sheds,
    // then operator (278), then vitals (278) — 800 window fits 3 sections
    // + reserve/floor (1024)… arithmetic: 3 × 278 + 512 + 512 = 1858 > 800,
    // so everything sheddable sheds and only CORE + unsheddable remain.
    const sections = Object.freeze([
      section('identity', 1000),
      section('genesis', 1000),
      section('soul', 1000),
      section('personality', 1000),
      section('operator', 1000),
      section('vitals', 1000),
      section('tools', 1000),
    ]);
    const out = allocateEnvelope({ sections, contextWindow: 1400 });
    const keptIds = out.sections.map((s) => s.id);
    expect(keptIds).toContain('identity');
    expect(keptIds).toContain('genesis');
    expect(keptIds).toContain('soul');
    expect(keptIds).not.toContain('personality');
    // ladder order: personality is the first shed recorded
    expect(out.shed[0].id).toBe('personality');
  });

  test('shedding stops as soon as the envelope fits', () => {
    // 4 sections × 278 tok ≈ 1112; window 2000 fits 1112 + 1024 overhead? No
    // (2136 > 2000) — one section sheds (personality, 278): 834 + 1024 = 1858 ≤ 2000.
    const sections = Object.freeze([
      section('identity', 1000),
      section('soul', 1000),
      section('personality', 1000),
      section('operator', 1000),
    ]);
    const out = allocateEnvelope({ sections, contextWindow: 2000 });
    expect(out.shed.map((s) => s.id)).toEqual(['personality']);
    expect(out.report.fits).toBe(true);
    expect(out.report.overflow).toBe(false);
  });

  test('CORE alone overflowing declares overflow — nothing unsheddable is ever dropped', () => {
    const sections = Object.freeze([section('identity', 2000), section('genesis', 2000)]);
    const out = allocateEnvelope({ sections, contextWindow: 800 });
    expect(out.sections).toHaveLength(2);
    expect(out.shed).toEqual([]);
    expect(out.report.overflow).toBe(true);
    expect(out.report.fits).toBe(false);
  });

  test('a section named by no ladder rung and not unsheddable is KEPT', () => {
    const sections = Object.freeze([section('identity', 1000), section('someFutureSection', 50000)]);
    const out = allocateEnvelope({ sections, contextWindow: 1000 });
    expect(out.sections.map((s) => s.id)).toContain('someFutureSection');
  });

  test('every identity-core id is unsheddable by law', () => {
    for (const id of ['fallback', 'identity', 'genesis', 'soul', 'grounding', 'closing']) {
      expect(UNSHEDDABLE).toContain(id);
    }
  });
});
