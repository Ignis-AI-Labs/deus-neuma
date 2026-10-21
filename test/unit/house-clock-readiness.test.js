/**
 * What the house lacks to work, said in the House Clock header (2026-10-18:
 * a house with no shared ground silently lost its board, its post and its
 * charges) — the pure wording, and the header as the operator sees it, with
 * a charter and before one is written.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readinessWarnings } from '../../frontend/app/RelinkShell/house-clock/house-clock-view.js';
import { HouseClockBody } from '../../frontend/app/RelinkShell/house-clock/HouseClockBody.jsx';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';

const charter = normalizeCharter({ goal: 'Ship one digest a week.', seats: [{ laneId: 'optio', dailyCap: 4 }, { laneId: 'mate', dailyCap: 4 }] });
const keys = (readiness, c = charter) => readinessWarnings(c, readiness).map((w) => w.key);

describe('what the house lacks to work', () => {
  it('no shared ground, no Optio, an Optio the charter does not seat — each said; a ready house says nothing', () => {
    expect(keys({ ground: '/house', optio: 'optio' })).toEqual([]);
    expect(keys({ ground: null, optio: 'optio' })).toEqual(['ground']);
    expect(keys({ ground: '/house', optio: null })).toEqual(['optio']);
    expect(keys({ ground: '/house', optio: 'stranger' })).toEqual(['optio-seat']);
    expect(keys({ ground: null, optio: null })).toEqual(['ground', 'optio']);
  });
  it('before a charter is written the ground and the Optio are said too; the Optio\'s seat waits for a charter', () => {
    expect(keys({ ground: null, optio: null }, null)).toEqual(['ground', 'optio']);
    expect(keys({ ground: '/house', optio: 'stranger' }, null)).toEqual([]);
    expect(keys({ ground: null, optio: 'optio' }, null)).toEqual(['ground']);
  });
  it('a model line of one slot is said: house wakes take turns with the operator\'s chat; a wider line says nothing', () => {
    expect(keys({ ground: '/house', optio: 'optio', lineSlots: 1 })).toEqual(['one-slot']);
    expect(keys({ ground: '/house', optio: 'optio', lineSlots: 4 })).toEqual([]);
    expect(keys({ ground: '/house', optio: 'optio' })).toEqual([]);
    expect(readinessWarnings(charter, { ground: '/house', optio: 'optio', lineSlots: 1 })[0].words)
      .toBe('ONE SLOT ON THE MODEL LINE — house wakes run one at a time and take turns with your chat, first come first served: a wake waits for a reply in progress, and your next message waits for a wake at work.');
  });
  it('nothing before the reading is in', () => {
    expect(keys(null)).toEqual([]);
    expect(keys(null, null)).toEqual([]);
  });
  it('the header says it, in the operator\'s words, under the standing', () => {
    const html = renderToStaticMarkup(createElement(HouseClockBody, {
      charter, readiness: { ground: null, optio: 'optio' }, tab: 'charter', history: [], asks: [], names: {}, onTab: () => {},
    }));
    expect(html).toContain('data-warn="ground"');
    expect(html).toContain('NO HOUSE GROUND — the Optio cannot charge members, post, or keep the board.');
    const ready = renderToStaticMarkup(createElement(HouseClockBody, {
      charter, readiness: { ground: '/house', optio: 'optio' }, tab: 'charter', history: [], asks: [], names: {}, onTab: () => {},
    }));
    expect(ready).not.toContain('hclock-warn');
    // no charter: the header says NO CHARTER, and the warnings what else is missing
    const bare = renderToStaticMarkup(createElement(HouseClockBody, {
      charter: null, readiness: { ground: null, optio: null }, tab: 'charter', history: [], asks: [], names: {}, onTab: () => {},
    }));
    expect(bare).toContain('NO CHARTER');
    expect(bare).toContain('data-warn="ground"');
    expect(bare).toContain('NO OPTIO SEATED — the review cadence wakes no one, and team plans come to you.');
  });
});
