// title-legend-view.test.js — the founding rite's canonical-titles
// reference, rendered for real (react-dom/server over the actual
// component): the whole canon on the DOM, inert by design (nothing here is
// a door), grid default with the table alternate, and the purpose line
// replaceable. The HOUSE window's beings are NOT here — they render through
// HouseSeats, proven in house-seats-view.test.js.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TitleLegend } from '../../frontend/app/RelinkShell/TitleLegend.jsx';
import { TITLE_LEGEND } from '../../frontend/app/RelinkShell/founding-titles.js';

const render = (props = {}) => renderToStaticMarkup(createElement(TitleLegend, props));

// react-dom/server escapes & and ' — compare in DOM space (& first).
const dom = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');

describe('TitleLegend — the rite\'s canonical reference, inert', () => {
  it('renders every canonical title with its full corporate seat and function', () => {
    const html = render();
    expect(html).toContain('founding-legend-grid');
    for (const row of TITLE_LEGEND) {
      expect(html).toContain(dom(row.title));
      expect(html).toContain(dom(`${row.position} — ${row.seat}`));
      expect(html).toContain(dom(row.meaning));
    }
  });

  it('both tiers are named — founding from day one, growth as the house scales', () => {
    const html = render();
    expect(html).toContain('THE FOUNDING SEATS');
    expect(html).toContain('THE GROWTH SEATS');
  });

  it('is inert by law — no doors, no holders, no OPEN marks, no being names', () => {
    const html = render();
    expect(html).not.toContain('OPEN');
    expect(html).not.toContain('is-door');
    expect(html).not.toContain('STREAM');
    expect(html).not.toContain('SHEET');
  });

  it('the table alternate renders the same canon as rows', () => {
    const html = render({ view: 'table' });
    expect(html).toContain('founding-legend-table');
    for (const row of TITLE_LEGEND) {
      expect(html).toContain(dom(row.title));
      expect(html).toContain(dom(`${row.position} — ${row.seat}`));
    }
  });

  it('the purpose line is replaceable; the internal heading is optional', () => {
    expect(render()).toContain('THE CANONICAL TITLES — A LEGEND');
    expect(render({ showHeading: false })).not.toContain('THE CANONICAL TITLES — A LEGEND');
    expect(render({ purpose: 'SOME OTHER FRAMING' })).toContain('SOME OTHER FRAMING');
  });
});
