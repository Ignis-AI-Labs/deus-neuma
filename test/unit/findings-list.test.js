/**
 * FINDINGS — the list a being hands its operator.
 *
 * Design note, 2026-08-30: […]
 *
 * The two cases below are HIS two examples, built exactly as a being would send
 * them, because a formatter proven only on invented shapes is a formatter
 * proven on nothing.
 */
import { describe, expect, test } from 'vitest';
import {
  FINDINGS_LIMITS, findingsRefusals, normalizeFindings, findingsSummary,
} from '../../backend/services/findings-list.js';

/** Founder's first example, as a being would file it. */
const FONTS = {
  title: 'DISPLAY FACES',
  note: 'for the brand cards — condensed, technical',
  items: [
    {
      label: 'Rajdhani',
      detail: 'condensed, squared terminals — reads technical at 200px',
      url: 'https://fonts.google.com/specimen/Rajdhani',
      meta: 'OFL 1.1',
    },
    {
      label: 'Chakra Petch',
      detail: 'angular, MGS-adjacent; wider than Rajdhani',
      url: 'https://fonts.google.com/specimen/Chakra+Petch',
      meta: 'OFL 1.1',
    },
  ],
};

/** His second — the one that needs swatches to be worth anything. */
const PALETTES = {
  title: 'COLOUR PALETTES',
  items: [
    { label: 'cyber slate', swatches: ['#0a0a0a', '#141414', '#4f8bff', '#eafff0'] },
    { label: 'ember', swatches: ['#0a0a0a', '#d44a2c', '#fb923c'], meta: 'warm' },
  ],
};

describe('the two lists Founder actually asked for', () => {
  test('a font list passes and keeps every field the operator needs', () => {
    expect(findingsRefusals(FONTS)).toEqual([]);
    const out = normalizeFindings(FONTS);
    expect(out.count).toBe(2);
    expect(out.title).toBe('DISPLAY FACES');
    expect(out.items[0]).toMatchObject({
      label: 'Rajdhani',
      url: 'https://fonts.google.com/specimen/Rajdhani',
      meta: 'OFL 1.1',
    });
    // The ORDER the being chose survives — it is an argument, not a set.
    expect(out.items.map((i) => i.label)).toEqual(['Rajdhani', 'Chakra Petch']);
  });

  test('a palette keeps its colours, which are the whole content of the row', () => {
    expect(findingsRefusals(PALETTES)).toEqual([]);
    const out = normalizeFindings(PALETTES);
    expect(out.items[0].swatches).toEqual(['#0a0a0a', '#141414', '#4f8bff', '#eafff0']);
    // Absent optional fields are null, never '' — a renderer testing truthiness
    // must not draw an empty row slot.
    expect(out.items[0].detail).toBe(null);
    expect(out.items[0].url).toBe(null);
    expect(out.note).toBe(null);
  });

  test('the summary names the COUNT, because "shared a list" says nothing', () => {
    expect(findingsSummary(normalizeFindings(FONTS))).toBe('DISPLAY FACES — 2 findings');
    expect(findingsSummary(normalizeFindings({ title: 'X', items: [{ label: 'one' }] })))
      .toBe('X — 1 finding');
  });
});

describe('refuse, never deform', () => {
  test('an over-long field is refused WITH THE NUMBERS', () => {
    const long = 'x'.repeat(FINDINGS_LIMITS.label + 7);
    const r = findingsRefusals({ title: 'T', items: [{ label: long }] });
    // A being told "too long" guesses; a being told "71 of 64" fixes it once.
    expect(r.join(' ')).toMatch(new RegExp(`${FINDINGS_LIMITS.label + 7} characters`));
    expect(r.join(' ')).toMatch(new RegExp(`cap is ${FINDINGS_LIMITS.label}`));
  });

  test('the refused item is named by its 1-based position', () => {
    const r = findingsRefusals({ title: 'T', items: [{ label: 'ok' }, { label: '' }] });
    // The being wrote a list; it counts from one.
    expect(r.join(' ')).toMatch(/item 2 needs a label/);
    expect(r.join(' ')).not.toMatch(/item 1/);
  });

  test('a list longer than the card holds is refused, not clipped', () => {
    const items = Array.from({ length: FINDINGS_LIMITS.items + 3 }, (_, i) => ({ label: `f${i}` }));
    const r = findingsRefusals({ title: 'T', items });
    expect(r.join(' ')).toMatch(new RegExp(`${FINDINGS_LIMITS.items + 3} items`));
    // Clipping would hand the operator a list he reads as complete.
    expect(r.join(' ')).toMatch(/split the list/);
  });

  test('a title and items are both required', () => {
    expect(findingsRefusals({ items: [{ label: 'a' }] }).join(' ')).toMatch(/needs a title/);
    expect(findingsRefusals({ title: 'T' }).join(' ')).toMatch(/needs items/);
    expect(findingsRefusals({ title: '   ', items: [{ label: 'a' }] }).join(' ')).toMatch(/needs a title/);
  });

  test('an empty list is refused — it is not a finding', () => {
    expect(findingsRefusals({ title: 'T', items: [] }).join(' ')).toMatch(/say so in words/);
  });

  test('junk never throws', () => {
    expect(findingsRefusals(null)).toEqual(['the findings list is not an object']);
    expect(findingsRefusals('a list')).toEqual(['the findings list is not an object']);
    expect(findingsRefusals({ title: 'T', items: [null] }).join(' ')).toMatch(/item 1 is not an object/);
  });
});

describe('a link the operator clicks is guarded AT THE DOOR', () => {
  test('only http(s) is accepted', () => {
    for (const url of ['https://a.co', 'http://a.co']) {
      expect(findingsRefusals({ title: 'T', items: [{ label: 'a', url }] })).toEqual([]);
    }
  });

  test('a javascript: url is REFUSED TO THE BEING, not quietly unlinked', () => {
    // The renderer guards too, but a refusal that reaches the being is one it
    // can fix. A silently unlinked row just looks broken to the operator, and
    // the being never learns why.
    const r = findingsRefusals({ title: 'T', items: [{ label: 'a', url: 'javascript:alert(1)' }] });
    expect(r.join(' ')).toMatch(/not a link the operator can open/);
  });

  test('file: and data: are refused for the same reason', () => {
    for (const url of ['file:///etc/passwd', 'data:text/html,<script>']) {
      expect(findingsRefusals({ title: 'T', items: [{ label: 'a', url }] }).length).toBeGreaterThan(0);
    }
  });

  test('a malformed url is refused as a url, not as a protocol', () => {
    expect(findingsRefusals({ title: 'T', items: [{ label: 'a', url: 'not a url' }] }).join(' '))
      .toMatch(/is not a url/);
  });
});

describe('swatches paint, or they are refused', () => {
  test('a bad hex is refused — in a PALETTE it is the row\'s whole content', () => {
    const r = findingsRefusals({ title: 'T', items: [{ label: 'p', swatches: ['#4f8bff', 'blue'] }] });
    expect(r.join(' ')).toMatch(/"blue" is not a hex colour/);
  });

  test('three-digit hex is accepted, and too many swatches are refused', () => {
    expect(findingsRefusals({ title: 'T', items: [{ label: 'p', swatches: ['#fff'] }] })).toEqual([]);
    const many = Array.from({ length: FINDINGS_LIMITS.swatches + 1 }, () => '#fff');
    expect(findingsRefusals({ title: 'T', items: [{ label: 'p', swatches: many }] }).join(' '))
      .toMatch(/swatches and the row holds/);
  });

  test('swatches must be a list, and an empty one normalises to null', () => {
    expect(findingsRefusals({ title: 'T', items: [{ label: 'p', swatches: '#fff' }] }).join(' '))
      .toMatch(/must be a list of hex colours/);
    expect(normalizeFindings({ title: 'T', items: [{ label: 'p', swatches: [] }] }).items[0].swatches)
      .toBe(null);
  });
});

describe('the shape the card is handed is frozen', () => {
  test('nothing downstream can mutate a filed list', () => {
    const out = normalizeFindings(FONTS);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.items)).toBe(true);
    expect(Object.isFrozen(out.items[0])).toBe(true);
  });
});
