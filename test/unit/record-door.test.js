/**
 * A HOUSE RECORD OR PLACE NAMED IN A MEMBER'S WORDS IS A DOOR (RULE 0, nothing
 * faked): the real door table, the real markdown renderer through a real
 * server render, the real place fold the POSITIONS window keeps.
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { recordDoor, splitDoors } from '../../frontend/app/RelinkShell/doors/record-door.js';
import { doorPlan } from '../../frontend/app/RelinkShell/doors/door-plan.js';
import { placeOn } from '../../frontend/app/windowing/position-tiles.js';
import { Markdown } from '../../frontend/app/RelinkShell/Markdown.jsx';
import { WindowContext } from '../../frontend/app/windowing/WindowManager.jsx';
import { positionMapText } from '../../backend/services/positions/position-map.js';

const onDesk = (text) => renderToStaticMarkup(createElement(WindowContext.Provider, { value: { dispatch: () => {}, state: { windows: [] } } }, createElement(Markdown, { text })));

describe('a record or place named in a member\'s words is a door', () => {
  test('an audience, a company, a facts sheet and a campaign each open on their own tab, marked', () => {
    expect(recordDoor('s-e4f50ba1')).toEqual({ kind: 'position', office: 'cro', tab: 'campaigns', reveal: '[data-segment-id="s-e4f50ba1"]', words: 'Open the audience in POSITIONS, CHIEF REVENUE OFFICER' });
    expect(recordDoor('p-1192e6e0')).toMatchObject({ tab: 'campaigns', reveal: '[data-prospect-id="p-1192e6e0"]' });
    expect(recordDoor('fs-0a1b2c3d')).toMatchObject({ tab: 'model', reveal: '[data-facts-sheet]' });
    expect(recordDoor('k-c7539192')).toMatchObject({ tab: 'campaigns', reveal: '[data-campaign-id="k-c7539192"]' });
    expect(doorPlan(recordDoor('s-e4f50ba1'))).toEqual({ open: 'positions', position: { office: 'cro', tab: 'campaigns' }, reveal: '[data-window-id="positions"] [data-segment-id="s-e4f50ba1"]' });
    expect(doorPlan({ kind: 'position' })).toBe(null);
  });

  test('a place is read however the member wrote its steps; a tab is optional', () => {
    expect(recordDoor('POSITIONS → SALES → LEADS')).toEqual({ kind: 'position', office: 'cro', tab: 'leads', reveal: null, words: 'Open POSITIONS, CHIEF REVENUE OFFICER, LEADS' });
    expect(recordDoor('positions, sales, business model')).toMatchObject({ office: 'cro', tab: 'model' });
    expect(recordDoor('POSITIONS → SALES → COMPANY')).toMatchObject({ office: 'cro', tab: 'model', words: 'Open POSITIONS, CHIEF REVENUE OFFICER, COMPANY' });
    expect(recordDoor('POSITIONS > MARKETING')).toMatchObject({ office: 'cmo', tab: null });
    expect(recordDoor('POSITIONS -> TREASURY -> SWITCHES')).toMatchObject({ office: 'cfo', tab: '_switches' });
    // The seat's own name, as members are now told to write it — and its short form and title.
    expect(recordDoor('POSITIONS → CHIEF REVENUE OFFICER → LEADS')).toMatchObject({ office: 'cro', tab: 'leads', words: 'Open POSITIONS, CHIEF REVENUE OFFICER, LEADS' });
    expect(recordDoor('POSITIONS → COS')).toMatchObject({ office: 'cos', words: 'Open POSITIONS, CHIEF OF STAFF' });
    expect(recordDoor('POSITIONS → Quaestor → SWITCHES')).toMatchObject({ office: 'cfo', tab: '_switches' });
  });

  test('anything else stays plain: the decision is narrow', () => {
    for (const not of ['s-e4f50ba', 's-e4f50bag', 'x-e4f50ba1', 'the s-e4f50ba1 audience', 'POSITIONS → KITCHEN', 'SALES → LEADS', 'c-mhz12ab0', '', null]) expect(recordDoor(not), String(not)).toBe(null);
  });

  test('prose is cut into its doors and the words between them', () => {
    expect(splitDoors('The segment (s-e4f50ba1) is still DRAFT. Approve it — POSITIONS → SALES → LEADS → read the audience → APPROVE.')).toEqual([
      { text: 'The segment (', door: false }, { text: 's-e4f50ba1', door: true }, { text: ') is still DRAFT. Approve it — ', door: false },
      { text: 'POSITIONS → SALES → LEADS', door: true }, { text: ' → read the audience → APPROVE.', door: false },
    ]);
    expect(splitDoors('nothing to open here')).toEqual([{ text: 'nothing to open here', door: false }]);
  });

  test('the chat draws each as one press, in code or in prose; a link\'s own words and a fenced block are left alone', () => {
    const html = onDesk('The segment (`s-e4f50ba1`) is still DRAFT. Approve it — POSITIONS → SALES → LEADS — and the gate is open.\n\n```\ns-e4f50ba1\n```\n\n[s-e4f50ba1](https://example.com)');
    expect(html).toContain('<button type="button" class="relink-md-door" title="Open the audience in POSITIONS, CHIEF REVENUE OFFICER" aria-label="s-e4f50ba1 — Open the audience in POSITIONS, CHIEF REVENUE OFFICER"><code>s-e4f50ba1</code></button>');
    expect(html).toContain('title="Open POSITIONS, CHIEF REVENUE OFFICER, LEADS" aria-label="POSITIONS → SALES → LEADS — Open POSITIONS, CHIEF REVENUE OFFICER, LEADS"><code>POSITIONS → SALES → LEADS</code></button>');
    expect(html.match(/relink-md-door/g)).toHaveLength(2);
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">s-e4f50ba1</a>');
    // With no desk to open it on (a page without windows), it is an ordinary code span.
    expect(renderToStaticMarkup(createElement(Markdown, { text: '`s-e4f50ba1`' }))).toBe('<div class="relink-md"><p><code>s-e4f50ba1</code></p></div>');
  });

  test('the window stands on the position and the tab the door named, keeping its other tabs', () => {
    expect(placeOn({ office: 'cos', tabs: { cmo: 'gallery' } }, 'cro', 'leads')).toEqual({ office: 'cro', tabs: { cmo: 'gallery', cro: 'leads' } });
    expect(placeOn({ office: 'cos', tabs: { cro: 'deals' } }, 'cro')).toEqual({ office: 'cro', tabs: { cro: 'deals' } });
    expect(placeOn(null, 'cro', 'leads')).toEqual({ office: 'cro', tabs: { cro: 'leads' } });
  });

  test('every seat holder is told to name the place and the record, so its asks arrive as doors', () => {
    expect(positionMapText(['cro'])).toContain('name the exact place as "POSITIONS → CHIEF REVENUE OFFICER → <the tab>", and name a record by its id');
    expect(recordDoor('POSITIONS → CHIEF REVENUE OFFICER → LEADS')).not.toBe(null);
  });
});
