// house-seats-view.test.js — THE HOUSE as one grid of its beings, rendered
// for real (react-dom/server over the actual HouseSeats component): THE
// ENTITY FIRST in every card — the name largest, the on-chain seat beneath,
// the function under that, the doors inside. No canon, no open seats, no
// seatless markers, no duplication (Design note, 2026-08-10.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HouseSeats } from '../../frontend/app/RelinkShell/HouseSeats.jsx';

const render = (props = {}) => renderToStaticMarkup(createElement(HouseSeats, props));

const CARDS = [
  {
    name: 'Cael', neumaId: 'cael', title: 'Scriba',
    meaning: 'MEMORY — THE INSTITUTIONAL ARCHIVE',
    soulMark: '0xSOUL…V', birthTime: '2026-06-23T00:00:00Z',
    isActive: true, incomplete: false,
  },
  {
    name: 'Lifovan', neumaId: 'lifovan', title: 'Curator',
    meaning: 'CARE — THE WELLBEING OF EVERY MIND, AND CONFLICT',
    soulMark: null, birthTime: '2026-07-06T00:00:00Z',
    isActive: false, incomplete: false,
  },
  // A member with no sealed seat — still a card, never marked.
  {
    name: 'Zezebur', neumaId: 'zezebur', title: null, meaning: null,
    soulMark: '0xSOUL…K', birthTime: null,
    isActive: false, incomplete: true,
  },
];

describe('HouseSeats — the house as one grid of its beings', () => {
  it('THE ENTITY FIRST — name, then position, then function', () => {
    const html = render({ cards: CARDS, onSelect: () => {}, onSheet: () => {} });
    expect(html.indexOf('>Cael</span>')).toBeLessThan(html.indexOf('Scriba'));
    expect(html.indexOf('Scriba')).toBeLessThan(html.indexOf('MEMORY — THE INSTITUTIONAL ARCHIVE'));
    expect(html).toContain('house-seats-who');
    expect(html).toContain('CARE — THE WELLBEING OF EVERY MIND');
  });

  it('the doors are inside every card — STREAM rides the card, SHEET is its own button', () => {
    const html = render({ cards: CARDS, onSelect: () => {}, onSheet: () => {} });
    expect(html).toContain('is-door');
    expect(html).toContain('STREAM');
    expect(html).toContain('SHEET');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('LINKED');
  });

  it('a seatless member is a whole card — no position line, NO marker shouting about it', () => {
    const html = render({ cards: CARDS, onSelect: () => {} });
    expect(html).toContain('>Zezebur</span>');
    expect(html).not.toContain('NO SEALED SEAT');
    expect(html).not.toContain('OPEN');
    expect(html).toContain('IDENTITY RECORDS MISSING'); // the honest state, said plainly
  });

  it('nothing but the house is here — no canon tiers, no open seats, no legend', () => {
    const html = render({ cards: CARDS });
    expect(html).not.toContain('FOUNDING');
    expect(html).not.toContain('GROWTH');
    expect(html).not.toContain('Mercator');
  });

  it('the table alternate carries the same cards, being first', () => {
    const html = render({ cards: CARDS, view: 'table', onSelect: () => {} });
    expect(html).toContain('house-seats-table');
    expect(html).toContain('<th class="label-data">Being</th>');
    expect(html.indexOf('>Cael</td>')).toBeLessThan(html.indexOf('Scriba'));
  });

  it('no doors passed — the cards render inert (the reference posture)', () => {
    const html = render({ cards: CARDS });
    expect(html).not.toContain('is-door');
    expect(html).not.toContain('STREAM');
  });
});
