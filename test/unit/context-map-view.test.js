// CONTEXT MAP composition view — real render of real events. The events
// come from the REAL buildCompositionEvent (the exact builder the backend
// emits through) and the markup from a real react-dom/server render — no
// mocks anywhere in the claimed path (markdown-render.test.js precedent).
//
// This is where the compressed-region (ref node) rendering is proven:
// forcing a real over-cap tool result through the live substrate in e2e is
// nondeterministic (the neuma must choose a tool AND its output must cross
// the compression cap), so the node markup is proven here against a real
// event object instead — see test/e2e/context-map.spec.js.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompositionView, TokenFigure } from '../../frontend/app/RelinkShell/ContextMapApp.jsx';
import { formatClockStamp } from '../../frontend/utils/format.js';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';

const render = (composition) =>
  renderToStaticMarkup(createElement(CompositionView, { composition }));

const SECTIONS = [
  { id: 'dna', label: 'DNA', text: 'x'.repeat(4000) },
  { id: 'soul', label: 'Soul', text: 'y'.repeat(1000) },
  { id: 'memory', label: 'Memory', text: 'z'.repeat(3000) },
];

describe('CONTEXT MAP — composition view (real events, real render)', () => {
  it('renders the honest empty state before any turn', () => {
    const html = render(null);
    expect(html).toContain('NO TURN OBSERVED YET THIS SESSION');
    expect(html).not.toContain('ctx-row'); // nothing fabricated
  });

  it('approx event (no usage): every count reads ~N with an EST tag', () => {
    const html = render(buildCompositionEvent({ sections: SECTIONS }));
    expect(html).toContain('DNA');
    expect(html).toContain('4,000 CH');
    expect(html).toContain('~1,000'); // 4000 chars / 4
    expect(html).toContain('EST');
    // No usage → the total is approx too, never a plain measured figure.
    expect(html).toContain('~2,000'); // 8000 chars / 4
    expect(html).not.toContain('ctx-tok-measured');
  });

  it('measured event: plain measured total, attributed sections stay ~N EST', () => {
    const html = render(buildCompositionEvent({
      sections: SECTIONS,
      usage: { promptTokens: 1600, completionTokens: 10 },
    }));
    expect(html).toContain('ctx-tok-measured');
    expect(html).toContain('>1,600'); // the measured total, no tilde
    expect(html).not.toContain('~1,600');
    expect(html).toContain('~800'); // dna: 1600 * 4000/8000, attributed
    expect(html).toContain('EST');
  });

  it('budget: real used/total with its source when known', () => {
    const html = render(buildCompositionEvent({
      sections: SECTIONS,
      usage: { promptTokens: 1600 },
      budget: { contextTokens: 32768, source: 'provider' },
    }));
    expect(html).toContain('32,768');
    expect(html).toContain('PROVIDER');
  });

  it('budget: unknown renders the honest dash, never an invented ceiling', () => {
    const html = render(buildCompositionEvent({ sections: SECTIONS, budget: null }));
    expect(html).toContain('— / UNKNOWN');
  });

  it('compressed regions: collapsed nodes carry ref, tool, real kept counts, kind', () => {
    const html = render(buildCompositionEvent({
      sections: SECTIONS,
      toolResults: [
        { ref: 'tr_9f3a2c1b', tool: 'read_file', originalChars: 48210, sentChars: 2000, kind: 'reformatted' },
        { ref: 'tr_0d4e5f6a', tool: 'list_directory', originalChars: 9001, sentChars: 9001, kind: 'verbatim' },
      ],
    }));
    expect(html).toContain('tr_9f3a2c1b');
    expect(html).toContain('READ_FILE · KEPT ~500 OF ~12,053 TOK'); // chars/4 — the operator budgets in tokens
    expect(html).toContain('REFORMATTED');
    expect(html).toContain('VERBATIM');
    expect(html).toContain('tabindex="0"'); // nodes are keyboard-reachable
  });

  it('no refs: says so honestly instead of hiding the section', () => {
    const html = render(buildCompositionEvent({ sections: SECTIONS }));
    expect(html).toContain('COMPRESSED REGIONS');
    expect(html).toContain('None this session');
  });

  it('TokenFigure never emits a bare number for a non-measured source', () => {
    const est = renderToStaticMarkup(createElement(TokenFigure, { tokens: 42, tokenSource: 'approx' }));
    expect(est).toContain('~42');
    expect(est).toContain('EST');
    const measured = renderToStaticMarkup(createElement(TokenFigure, { tokens: 42, tokenSource: 'measured' }));
    expect(measured).toContain('>42<');
    expect(measured).not.toContain('~');
  });
});

describe('replayed composition — the AS RECORDED heading', () => {
  it('a live event never wears the recorded tag', () => {
    const html = render(buildCompositionEvent({ sections: SECTIONS }));
    expect(html).toContain('WINDOW ANATOMY · LAST TURN');
    expect(html).not.toContain('AS RECORDED');
  });

  it('a replayed event says AS RECORDED with its recorded moment', () => {
    const event = buildCompositionEvent({ sections: SECTIONS });
    const at = '2026-07-24T13:05:00.000Z';
    const html = render({ ...event, replayed: true, at });
    expect(html).toContain(`AS RECORDED ${formatClockStamp(at).toUpperCase()}`);
  });

  it('a stampless replay still says AS RECORDED, with no invented time', () => {
    const event = buildCompositionEvent({ sections: SECTIONS });
    const html = render({ ...event, replayed: true, at: null });
    expect(html).toContain('WINDOW ANATOMY · LAST TURN · AS RECORDED</p>');
  });
});
