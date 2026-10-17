/**
 * B-04 — buildCompositionEvent (pure). No mocks anywhere: a pure function
 * proven with real inputs and real outputs (AGENTS.md RULE 0's one honest
 * unit case). Covers the token-truth ladder (measured → attributed → approx),
 * the exact-sum remainder rule, the ≤20 refs cap, counts-only output, and
 * frozen determinism.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCompositionEvent,
  COMPOSITION_MAX_TOOL_RESULTS,
  lastRecordedComposition,
  sumTurnUsage,
} from '../../core/runtime/context-composition.js';

const SECRET = 'SOVEREIGN-DNA-MARKER-93af never on the wire';

const sections = () => [
  { id: 'identity', label: 'IDENTITY', text: 'I'.repeat(1000) },
  { id: 'soul', label: 'SOUL', text: `S${SECRET}${'s'.repeat(3000 - 1 - SECRET.length)}` },
  { id: 'closing', label: 'CLOSING', text: 'c'.repeat(333) },
];

const usage = (promptTokens) => Object.freeze({ promptTokens, completionTokens: 7 });

describe('sumTurnUsage — complete-turn token truth', () => {
  it('sums every measured round and collapses any missing count to unknown', () => {
    const first = sumTurnUsage(null, {
      promptTokens: 100, completionTokens: 20, source: 'measured',
    });
    expect(sumTurnUsage(first, {
      promptTokens: 80, completionTokens: 10, source: 'measured',
    })).toEqual({ promptTokens: 180, completionTokens: 30, source: 'measured' });
    expect(sumTurnUsage(first, {
      promptTokens: null, completionTokens: 5, source: 'unknown',
    })).toEqual({ promptTokens: null, completionTokens: 25, source: 'mixed' });
  });
});

describe('buildCompositionEvent — token-truth ladder', () => {
  it('approx rung when usage is null: chars/4 everywhere, visibly labeled', () => {
    const event = buildCompositionEvent({ sections: sections(), usage: null });

    expect(event.type).toBe('context:composition');
    expect(event.sections.map((s) => s.id)).toEqual(['identity', 'soul', 'closing']);
    for (const s of event.sections) {
      expect(s.tokenSource).toBe('approx');
      expect(s.tokens).toBe(Math.ceil(s.chars / 4));
    }
    // Real char lengths — not estimates of estimates
    expect(event.sections[0].chars).toBe(1000);
    expect(event.sections[1].chars).toBe(3000);
    expect(event.sections[2].chars).toBe(333);
    expect(event.totals.chars).toBe(4333);
    expect(event.totals.tokenSource).toBe('approx');
    expect(event.totals.tokens).toBe(
      event.sections.reduce((sum, s) => sum + s.tokens, 0));
  });

  it('measured/attributed rung: section sum EQUALS the measured total exactly', () => {
    // 1000/3000/333 of 4333 chars against 1000 tokens forces rounding drift —
    // the case the remainder rule exists for.
    const event = buildCompositionEvent({ sections: sections(), usage: usage(1000) });

    expect(event.totals.tokens).toBe(1000);
    expect(event.totals.tokenSource).toBe('measured');
    expect(event.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 7,
      usedTokens: 1007,
      source: 'measured',
    });
    const sum = event.sections.reduce((s, x) => s + x.tokens, 0);
    expect(sum).toBe(1000);
    for (const s of event.sections) expect(s.tokenSource).toBe('attributed');
  });

  it('remainder lands on the LARGEST section', () => {
    const secs = [
      { id: 'a', label: 'A', text: 'a'.repeat(10) },
      { id: 'b', label: 'B', text: 'b'.repeat(70) },  // largest
      { id: 'c', label: 'C', text: 'c'.repeat(20) },
    ];
    // 7 tokens across 10/70/20 of 100: round → 1, 5, 1 (sum 7, no drift);
    // use 8 tokens: round(0.8)=1, round(5.6)=6, round(1.6)=2 → sum 9, drift -1.
    const event = buildCompositionEvent({ sections: secs, usage: usage(8) });
    const bare = secs.map((s) => Math.round(8 * (s.text.length / 100)));
    const drift = 8 - bare.reduce((a, b) => a + b, 0);
    expect(drift).not.toBe(0); // the case is real
    expect(event.sections.map((s) => s.tokens)).toEqual([bare[0], bare[1] + drift, bare[2]]);
    expect(event.sections.reduce((s, x) => s + x.tokens, 0)).toBe(8);
  });

  it('never a bare number without a source', () => {
    for (const u of [null, usage(500)]) {
      const event = buildCompositionEvent({ sections: sections(), usage: u });
      expect(['measured', 'attributed', 'approx']).toContain(event.totals.tokenSource);
      for (const s of event.sections) {
        expect(['attributed', 'approx']).toContain(s.tokenSource);
      }
      expect(['unknown']).toContain(event.budget.source); // no budget given → honest unknown
      expect(event.budget.contextTokens).toBe(null);
      expect(['measured', 'approx']).toContain(event.usage.source);
    }
  });

  it('missing provider usage keeps output unknown and the context total visibly approximate', () => {
    const event = buildCompositionEvent({ sections: sections(), usage: null });
    expect(event.usage.inputTokens).toBe(event.totals.tokens);
    expect(event.usage.outputTokens).toBeNull();
    expect(event.usage.usedTokens).toBe(event.totals.tokens);
    expect(event.usage.source).toBe('approx');
  });

  it('estimates generated output when provider usage is absent', () => {
    const event = buildCompositionEvent({
      sections: sections(),
      usage: null,
      completionText: 'x'.repeat(41),
    });
    expect(event.usage.outputTokens).toBe(11);
    expect(event.usage.usedTokens).toBe(event.totals.tokens + 11);
    expect(event.usage.source).toBe('approx');
  });
});

describe('buildCompositionEvent — standing vs working peak (Design note, 2026-08-31', () => {
  it('the headline is the STANDING input; the in-turn peak rides as workingPeakTokens', () => {
    // A tool-heavy turn: round 0 measured 17K (standing — what the next turn
    // inherits), the last round measured 60K (peak — ephemeral tool machinery).
    const event = buildCompositionEvent({
      sections: sections(),
      usage: { promptTokens: 60000, completionTokens: 500 },
      standing: { promptTokens: 17000, source: 'measured' },
    });
    expect(event.usage.inputTokens).toBe(17000);
    expect(event.usage.usedTokens).toBe(17500);
    expect(event.usage.workingPeakTokens).toBe(60000);
    expect(event.usage.source).toBe('measured');
  });

  it('a carried standing (interrupted turn measured nothing) is labeled carried, never a fake drop', () => {
    const event = buildCompositionEvent({
      sections: sections(),
      usage: null,
      standing: { promptTokens: 17000, source: 'carried' },
      completionText: 'x'.repeat(41),
    });
    expect(event.usage.inputTokens).toBe(17000);
    expect(event.usage.usedTokens).toBe(17000 + 11);
    expect(event.usage.workingPeakTokens).toBeUndefined();
    expect(event.usage.source).toBe('carried');
  });

  it('no standing → legacy shape: the measured peak is the input, no peak key', () => {
    const event = buildCompositionEvent({ sections: sections(), usage: usage(1000) });
    expect(event.usage.inputTokens).toBe(1000);
    expect(event.usage.workingPeakTokens).toBeUndefined();
  });

  it('degraded lane names ride the event — ids only, non-strings dropped', () => {
    const event = buildCompositionEvent({ sections: sections(), degraded: ['recall', 42, ''] });
    expect(event.degraded).toEqual(['recall']);
  });

  it('no degradation → no degraded key', () => {
    expect(buildCompositionEvent({ sections: sections() }).degraded).toBeUndefined();
  });
});

describe('buildCompositionEvent — budget honesty', () => {
  it('carries a real budget with its named source', () => {
    const event = buildCompositionEvent({
      sections: sections(),
      budget: { contextTokens: 32768, source: 'model-capabilities' },
    });
    expect(event.budget).toEqual({ contextTokens: 32768, source: 'model-capabilities' });
  });

  it('a non-finite budget count collapses to null/unknown — never invented', () => {
    for (const bad of [null, {}, { contextTokens: NaN, source: 'model' }, { contextTokens: 'big' }]) {
      const event = buildCompositionEvent({ sections: sections(), budget: bad });
      expect(event.budget).toEqual({ contextTokens: null, source: 'unknown' });
    }
  });
});

describe('buildCompositionEvent — toolResults cap', () => {
  const mint = (n) => Array.from({ length: n }, (_, i) => ({
    ref: `tr_deadbeef_${i}_cafef00d`,
    tool: 'filesystem/read_file',
    originalChars: 10000 + i,
    sentChars: 4000,
    kind: 'anchored',
  }));

  it('keeps only the 20 MOST RECENT refs, oldest dropped', () => {
    const event = buildCompositionEvent({ sections: sections(), toolResults: mint(25) });
    expect(event.toolResults).toHaveLength(COMPOSITION_MAX_TOOL_RESULTS);
    expect(event.toolResults[0].ref).toBe('tr_deadbeef_5_cafef00d');   // 0-4 dropped
    expect(event.toolResults[19].ref).toBe('tr_deadbeef_24_cafef00d'); // newest kept
  });

  it('copies only the count fields — nothing extra rides along', () => {
    const [entry] = buildCompositionEvent({
      sections: sections(),
      toolResults: [{ ...mint(1)[0], content: 'FULL RESULT TEXT MUST NOT LEAK' }],
    }).toolResults;
    expect(Object.keys(entry).sort()).toEqual(['kind', 'originalChars', 'ref', 'sentChars', 'tool']);
  });
});

describe('buildCompositionEvent — counts only, frozen, deterministic', () => {
  it('no prompt text anywhere in the serialized event', () => {
    const event = buildCompositionEvent({ sections: sections(), usage: usage(1000) });
    const wire = JSON.stringify(event);
    expect(wire.includes(SECRET)).toBe(false);
    expect(wire.includes('IIII')).toBe(false); // no section body fragments
    expect(wire.includes('"text"')).toBe(false);
    // and it is small — counts only
    expect(wire.length).toBeLessThan(4096);
  });

  it('output is deeply frozen', () => {
    const event = buildCompositionEvent({
      sections: sections(),
      usage: usage(100),
      toolResults: [{ ref: 'tr_x', tool: 't', originalChars: 1, sentChars: 1, kind: 'verbatim' }],
      budget: { contextTokens: 8192, source: 'model-capabilities' },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.sections)).toBe(true);
    expect(Object.isFrozen(event.sections[0])).toBe(true);
    expect(Object.isFrozen(event.budget)).toBe(true);
    expect(Object.isFrozen(event.toolResults)).toBe(true);
    expect(Object.isFrozen(event.toolResults[0])).toBe(true);
    expect(Object.isFrozen(event.totals)).toBe(true);
    expect(Object.isFrozen(event.usage)).toBe(true);
  });

  it('double-call determinism: identical inputs, identical events', () => {
    const args = () => ({
      sections: sections(),
      usage: usage(1234),
      toolResults: [{ ref: 'tr_a', tool: 't', originalChars: 9, sentChars: 4, kind: 'anchored' }],
      budget: { contextTokens: 4096, source: 'model-capabilities' },
    });
    expect(buildCompositionEvent(args())).toEqual(buildCompositionEvent(args()));
  });

  it('empty sections stay honest: zero totals, no throw', () => {
    const event = buildCompositionEvent({ sections: [], usage: null });
    expect(event.sections).toEqual([]);
    expect(event.totals).toEqual({ chars: 0, tokens: 0, tokenSource: 'approx' });
  });
});

describe('defensive: negative provider counts', () => {
  it('treats a negative promptTokens as absence — approx ladder, never a negative measurement', () => {
    const sections = [
      Object.freeze({ id: 'identity', label: 'IDENTITY', text: 'x'.repeat(400) }),
      Object.freeze({ id: 'soul', label: 'SOUL', text: 'y'.repeat(100) })
    ];
    const evt = buildCompositionEvent({
      sections,
      usage: Object.freeze({ promptTokens: -5, completionTokens: 3 }),
      toolResults: [],
      budget: null
    });
    expect(evt.totals.tokenSource).toBe('approx');
    for (const s of evt.sections) {
      expect(s.tokenSource).toBe('approx');
      expect(s.tokens).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('session telemetry block', () => {
  const sections = [{ id: 'a', label: 'A', text: 'xx' }];

  it('carries the facts, frozen — count, boundary state, exact ratio', () => {
    const evt = buildCompositionEvent({
      sections, usage: null, toolResults: [], budget: null,
      session: { compactionCount: 2, atBoundary: true, boundaryRatio: 0.8 },
    });
    expect(evt.session).toEqual({ compactionCount: 2, atBoundary: true, boundaryRatio: 0.8 });
    expect(Object.isFrozen(evt.session)).toBe(true);
  });

  it('boundary facts ride only in their exact types — junk fields drop, the count stands', () => {
    const evt = buildCompositionEvent({
      sections, usage: null, toolResults: [], budget: null,
      session: { compactionCount: 1, atBoundary: 'yes', boundaryRatio: 'most' },
    });
    expect(evt.session).toEqual({ compactionCount: 1 });
  });

  it('a dishonest count drops the whole block — never ×undefined on the wire', () => {
    for (const session of [null, undefined, {}, { atBoundary: true }, { compactionCount: -1 }, { compactionCount: 'x' }]) {
      const evt = buildCompositionEvent({ sections, usage: null, toolResults: [], budget: null, session });
      expect('session' in evt).toBe(false);
    }
  });
});

describe('lastRecordedComposition — the resume replay source', () => {
  const comp = buildCompositionEvent({ sections: [{ id: 'dna', label: 'DNA', text: 'abcd' }] });

  it('finds the NEWEST assistant record carrying a composition', () => {
    const older = buildCompositionEvent({ sections: [{ id: 'soul', label: 'Soul', text: 'xy' }] });
    const entries = [
      { role: 'user', content: 'hi', timestamp: 't1' },
      { role: 'assistant', content: 'a', composition: older, timestamp: 't2' },
      { role: 'user', content: 'again', timestamp: 't3' },
      { role: 'assistant', content: 'b', composition: comp, timestamp: 't4' },
    ];
    expect(lastRecordedComposition(entries)).toEqual({ composition: comp, at: 't4' });
  });

  it('skips assistant records without a composition (pre-feature rows)', () => {
    const entries = [
      { role: 'assistant', content: 'a', composition: comp, timestamp: 't1' },
      { role: 'user', content: 'q', timestamp: 't2' },
      { role: 'assistant', content: 'plain', timestamp: 't3' },
    ];
    expect(lastRecordedComposition(entries)).toEqual({ composition: comp, at: 't1' });
  });

  it('nothing recorded → null; a stampless record carries at: null', () => {
    expect(lastRecordedComposition([])).toBeNull();
    expect(lastRecordedComposition([{ role: 'user', content: 'q' }])).toBeNull();
    expect(lastRecordedComposition(null)).toBeNull();
    expect(lastRecordedComposition([{ role: 'assistant', composition: comp }]))
      .toEqual({ composition: comp, at: null });
  });

  it('garbage rows never throw the scan', () => {
    const entries = [null, 42, 'row', { role: 'assistant', composition: 'not-an-object' },
      { role: 'assistant', composition: comp, timestamp: 't9' }];
    expect(lastRecordedComposition(entries)).toEqual({ composition: comp, at: 't9' });
  });
});
