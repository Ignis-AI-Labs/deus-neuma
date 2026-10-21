/**
 * TAB STRIP — what the operator actually sees when sittings run in parallel.
 *
 * Rendered for real through react-dom/server (the same way ThoughtBubble and
 * the CONTEXT MAP views are proven): no DOM mock, no shallow renderer, no
 * assertion about props standing in for output.
 *
 * The properties pinned here: a tab wears its KIND, the focused one is
 * distinguishable, and no tab is ever held or refused for the rig (2026-10-15 —
 * the measured number caps generation in the house's line, never the strip).
 *
 * ONE DOOR (ruling, 2026-07-30): the strip no longer asks which kind to open. It
 * inherits the kind from whoever is in the chair.
 *
 * OPENING IS FREE (ruling, 2026-08-29): any number of tabs may be open; only
 * how many are ACTIVE is limited — opening is never refused, activating past
 * the limit is. So the door carries no full-mark at all, and the acts that really do
 * connect a portal — first focus, tear-out — carry it instead.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabStrip } from '../../frontend/app/RelinkShell/TabStrip.jsx';
import { TAB_KIND } from '../../core/runtime/tab-budget.js';
// the strip speaks through i18n (18e10fe66): boot it as the desk does, in English
import '../../frontend/i18n/index.js';

const tabs = [
  { id: 'a', kind: TAB_KIND.local, neumaId: 'alder', name: 'ALDER' },
  { id: 'b', kind: TAB_KIND.witness, neumaId: 'witness-kimi-code-Fern', name: 'FERN' },
];

const render = (props) => renderToStaticMarkup(createElement(TabStrip, {
  tabs,
  focusedId: 'a',
  ...props,
}));

describe('TabStrip', () => {
  it('draws nothing at all when no sitting is open', () => {
    expect(render({ tabs: [] })).toBe('');
    expect(render({ tabs: null })).toBe('');
  });

  it('renders with a SINGLE tab — the door to the second lives here', () => {
    const html = render({ tabs: [tabs[0]] });
    expect(html).toContain('ALDER');
    expect(html).toContain('+ TAB');
  });

  it('offers ONE door, never a choice of kind', () => {
    const html = render({});
    expect((html.match(/tabstrip-new/g) || []).length).toBe(1);
    expect(html).not.toContain('+ NEUMA');
    expect(html).not.toContain('+ WITNESS');
  });

  it('the door NAMES who the new tab would arrive holding', () => {
    const html = render({ nextName: 'Juniper', nextKind: 'witness' });
    expect(html).toMatch(/JUNIPER/);
    expect(html).toContain('data-kind="witness"');
  });

  it('names every open sitting', () => {
    const html = render({});
    expect(html).toContain('ALDER');
    expect(html).toContain('FERN');
  });

  it('the FOCUSED tab is distinguishable, and only one is', () => {
    const html = render({ focusedId: 'b' });
    expect((html.match(/is-on/g) || []).length).toBe(1);
    expect((html.match(/aria-selected="true"/g) || []).length).toBe(1);
  });

  it('a tab wears its KIND — the operator can see which budget they spend', () => {
    const html = render({});
    expect(html).toContain('is-local');
    expect(html).toContain('is-witness');
    expect(html).toMatch(/on this machine/);
    expect(html).toMatch(/sealed witness/);
  });

  it('every sitting can be closed, and the control says which', () => {
    const html = render({});
    expect(html).toContain('Close ALDER');
    expect(html).toContain('Close FERN');
  });

  it('THE DOOR NEVER REFUSES — opening a tab costs the machine nothing', () => {
    // Opening many tabs is never refused (ruling, 2026-08-29).
    // A tab is a row of state; the server counts sittings by CONNECTION, and
    // nothing connects when one appears. A machine 99 sittings deep must still
    // hand the operator another tab — it is where the sitting waits.
    const doorTag = (html) => {
      const at = html.indexOf('+ TAB');
      return html.slice(html.lastIndexOf('<button', at), at);
    };
    const door = doorTag(render({}));
    expect(door).not.toContain('data-full');
    expect(door).not.toContain('aria-disabled');
  });

  // NOTHING IS HELD FOR THE RIG (ruling, 2026-10-15: a parallel cap of 3 never
  // stops a fourth tab from being open). Every tab connects; generation waits in the house line.
  it('no tab wears a HELD mark, whatever the machine runs', () => {
    const html = render({});
    expect(html).not.toContain('data-held');
    expect(html).not.toContain('is-held');
    expect(html).not.toContain('« NOTICE »');
  });

  it('NO POP-OUT BUTTON — a sitting leaves only by being dragged out of its window', () => {
    // A button is too easy to hit by accident while moving a tab around
    // (ruling, 2026-10-05). The drag is the only way out.
    const html = render({});
    expect(html).not.toContain('tabstrip-tear');
    expect(html).not.toContain('in its own window');
  });

  it('tabs are DRAGGABLE — reordering and pulling out are a gesture, not a menu', () => {
    const html = render({});
    expect((html.match(/draggable="true"/g) || []).length).toBe(2);
  });
});
