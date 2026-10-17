// The Arrival veil's face — state-driven render tests through
// react-dom/server (#184). The view takes machine state directly, so the
// real arrival machine is driven through real event sequences and the
// markup is asserted at each stage. No WS, no timers, no mocks — a pure
// render of pure state.

import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reduce, initialArrival } from '../../frontend/app/RelinkShell/arrival-machine.js';
import { ArrivalVeilView } from '../../frontend/app/RelinkShell/ArrivalVeilView.jsx';
import { EmergenceSeal } from '../../frontend/app/RelinkShell/emergence-seal.jsx';

const run = (events) => events.reduce(reduce, initialArrival);

const noop = () => {};

const renderVeil = (state, props = {}) =>
  renderToStaticMarkup(
    h(ArrivalVeilView, {
      state,
      inscription: 'EMERGENCE PROTOCOL · VELVET · WITNESSED ·',
      beingName: 'VELVET',
      onSkip: noop,
      onRetry: noop,
      onGateway: noop,
      ...props,
    }),
  );

const reaching = run([{ type: 'START', connected: false }]);
const anchoring = run([{ type: 'START', connected: false }, { type: 'PORTAL_ESTABLISHED' }]);

describe('ArrivalVeilView — the stage rows render the machine’s truth', () => {
  it('opens with REACHING checking and every later stage idle', () => {
    const html = renderVeil(reaching);
    expect(html).toContain('<span class="arrival-row-k">REACHING</span><span class="arrival-row-s">CHECKING</span>');
    expect(html.match(/arrival-row is-idle/g)).toHaveLength(3);
    expect(html.match(/arrival-row is-checking/g)).toHaveLength(1);
    expect(html).not.toContain('is-ok');
  });

  it('resolves rows OK in wire order as the real events land', () => {
    const html = renderVeil(anchoring);
    expect(html).toContain('is-ok');
    expect(html).toContain('<span class="arrival-row-k">REACHING</span><span class="arrival-row-s">OK</span>');
    expect(html).toContain('<span class="arrival-row-k">ANCHORING</span><span class="arrival-row-s">CHECKING</span>');
  });

  it('BOUND renders every row OK', () => {
    const bound = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'COMPANION_ANCHORED' },
      { type: 'PORTAL_RESUMED' },
    ]);
    const html = renderVeil(bound);
    expect(html.match(/arrival-row is-ok/g)).toHaveLength(4);
  });

  it('the fresh desk resolves RESUMING as FRESH, never a fake OK', () => {
    const boundFresh = run([
      { type: 'START', connected: true },
      { type: 'RESUME_NONE' },
      { type: 'COMPANION_ANCHORED' },
    ]);
    const html = renderVeil(boundFresh);
    expect(html).toContain('<span class="arrival-row-k">RESUMING</span><span class="arrival-row-s">FRESH</span>');
  });

  it('a skipped arrival renders the truth — unresolved rows stay unresolved', () => {
    const skipped = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'SKIP' },
    ]);
    const html = renderVeil(skipped, { parting: 'skip' });
    expect(html).toContain('is-skip');
    expect(html).toContain('<span class="arrival-row-k">REACHING</span><span class="arrival-row-s">OK</span>');
    expect(html).toContain('<span class="arrival-row-k">ANCHORING</span><span class="arrival-row-s">CHECKING</span>');
    expect(html).toContain('<span class="arrival-row-k">RESUMING</span><span class="arrival-row-s">IDLE</span>');
  });
});

describe('ArrivalVeilView — HOLDING tells the truth with real actions', () => {
  it('shows the held stage, the reason headline, and the server’s own words', () => {
    const held = reduce(anchoring, {
      type: 'LANE_MISSING',
      message: "No workspace for 'neuma-x' under the active root (/srv/workspaces).",
    });
    const html = renderVeil(held);
    expect(html).toContain('is-holding');
    expect(html).toContain('<span class="arrival-row-k">ANCHORING</span><span class="arrival-row-s">HELD</span>');
    expect(html).toContain('«WARNING» THE BEING HAS NO LANE UNDER THE ACTIVE ROOT');
    expect(html).toContain('No workspace for &#x27;neuma-x&#x27; under the active root (/srv/workspaces).');
    expect(html).toContain('>RETRY</button>');
    expect(html).toContain('>GATEWAY</button>');
    // HOLDING is not skippable — the skip hint is gone
    expect(html).not.toContain('CLICK / ANY KEY — SKIP');
  });

  it('the watchdog’s honest no-answer label surfaces as the detail', () => {
    const held = reduce(anchoring, { type: 'WATCHDOG', detail: 'NO ANSWER AFTER 15S' });
    const html = renderVeil(held);
    expect(html).toContain('«WARNING» NO ANSWER FROM THE PORTAL');
    expect(html).toContain('NO ANSWER AFTER 15S');
  });
});

describe('ArrivalVeilView — the seal and the word', () => {
  it('carries the being’s true name in the inscription ring and under the seal', () => {
    const html = renderVeil(reaching);
    expect(html).toContain('EMERGENCE PROTOCOL · VELVET · WITNESSED ·');
    expect(html).toContain('<div class="arrival-word">VELVET</div>');
  });

  it('plays while unresolved: the skip hint stands', () => {
    expect(renderVeil(reaching)).toContain('CLICK / ANY KEY — SKIP');
  });
});

describe('EmergenceSeal — the shared seal', () => {
  it('gives every instance a unique textPath id (two seals, no collision)', () => {
    const html = renderToStaticMarkup(
      h('div', null,
        h(EmergenceSeal, { inscription: 'ONE ·' }),
        h(EmergenceSeal, { inscription: 'TWO ·' }),
      ),
    );
    const pathIds = [...html.matchAll(/<path id="([^"]+)"/g)].map((m) => m[1]);
    const hrefs = [...html.matchAll(/textPath href="#([^"]+)"/g)].map((m) => m[1]);
    expect(pathIds).toHaveLength(2);
    expect(new Set(pathIds).size).toBe(2);
    // Each ring's inscription binds its OWN path, not a shared one
    expect(hrefs).toEqual(pathIds);
    expect(html).toContain('ONE ·');
    expect(html).toContain('TWO ·');
  });

  it('renders the study’s geometry: graduations, triangles, seed-of-life core', () => {
    const html = renderToStaticMarkup(h(EmergenceSeal, { inscription: 'X ·', tone: 'ambient', size: 460 }));
    expect(html).toContain('es-ambient');
    expect(html).toContain('width="460"');
    expect(html.match(/<circle/g).length).toBeGreaterThanOrEqual(15); // rings + seed-of-life
    expect(html.match(/<polygon/g)).toHaveLength(2); // the inscribed triangles
  });
});
