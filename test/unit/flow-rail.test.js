/**
 * Render tests for the desk's flow rail (#185) —
 * frontend/app/RelinkShell/flow-rail.jsx through react-dom/server. Real
 * component, real markup: bare at rest; packets only while real events
 * travel; a junction diamond for tool acts. No mocks.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowRail } from '../../frontend/app/RelinkShell/flow-rail.jsx';

const noop = () => {};
const renderRail = (packets) => renderToStaticMarkup(h(FlowRail, { packets, onReap: noop }));

describe('FlowRail', () => {
  it('is a bare hairline at rest — no packets, no idle pulsing', () => {
    const html = renderRail([]);
    expect(html).toContain('class="desk-flow"');
    expect(html).not.toContain('desk-flow-packet');
    expect(html).not.toContain('desk-flow-junction');
  });

  it('renders an outbound packet for a sent thought and an inbound one for a chunk', () => {
    const html = renderRail([
      { id: 'out-m0', kind: 'out' },
      { id: 'p1', kind: 'in' },
    ]);
    expect(html).toContain('class="desk-flow-packet is-out"');
    expect(html).toContain('class="desk-flow-packet is-in"');
  });

  it('renders a tool act as the mid-rail junction diamond, not a travelling packet', () => {
    const html = renderRail([{ id: 'p0', kind: 'tool' }]);
    expect(html).toContain('class="desk-flow-junction"');
    expect(html).not.toContain('desk-flow-packet');
  });

  it('is presentational only — hidden from the accessibility tree', () => {
    expect(renderRail([{ id: 'p0', kind: 'in' }])).toContain('aria-hidden="true"');
  });
});
