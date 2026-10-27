/**
 * THE MANDATE THAT STANDS, AS MARKS (show-dont-tell-audit.md finding 4) —
 * the pure fold with real inputs and real outputs, and SEAT's standing block
 * rendered for real (renderToStaticMarkup): the grant's own marks, a days-left
 * bar against the term, one mark per tripwire named in its own words, the
 * hostile-text hold beside them, and no sentence left on the screen.
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRIPS, HOLD_WORDS, plainWords } from '../../backend/services/marketing/mandate/mandate-shape.js';
import { standingMarks } from '../../frontend/app/RelinkShell/mandate/mandate-view.js';
import { MandateStanding } from '../../frontend/app/RelinkShell/mandate/MandateStanding.jsx';

const NOW = Date.parse('2026-10-24T08:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const mandate = (over = {}) => ({
  id: 'md_1', days: 7, grantedAt: new Date(NOW - 2 * DAY).toISOString(), expiresAt: new Date(NOW + 5 * DAY).toISOString(), timeZone: 'UTC',
  accounts: [{ id: 'x-1', channelId: 'x', companyId: 'ignis', pace: 2 }, { id: 'bluesky-1', channelId: 'bluesky', companyId: null, pace: 3 }],
  acts: { posts: true, renders: true, replies: false }, replyPace: 5, status: 'active', ...over,
});
const view = (over = {}) => ({
  standing: 'active', mandate: mandate(over), trips: TRIPS, holdWords: HOLD_WORDS,
  accounts: [{ id: 'x-1', companyId: 'ignis' }, { id: 'bluesky-1', companyId: null }], companies: [{ id: 'ignis', name: 'Ignis' }],
});

describe('standingMarks', () => {
  test('the grant\'s marks: accounts by company with their pace, the acts', () => {
    const { marks } = standingMarks(view(), NOW);
    expect(marks.companies).toEqual([{ name: 'Ignis', accounts: [{ id: 'x-1', pace: 2 }] }, { name: 'UNSORTED', accounts: [{ id: 'bluesky-1', pace: 3 }] }]);
    expect(marks.acts.map((a) => [a.id, a.on, a.pace])).toEqual([['posts', true, undefined], ['renders', true, undefined], ['replies', false, null]]);
    expect(standingMarks(view({ acts: { posts: true, renders: false, replies: true }, replyPace: 9 }), NOW).marks.acts[2]).toMatchObject({ on: true, pace: 9 });
  });

  test('days left against the term: 5 of 7, the day it ends; ended reads ENDED; no end reads NO END; unreadable reads —', () => {
    expect(standingMarks(view(), NOW).left).toEqual({ value: 5, max: 7, text: '5D · Oct 29', title: '5 of 7 days left — it turns itself off on Oct 29, then everything asks you again' });
    expect(standingMarks(view({ expiresAt: new Date(NOW - DAY).toISOString() }), NOW).left).toMatchObject({ value: 0, max: 7, text: 'ENDED · Oct 23' });
    expect(standingMarks(view({ expiresAt: null }), NOW).left).toMatchObject({ value: null, text: 'NO END' });
    expect(standingMarks(view({ expiresAt: 'soon' }), NOW).left).toMatchObject({ value: null, text: '—' });
    // A part day still counts as a day left, as the tray says it.
    expect(standingMarks(view({ expiresAt: new Date(NOW + 4.2 * DAY).toISOString() }), NOW).left.text).toBe('5D · Oct 28');
  });
});

describe('MandateStanding — rendered', () => {
  const html = renderToStaticMarkup(createElement(MandateStanding, { view: view(), now: NOW }));

  test('the grant as marks and numbers, a days-left bar, no sentence', () => {
    expect(html).toContain('x-1 · <b>2</b>/DAY');
    expect(html).toContain('data-days-left');
    expect(html).toContain('5D · Oct 29');
    expect(html).toMatch(/class="hud-bar-fill" style="transform:scaleX\(0\.714/);
    for (const sentence of plainWords(mandate())) expect(html).not.toContain(`>${sentence}<`);
  });

  test('one mark per tripwire, named on hover in its own words; the hold beside them; an act not granted says it still asks', () => {
    for (const [kind, words] of Object.entries(TRIPS)) expect(html).toContain(`data-trip="${kind}" title="${words.replace(/'/g, '&#x27;')}"`);
    expect((html.match(/data-trip="/g) || []).length).toBe(7);
    expect(html).toContain('data-hold-mark');
    expect(html).toContain('title="REPLIES: not granted — still asks you"');
  });
});
