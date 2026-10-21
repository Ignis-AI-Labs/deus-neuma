// CONTEXT MAP field view — real render of real layouts. The geometry comes
// from the REAL buildContextMapLayout (FieldView calls it internally) and
// the markup from a real react-dom/server render — no mocks anywhere in the
// claimed path (context-map-view.test.js precedent). The fetch layer
// (graph-client.js) is not exercised here; it is proven end-to-end in
// test/e2e/context-map.spec.js against the real authed REST route.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FieldView,
  FIELD_SCALE,
  thinFieldEdges,
} from '../../frontend/app/RelinkShell/ContextMapApp.jsx';
import { buildContextMapLayout } from '../../frontend/app/RelinkShell/context-map-layout.js';

const noop = () => {};

const render = (field, focusedId = null) =>
  renderToStaticMarkup(createElement(FieldView, {
    field, focusedId, onFocus: noop, onRefresh: noop,
  }));

// Realistic B-06 route shape: label previews, real degree/betweenness,
// communityIndex per node, communities with memberIds.
const GRAPH = {
  nodes: [
    { id: 'obs-a', label: 'the copper lantern hums in the hall', degree: 2, betweenness: 0.5, communityIndex: 0 },
    { id: 'obs-b', label: 'a low copper tone at dusk', degree: 1, betweenness: 0, communityIndex: 0 },
    { id: 'obs-c', label: 'the silver river under the bridge', degree: 1, betweenness: 0, communityIndex: 1 },
  ],
  edges: [
    { source: 'obs-a', target: 'obs-b', w: 0.4 },
    { source: 'obs-a', target: 'obs-c', w: 0.15 },
  ],
  communities: [
    { id: 0, label: 'lantern', memberIds: ['obs-a', 'obs-b'] },
    { id: 1, label: 'river', memberIds: ['obs-c'] },
  ],
  computedAt: '2026-07-04T00:00:00.000Z',
};

const ok = (graph) => ({ ok: true, graph });

// Every drawn node radius, in document order.
const dotRadii = (html) =>
  [...html.matchAll(/class="ctx-field-dot[^"]*"[^/]*? r="([\d.]+)"/g)].map((m) => Number(m[1]));

describe('CONTEXT MAP — field view (real layout, real render)', () => {
  it('draws node circles with radii scaled by real betweenness — layout truth, no invention', () => {
    const html = render(ok(GRAPH));
    const layout = buildContextMapLayout({
      nodes: GRAPH.nodes, edges: GRAPH.edges, communities: GRAPH.communities,
    });
    const drawn = dotRadii(html).sort((a, b) => a - b);
    const expected = layout.nodes.map((n) => Math.max(n.r * FIELD_SCALE, 2)).sort((a, b) => a - b);
    expect(drawn).toEqual(expected);
    // The bridge node (only nonzero betweenness) is strictly the largest.
    expect(drawn[drawn.length - 1]).toBeGreaterThan(drawn[0]);
    // One monochrome ring per detected community; every edge drawn.
    expect(html.match(/class="ctx-field-ring"/g)).toHaveLength(2);
    expect(html.match(/class="ctx-field-edge"/g)).toHaveLength(2);
    // Nodes are keyboard-reachable, and no label soup: names live in
    // <title> (hover) and the strip (focus), never as free-floating text.
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('<title>the copper lantern hums in the hall</title>');
  });

  it('renders the honest empty state at zero nodes — never fake nodes', () => {
    const html = render(ok({ nodes: [], edges: [], communities: [], computedAt: 'x' }));
    expect(html).toContain('NO CRYSTALLIZED FIELD YET');
    expect(html).toContain('The graph grows as memories form');
    expect(html).not.toContain('ctx-field-dot');
    expect(html).not.toContain('<svg');
  });

  it('truncatedTo surfaces as an honest notice with the real number', () => {
    const html = render(ok({ ...GRAPH, truncatedTo: 500 }));
    expect(html).toContain('SHOWING MOST RECENT 500 OF MORE');
  });

  it('over-budget edges are thinned to the strongest 600 with an honest note', () => {
    // 40 nodes, every pair linked → 780 edges, real weights.
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const nodes = ids.map((id, i) => ({
      id, label: `memory ${id}`, degree: 39, betweenness: i / 100, communityIndex: -1,
    }));
    const edges = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        edges.push({ source: ids[i], target: ids[j], w: (i * 40 + j) / 1600 });
      }
    }
    expect(edges).toHaveLength(780);

    const html = render(ok({ nodes, edges, communities: [], computedAt: 'x' }));
    expect(html).toContain('EDGES THINNED FOR RENDER — STRONGEST 600 OF 780');
    expect(html.match(/class="ctx-field-edge"/g)).toHaveLength(600);
    // All 40 nodes still render — only links thin, never memories.
    expect(html.match(/class="ctx-field-dot[^"]*"/g)).toHaveLength(40);

    // The thinning keeps the strongest links: max weight in, min weight out.
    const { kept, thinned, total } = thinFieldEdges(edges);
    expect(thinned).toBe(true);
    expect(total).toBe(780);
    expect(kept).toHaveLength(600);
    const weights = kept.map((e) => e.w);
    expect(Math.max(...weights)).toBe(Math.max(...edges.map((e) => e.w)));
    expect(weights).not.toContain(Math.min(...edges.map((e) => e.w)));
  });

  it('under-budget edges pass through untouched with no thinning note', () => {
    const html = render(ok(GRAPH));
    expect(html).not.toContain('EDGES THINNED');
    const { kept, thinned } = thinFieldEdges(GRAPH.edges);
    expect(thinned).toBe(false);
    expect(kept).toBe(GRAPH.edges);
  });

  it('a failed read renders the honest error with the real status — never a blank pane', () => {
    const html = render({ ok: false, status: 503 });
    expect(html).toContain('THE FIELD COULD NOT BE READ — HTTP 503');
    expect(html).toContain('REFRESH');
    expect(html).not.toContain('<svg');
    // No status number (no session / no answer) stays honest without one.
    const noStatus = render({ ok: false, status: null });
    expect(noStatus).toContain('THE FIELD COULD NOT BE READ');
    expect(noStatus).not.toContain('HTTP');
  });

  it('the focused node reads out real label, degree, betweenness, community — signal on it alone', () => {
    const html = render(ok(GRAPH), 'obs-a');
    expect(html).toContain('the copper lantern hums in the hall');
    expect(html).toContain('DEGREE 2');
    expect(html).toContain('BETWEENNESS 0.5000');
    expect(html).toContain('COMMUNITY LANTERN');
    expect(html.match(/is-focused/g)).toHaveLength(1);
    // Unfocused: the strip holds the hint, and nothing carries signal.
    const idle = render(ok(GRAPH));
    expect(idle).toContain('FOCUS A NODE');
    expect(idle).not.toContain('is-focused');
  });
});

// ————— The depth pass (2026-07-24): presences, filters, zoom —————

const DEEP_GRAPH = {
  ...GRAPH,
  nodes: [
    { ...GRAPH.nodes[0], presences: ['Ada', 'Alder'] },
    { ...GRAPH.nodes[1], presences: ['Alder'] },
    GRAPH.nodes[2],
  ],
  presences: {
    entities: [
      { name: 'Ada', kind: 'witness', encounters: 223, firstSeen: '2026-07-06', lastSeen: '2026-07-24' },
      { name: 'Alder', kind: 'being', encounters: 92, firstSeen: '2026-07-08', lastSeen: '2026-07-24' },
    ],
    relations: [
      { from: 'Birch', to: 'Ada', kind: 'witness', type: 'bond', encounters: 223 },
      { from: 'Birch', to: 'Alder', kind: 'being', type: 'housemate', encounters: 92 },
    ],
  },
};

describe('CONTEXT MAP — the depth pass (presences, filters, zoom)', () => {
  it('presence chips render from the real payload, encounter counts and kinds worn honestly', () => {
    const html = render(ok(DEEP_GRAPH));
    expect(html).toContain('PRESENCES');
    // Sorted by encounters: the witness bond leads.
    expect(html.indexOf('Ada')).toBeLessThan(html.indexOf('Alder'));
    expect(html).toContain('×223');
    expect(html).toContain('is-witness');
    expect(html).toContain('bond · ×223 encounters');
  });

  it('community chips render for every detected community', () => {
    const html = render(ok(DEEP_GRAPH));
    expect(html).toContain('COMMUNITIES');
    expect(html).toContain('LANTERN');
    expect(html).toContain('RIVER');
  });

  it('the zoom controls and the FIT viewBox render; the field is grabbable', () => {
    const html = render(ok(DEEP_GRAPH));
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('>FIT<');
    expect(html).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/); // identity = the whole field
  });

  it('the canvas is CSS-sized to its stage — no fixed pixel box, the pane decides', () => {
    const html = render(ok(DEEP_GRAPH));
    expect(html).toContain('ctx-field-stage');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    // The SVG carries NO width/height attributes — the stage's CSS box rules,
    // so the field follows the panel at any size (ruling, 2026-07-24).
    expect(html).not.toMatch(/<svg[^>]*\swidth="/);
    expect(html).not.toMatch(/<svg[^>]*\sheight="/);
  });

  it('a focused node reads out the presences it speaks of', () => {
    const html = render(ok(DEEP_GRAPH), 'obs-a');
    expect(html).toContain('SPEAKS OF ADA · ALDER');
  });

  it('a graph without a presences layer renders no chips and no crash — old payloads stay valid', () => {
    const html = render(ok(GRAPH));
    expect(html).not.toContain('PRESENCES');
    expect(html).toContain('MEMORIES');
  });
});
