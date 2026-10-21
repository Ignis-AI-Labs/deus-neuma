/**
 * CONTEXT MAP anatomy — one real context:composition event (the REAL builder
 * the backend emits through) shaped into the window, the families and the
 * cuts. Two totals stay apart: the window (what the next turn inherits) and the
 * last request (the section total, which in-turn tool machinery can inflate).
 */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';
import { cutsOf, familiesOf, familyOf, windowOf } from '../../frontend/app/RelinkShell/context-anatomy.js';
import { CompositionView } from '../../frontend/app/RelinkShell/CompositionView.jsx';

const SECTIONS = [
  { id: 'identity', label: 'IDENTITY', text: 'i'.repeat(8000) },
  { id: 'soul', label: 'SOUL', text: 's'.repeat(4000) },
  { id: 'tools', label: 'TOOLS', text: 't'.repeat(6000) },
  { id: 'memory', label: 'MEMORY', text: 'm'.repeat(2000) },
  { id: 'taste', label: 'YOUR EYE', text: '' },
  { id: 'recentConversation', label: 'RECENT CONVERSATION', text: 'c'.repeat(12000) },
  { id: 'currentTurn', label: 'CURRENT TURN', text: 'u'.repeat(400) },
  { id: 'toolRound1', label: 'TOOL ROUND 1', text: 'r'.repeat(7600) },
];
const EVENT = buildCompositionEvent({
  sections: SECTIONS,
  standing: { promptTokens: 8000, source: 'measured' },
  usage: { promptTokens: 10000, completionTokens: 500 },
  budget: { contextTokens: 65536, source: 'provider-runtime' },
  cache: { cachedPromptTokens: 6000 },
  session: { compactionCount: 2, atBoundary: false },
});

describe('anatomy — the window', () => {
  test('the window is what the next turn inherits: standing input + output, against the budget', () => {
    const w = windowOf(EVENT);
    expect(w).toMatchObject({ budget: 65536, input: 8000, output: 500, used: 8500, peak: 10000, cached: 6000, source: 'measured' });
    expect(w.free).toBe(65536 - 8500);
    expect(w.ratio).toBeCloseTo(8500 / 65536, 6);
  });

  test('an unknown budget leaves free and ratio unmeasured, never a made-up ceiling', () => {
    const w = windowOf(buildCompositionEvent({ sections: SECTIONS }));
    expect(w.budget).toBeNull();
    expect(w.free).toBeNull();
    expect(w.ratio).toBeNull();
  });
});

describe('anatomy — what fills it', () => {
  test('every section belongs to a family; tool rounds and folds are tool machinery', () => {
    expect(['identity', 'soul', 'taste', 'tools', 'houseSeat', 'memory', 'recentConversation', 'toolRound1', 'fold2', 'somethingNew'].map(familyOf))
      .toEqual(['identity', 'identity', 'identity', 'platform', 'work', 'moment', 'conversation', 'tools', 'tools', 'other']);
  });

  test('families sum to the section total exactly, largest first; empty sections are counted, not drawn', () => {
    const fams = familiesOf(EVENT);
    expect(fams.reduce((a, f) => a + f.tokens, 0)).toBe(EVENT.totals.tokens);
    expect(fams.map((f) => f.id)).toEqual(['conversation', 'identity', 'tools', 'platform', 'moment']);
    const identity = fams.find((f) => f.id === 'identity');
    expect(identity.sections.map((s) => s.id)).toEqual(['identity', 'soul']);
    expect(identity.empty).toBe(1);
    expect(fams.reduce((a, f) => a + f.share, 0)).toBeCloseTo(1, 9);
  });
});

describe('anatomy — what was cut', () => {
  test('shed and degraded are read as they arrived', () => {
    expect(cutsOf({ ...EVENT, shed: [{ id: 'voice', tokens: 400 }], degraded: ['memory'] })).toEqual({ shed: [{ id: 'voice', tokens: 400 }], degraded: ['memory'] });
    expect(cutsOf(EVENT)).toEqual({ shed: [], degraded: [] });
  });
});

describe('the composition view, rendered', () => {
  const html = renderToStaticMarkup(createElement(CompositionView, { composition: EVENT }));
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  test('the window: used of budget, share, left, the peak and the cache named', () => {
    expect(text).toContain('OF 65,536 · 13% USED · 57,036 LEFT');
    expect(text).toContain('WORKING PEAK 10,000');
    expect(text).toContain('CACHE REUSED 6,000');
    expect(text).toContain('COMPACTIONS 2');
  });

  test('the families as doors, the sections ranked, the empty one counted', () => {
    expect((html.match(/class="ctx-fam ctx-fam-/g) || []).length).toBe(5);
    const list = html.slice(html.indexOf('<ol'), html.indexOf('</ol>'));
    const names = [...list.matchAll(/class="ctx-sec-name">([^<]+)</g)].map((m) => m[1]);
    expect(names.slice(0, 3)).toEqual(['RECENT CONVERSATION', 'IDENTITY', 'TOOL ROUND 1']);
    expect(text).toContain('1 EMPTY SECTION THIS TURN');
    expect(text).toContain('NOTHING SHED · NOTHING FAILED THIS TURN');
  });
});
