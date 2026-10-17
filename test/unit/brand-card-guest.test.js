/**
 * A GUEST BRAND ON OUR CARD — listings and partnerships.
 *
 * Split from brand-card.test.js under the size law. These cover the seam the
 * co-branded templates added: another company's mark riding a card of ours.
 *
 * The laws being kept are not cosmetic. A guest logo is someone else's
 * trademark, so it is never recoloured to our palette and never stretched to
 * fill a slot — either one publishes an altered mark under a post that reads as
 * jointly authored. And a guest is a NAME, never a path: a renderer that took
 * an arbitrary path would be a door for reading any file on the rig into a PNG
 * that then gets posted publicly.
 *
 * No mock (RULE 0): the real loader, the real templates, the real placeholder
 * fixture that ships beside the brands.
 */
import { describe, test, expect } from 'vitest';
import path from 'path';
import { renderCardSvg, fieldRefusals } from '../../backend/services/branding/card-svg.js';
import {
  loadBrand, loadTemplate, loadMarks, loadGuest, brandsDir,
} from '../../backend/services/branding/brand-tokens.js';

// Every template signs with the brand's real mark, so a render needs them.
const withMarks = async (brand) => {
  const loaded = await loadBrand(brand);
  const { marks, missing } = await loadMarks(brand, loaded.tokens);
  return { tokens: loaded.tokens, marks, missing };
};

describe('A GUEST BRAND rides the card without being absorbed by it', () => {
  test('a guest mark reaches the card whole, as a data URI', async () => {
    const brand = await withMarks('umbrae');
    const t = await loadTemplate('listing');
    const { mark } = await loadGuest('umbrae', 'example-token');
    const out = renderCardSvg(t.svg, {
      ...brand,
      data: {
        eyebrow: 'NOW LISTED', name: 'Aerodrome', ticker: '$AERO',
        network: 'BASE', support: 'Live now.',
      },
      spec: t.spec,
      guest: { mark },
    });
    expect(out.ok, (out.errors || []).join('; ')).toBe(true);
    // Base64 carries no XML escapes, so it must ride the href untouched — an
    // escaped data URI is a broken image, and a broken image on a listing card
    // is a card posted with a hole where the partner's logo was.
    expect(out.svg).toContain(mark);
  });

  test('a guest is NEVER recoloured — their artwork lands exactly as supplied', async () => {
    // The mark declares plain white. loadMarks maps OUR marks onto OUR palette;
    // doing that to a partner would publish their logo in colours they never
    // approved, under a post that reads as jointly authored.
    const { mark } = await loadGuest('umbrae', 'example-token');
    const svg = Buffer.from(mark.split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('#ffffff');
    const { tokens } = await loadBrand('umbrae');
    expect(svg).not.toContain(tokens.colors.accent);
  });

  test('a guest name is a NAME and never a path — the renderer is not a file door', async () => {
    for (const bad of ['../../../etc/passwd', 'a/b', '.', '', 'Uppercase']) {
      const got = await loadGuest('umbrae', bad);
      expect(got.mark, String(bad)).toBe(null);
      expect(got.missing, String(bad)).toBeTruthy();
    }
  });

  test('a guest nobody has dropped in yet refuses by name, with the fix', async () => {
    const got = await loadGuest('umbrae', 'nobody-here');
    expect(got.mark).toBe(null);
    // The refusal has to say where to put the file, or the operator is left
    // guessing at a directory they have never seen.
    expect(got.missing).toContain('guests/nobody-here.svg');
    // The ABSOLUTE directory, not "there" — the 2026-09-01 Virtuals refusal
    // sent a being hunting through the whole resolution chain for "there".
    expect(got.missing).toContain(path.join(brandsDir(), 'umbrae', 'guests'));
  });

  test('a template that needs a guest refuses when none was supplied', async () => {
    const brand = await withMarks('umbrae');
    const t = await loadTemplate('partnership');
    const out = renderCardSvg(t.svg, {
      ...brand,
      data: {
        eyebrow: 'PARTNERSHIP', partner: 'Aerodrome', support: 'Live now.',
      },
      spec: t.spec,
    });
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toContain('guest.mark');
  });
});

describe('a colour field is checked, not merely escaped', () => {
  const spec = { fields: { tint: { required: false, color: true, max: 32 } } };

  test('real colours pass in every form the brand tokens allow', () => {
    for (const good of ['#fff', '#4f8bff', '#4f8bff80', 'rgb(1,2,3)', 'rgba(0,0,0,0)']) {
      expect(fieldRefusals(spec, { tint: good }), good).toEqual([]);
    }
  });

  test('a typo refuses by name instead of rendering black on black', () => {
    // The failure mode this exists for: '#gggggg' escapes safely, draws as
    // nothing, and gets posted.
    const errs = fieldRefusals(spec, { tint: '#gggggg' });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('tint');
    expect(errs[0]).toContain('not a colour');
  });

  test('an absent optional colour is still absent, not a refusal', () => {
    expect(fieldRefusals(spec, {})).toEqual([]);
  });
});
