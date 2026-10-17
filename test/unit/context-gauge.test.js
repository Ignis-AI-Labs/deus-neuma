/**
 * Tests for context-gauge — the pure derivation behind the composer's compact
 * CTX cluster (frontend/app/RelinkShell/context-gauge.js): ring percentage,
 * used/total label, tone ladder, hover detail, and every honest-degradation
 * rung. Redesign (Design note, 2026-08-15: the label states used/TOTAL, the ring
 * carries pct, and compaction shows FACTS only — ARMED (measured, present
 * tense) and ×N (recorded) — never a message-count prediction.
 */
import { describe, it, expect } from 'vitest';
import { gaugeFor } from '../../frontend/app/RelinkShell/context-gauge.js';

const evt = ({ tokens = 1000, source = 'measured', window = 32000, budgetSource = 'model-capabilities', session = null } = {}) => ({
  totals: { tokens, tokenSource: source },
  usage: { inputTokens: tokens, outputTokens: source === 'measured' ? 0 : null, usedTokens: tokens, source },
  budget: { contextTokens: window, source: window !== null ? budgetSource : 'unknown' },
  ...(session ? { session } : {}),
});

describe('gaugeFor', () => {
  it('null event → nothing to show', () => {
    expect(gaugeFor(null)).toBeNull();
    expect(gaugeFor(undefined)).toBeNull();
    expect(gaugeFor('junk')).toBeNull();
  });

  it('measured tokens against a known window: used/total explicit, pct drives the ring', () => {
    const g = gaugeFor(evt({ tokens: 8000, window: 32000 }));
    expect(g.label).toBe('CTX 8K / 32K');
    expect(g.pct).toBe(25);
    expect(g.approx).toBe(false);
    expect(g.used).toBe(8000);
    expect(g.remaining).toBe(24000);
    expect(g.compactionLabel).toBeNull();
    expect(g.tone).toBe('ok');
    expect(g.title).toContain('8,000 used · 24,000 left · 32,000 total (measured usage · limit per model-capabilities)');
  });

  it('an estimated total wears ≈ and says so on hover; the window is stated capacity and stays bare', () => {
    const g = gaugeFor(evt({ tokens: 8000, source: 'approx', window: 32000 }));
    expect(g.label).toBe('CTX ≈8K / 32K');
    expect(g.approx).toBe(true);
    expect(g.title).toContain('estimated');
  });

  it('a limit inferred from the model NAME wears ≈ even when usage is measured', () => {
    // The limit's own honesty ladder: runtime/registry/catalog render as fact,
    // a name-inferred ceiling is a guess (the global-context work, 2026-07-27).
    const g = gaugeFor(evt({ tokens: 8000, window: 128000, budgetSource: 'model-name' }));
    expect(g.label).toBe('CTX 8K / ≈128K');
    expect(g.title).toContain('limit per model-name');
  });

  it('catalog and runtime limits render as fact — no ≈', () => {
    for (const budgetSource of ['models.dev-catalog', 'provider-runtime']) {
      const g = gaugeFor(evt({ tokens: 8000, window: 32000, budgetSource }));
      expect(g.label).toBe('CTX 8K / 32K');
      expect(g.title).toContain(`limit per ${budgetSource}`);
    }
  });

  it('no known window → raw count, no ring (pct null), never an invented percentage', () => {
    const g = gaugeFor(evt({ tokens: 12431, window: null }));
    expect(g.label).toBe('CTX 12.4K USED · LIMIT UNKNOWN');
    expect(g.pct).toBeNull();
    expect(g.remaining).toBeNull();
    expect(g.title).toContain('context limit unknown');
  });

  it('pct clamps at 100 — an overfull window never draws past the ring', () => {
    const g = gaugeFor(evt({ tokens: 40000, window: 32000 }));
    expect(g.pct).toBe(100);
    expect(g.remaining).toBe(0);
  });

  it('provider output counts toward used context and the active model rides the detail', () => {
    const event = evt({ tokens: 8000, window: 32000 });
    event.usage = { inputTokens: 7000, outputTokens: 1000, usedTokens: 8000, source: 'measured' };
    event.route = { provider: 'openai-chatgpt', model: 'gpt-5.6-sol' };
    const g = gaugeFor(event);
    expect(g.used).toBe(8000);
    expect(g.remaining).toBe(24000);
    expect(g.title).toContain('gpt-5.6-sol via openai-chatgpt');
  });

  it('tone ladder: 75% warns, 90% alerts', () => {
    expect(gaugeFor(evt({ tokens: 24000, window: 32000 })).tone).toBe('warn');
    expect(gaugeFor(evt({ tokens: 28800, window: 32000 })).tone).toBe('alert');
    expect(gaugeFor(evt({ tokens: 1000, window: 32000 })).tone).toBe('ok');
  });

  it('a quiet session keeps compaction OFF the strip — the hover states the exact mechanic', () => {
    const g = gaugeFor(evt({ session: { compactionCount: 0, atBoundary: false, boundaryRatio: 0.8 } }));
    expect(g.compactionLabel).toBeNull();
    expect(g.title).toContain('self-compaction arms at 80% of the window');
    expect(g.title).toContain('self-compacted 0×');
  });

  it('a survived compaction shows its count — a recorded fact, never a forecast', () => {
    const g = gaugeFor(evt({ session: { compactionCount: 2, atBoundary: false, boundaryRatio: 0.8 } }));
    expect(g.compactionLabel).toBe('×2');
    expect(g.title).toContain('self-compacted 2×');
  });

  it('a turn measured past the boundary reads ARMED — present tense, measured', () => {
    const g = gaugeFor(evt({ tokens: 28000, window: 32000, session: { compactionCount: 0, atBoundary: true, boundaryRatio: 0.8 } }));
    expect(g.compactionLabel).toBe('COMPACTION ARMED');
    expect(g.title).toContain('self-compaction ARMED — this turn measured past 80% of the window');
    const both = gaugeFor(evt({ session: { compactionCount: 3, atBoundary: true, boundaryRatio: 0.8 } }));
    expect(both.compactionLabel).toBe('COMPACTION ARMED · ×3');
  });

  it('NEVER a message-count prediction anywhere on the gauge', () => {
    const g = gaugeFor(evt({ session: { compactionCount: 1, atBoundary: true, boundaryRatio: 0.8 } }));
    expect(`${g.label} ${g.compactionLabel} ${g.title}`).not.toMatch(/MSG|message/i);
  });

  it('a malformed session block yields NO compaction label — never ×undefined', () => {
    const g = gaugeFor(evt({ session: { atBoundary: true } }));
    expect(g.compactionLabel).toBeNull();
    expect(g.title).not.toContain('self-compaction');
  });

  it('the working peak is hover detail, never the headline (Design note, 2026-08-31', () => {
    // A tool-heavy turn: standing 17K, peak 60K of ephemeral tool machinery.
    const event = evt({ tokens: 17500, window: 262144 });
    event.usage = {
      inputTokens: 17000, outputTokens: 500, usedTokens: 17500,
      workingPeakTokens: 60000, source: 'measured',
    };
    const g = gaugeFor(event);
    expect(g.used).toBe(17500); // standing + output — NOT the peak
    expect(g.label).toBe('CTX 17.5K / 262.1K');
    expect(g.title).toContain('working peak 60,000 this turn');
    expect(g.title).toContain('not carried forward');
  });

  it('a carried reading (interrupted turn measured nothing) says so on hover and wears ≈', () => {
    const event = evt({ tokens: 17000, source: 'approx', window: 262144 });
    event.usage = { inputTokens: 17000, outputTokens: null, usedTokens: 17000, source: 'carried' };
    const g = gaugeFor(event);
    expect(g.approx).toBe(true); // carried is not a fresh measurement
    expect(g.title).toContain('carried from the last measured turn');
  });

  it('a fail-soft collapse is named on hover — degraded lanes never invisible again (D4)', () => {
    const event = evt({ tokens: 8000, window: 32000 });
    event.degraded = ['recentConversation'];
    const g = gaugeFor(event);
    expect(g.title).toContain('context degraded: recentConversation unavailable this turn');
  });

  it('tone reads token pressure alone — an armed session never colors a calm window', () => {
    expect(gaugeFor(evt({ tokens: 1000, window: 32000, session: { compactionCount: 0, atBoundary: false, boundaryRatio: 0.8 } })).tone).toBe('ok');
    expect(gaugeFor(evt({ tokens: 29000, window: 32000, session: { compactionCount: 0, atBoundary: true, boundaryRatio: 0.8 } })).tone).toBe('alert');
  });
});
