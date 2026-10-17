// A CARD REMEMBERS WHAT IT WAS DRAWN WITH.
//
// Design note, 2026-09-01, looking at a queued card beside the review sheet: […] It was not:
// the card carried Umbrae's palette from two commits earlier, and the panel
// asking him to approve it looked no different from one showing a current card.
//
// The queue stores a RESOLVED FILE PATH and never re-renders, so a kit change
// reaches every future card and no past one. Nothing was broken — nothing was
// watching. These tests hold the thing that watches now.
//
// Rule 0: no mocks. Real kits off disk, real template SVGs, real files in a
// real temp directory.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  fingerprintCard, sidecarPath, compareProvenance, looksLikeCard,
  recordProvenance, readProvenance, cardFreshness, withCardFreshness,
} from '../../backend/services/branding/card-provenance.js';
import { loadBrand, loadTemplate, loadMarks, listBrands, listTemplates } from '../../backend/services/branding/brand-tokens.js';

let dir;
let umbrae;
let milestone;
let marks;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'card-prov-'));
  umbrae = await loadBrand('umbrae');
  milestone = await loadTemplate('milestone');
  const loaded = await loadMarks('umbrae', umbrae.tokens);
  marks = loaded.marks || loaded;
});

afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const cardAt = async (name = 'umbrae-milestone-2026-09-01-0426aea6.png') => {
  const file = path.join(dir, name);
  await fs.writeFile(file, 'not really a png, and it does not need to be');
  return file;
};

describe('the fingerprint is of what actually decides the pixels', () => {
  test('key ORDER is not part of a brand', () => {
    // A kit round-tripped through an editor comes back with its keys in a
    // different order. If that read as "the brand moved", every save would
    // raise a false alarm and the flag would be worthless within a week.
    const a = { colors: { bg: '#000', ink: '#fff' }, type: { display: 'X' } };
    const b = { type: { display: 'X' }, colors: { ink: '#fff', bg: '#000' } };
    expect(fingerprintCard({ tokens: a, marks: {}, templateSvg: '<svg/>' }))
      .toEqual(fingerprintCard({ tokens: b, marks: {}, templateSvg: '<svg/>' }));
  });

  test('a colour change, a mark change and a template change are told APART', () => {
    // Three separate digests, because "this is stale" is half an answer and
    // "its colours moved" is the whole one.
    const base = { tokens: umbrae.tokens, marks, templateSvg: milestone.svg };
    const fp = fingerprintCard(base);
    const colour = fingerprintCard({ ...base, tokens: { ...umbrae.tokens, colors: { ...umbrae.tokens.colors, trimHot: '#fb923c' } } });
    const mark = fingerprintCard({ ...base, marks: { ...marks, wordmark: 'data:image/svg+xml;base64,AAAA' } });
    const tmpl = fingerprintCard({ ...base, templateSvg: `${milestone.svg}<!-- edited -->` });

    expect(colour.tokens).not.toBe(fp.tokens);
    expect(colour.marks).toBe(fp.marks);
    expect(colour.template).toBe(fp.template);

    expect(mark.marks).not.toBe(fp.marks);
    expect(mark.tokens).toBe(fp.tokens);

    expect(tmpl.template).not.toBe(fp.template);
    expect(tmpl.tokens).toBe(fp.tokens);
  });

  test('the mark BYTES are fingerprinted, not the declaration', () => {
    // A wordmark redrawn under the same filename is a different card, and the
    // kit's `marks` block would not show it — it names files, not artwork.
    const one = fingerprintCard({ tokens: {}, marks: { wordmark: 'data:image/svg+xml;base64,AAAA' }, templateSvg: '' });
    const two = fingerprintCard({ tokens: {}, marks: { wordmark: 'data:image/svg+xml;base64,BBBB' }, templateSvg: '' });
    expect(one.marks).not.toBe(two.marks);
  });
});

describe('the verdict', () => {
  test('a card drawn with the kit as it stands says so, quietly', async () => {
    const card = await cardAt();
    await recordProvenance({
      cardPath: card, brand: 'umbrae', template: 'milestone',
      tokens: umbrae.tokens, marks, templateSvg: milestone.svg,
    });
    const out = await cardFreshness(card);
    expect(out.state).toBe('current');
    expect(out.moved).toEqual([]);
  });

  test('a card drawn with a palette the brand has since left is CAUGHT, and what moved is named', async () => {
    // This is the real case, reproduced: Umbrae's trimHot was #fb923c at
    // 98e6af89b and is #35CC77 now. The card in the queue was drawn then.
    const card = await cardAt();
    await recordProvenance({
      cardPath: card, brand: 'umbrae', template: 'milestone',
      tokens: { ...umbrae.tokens, colors: { ...umbrae.tokens.colors, trimHot: '#fb923c' } },
      marks, templateSvg: milestone.svg,
    });
    const out = await cardFreshness(card);
    expect(out.state).toBe('stale');
    expect(out.moved).toEqual(['tokens']);
    expect(out.note).toContain('umbrae has moved');
    expect(out.note).toContain('its colours and type');
    expect(out.brand).toBe('umbrae');
  });

  test('a TEMPLATE edit is caught too — the brand alone is not the whole card', async () => {
    const card = await cardAt();
    await recordProvenance({
      cardPath: card, brand: 'umbrae', template: 'milestone',
      tokens: umbrae.tokens, marks, templateSvg: '<svg><!-- the old milestone --></svg>',
    });
    const out = await cardFreshness(card);
    expect(out.state).toBe('stale');
    expect(out.moved).toEqual(['template']);
    expect(out.note).toContain('the template');
  });

  test('a card from before this existed is UNRECORDED, never quietly blessed', async () => {
    // The honest answer. Both cards in the queue the day this shipped have no
    // record, and calling them "current" would be a guess wearing a verdict's
    // clothes.
    const out = await cardFreshness(await cardAt());
    expect(out.state).toBe('unrecorded');
    expect(out.note).toContain('re-render it if it matters');
  });

  test('a brand that no longer exists is ORPHANED, not a crash', async () => {
    const card = await cardAt();
    await recordProvenance({
      cardPath: card, brand: 'nosuchbrand', template: 'milestone',
      tokens: {}, marks: {}, templateSvg: '<svg/>',
    });
    const out = await cardFreshness(card);
    expect(out.state).toBe('orphaned');
    expect(out.note).toContain('no longer exists');
  });

  test('compareProvenance is pure — the whole judgement is testable with no disk', () => {
    const was = { brand: 'umbrae', template: 'milestone', fingerprint: { tokens: 'a', marks: 'b', template: 'c' } };
    expect(compareProvenance(was, { tokens: 'a', marks: 'b', template: 'c' }).state).toBe('current');
    expect(compareProvenance(was, { tokens: 'z', marks: 'b', template: 'c' }).moved).toEqual(['tokens']);
    expect(compareProvenance(was, { tokens: 'z', marks: 'y', template: 'x' }).moved)
      .toEqual(['tokens', 'marks', 'template']);
    expect(compareProvenance(null, null).state).toBe('unrecorded');
    expect(compareProvenance(was, null).state).toBe('orphaned');
  });
});

describe('only a CARD is judged', () => {
  test('a real card name is recognised, brand and template read back out', async () => {
    const brands = await listBrands();
    const templates = await listTemplates();
    // The exact name that was in Founder's queue.
    expect(looksLikeCard('/w/metidar/cards/umbrae-milestone-2026-08-31-0426aea6.png', { brands, templates }))
      .toEqual({ brand: 'umbrae', template: 'milestone', day: '2026-08-31' });
  });

  test('an ordinary photo gets NO verdict at all', async () => {
    // ⚠️ The badge must stay quiet on things that are not cards. One that
    // fires on every holiday snap is one an operator learns to ignore, and an
    // ignored warning is worse than none because it looks like cover.
    const brands = await listBrands();
    const templates = await listTemplates();
    for (const p of ['photo.png', 'IMG_2032.jpeg', 'umbrae-2026-08-31-abc.png', 'a-chart-2026-08-31-0426aea6.png']) {
      expect(looksLikeCard(p, { brands, templates }), p).toBeNull();
    }
  });

  test('a brand or template that is not one of ours is not a card either', async () => {
    expect(looksLikeCard('acme-milestone-2026-08-31-0426aea6.png', { brands: ['umbrae'], templates: ['milestone'] })).toBeNull();
    expect(looksLikeCard('umbrae-poster-2026-08-31-0426aea6.png', { brands: ['umbrae'], templates: ['milestone'] })).toBeNull();
  });
});

describe('recording never costs the work', () => {
  test('the record lands beside the card, under the card\'s own name', async () => {
    const card = await cardAt();
    await recordProvenance({
      cardPath: card, brand: 'umbrae', template: 'milestone',
      tokens: umbrae.tokens, marks, templateSvg: milestone.svg,
    });
    expect(sidecarPath(card)).toBe(card.replace(/\.png$/, '.kit.json'));
    const back = await readProvenance(card);
    expect(back.brand).toBe('umbrae');
    expect(back.fingerprint.tokens).toHaveLength(12);
  });

  test('an unwritable record is REPORTED, never thrown — a card that rendered is a card', async () => {
    const out = await recordProvenance({
      cardPath: '/nowhere/that/exists/card.png', brand: 'umbrae', template: 'milestone',
      tokens: {}, marks: {}, templateSvg: '',
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBeTruthy();
    // The fingerprint was still computed, so the caller can say what it would
    // have written.
    expect(out.record.fingerprint.tokens).toHaveLength(12);
  });

  test('a corrupt record reads as no record, rather than taking the board down', async () => {
    const card = await cardAt();
    await fs.writeFile(sidecarPath(card), '{ this is not json');
    expect(await readProvenance(card)).toBeNull();
    expect((await cardFreshness(card)).state).toBe('unrecorded');
  });
});

describe('the board is marked, and only where it should be', () => {
  test('a queue is returned with card media judged and everything else untouched', async () => {
    // The route hands this straight to the approval board, so this is the
    // shape Founder's panel actually reads.
    const card = await cardAt();
    await recordProvenance({
      cardPath: card, brand: 'umbrae', template: 'milestone',
      tokens: { ...umbrae.tokens, colors: { ...umbrae.tokens.colors, trimHot: '#fb923c' } },
      marks, templateSvg: milestone.svg,
    });
    const photo = path.join(dir, 'IMG_2032.jpeg');
    await fs.writeFile(photo, 'a holiday snap');

    const [out] = await withCardFreshness([
      { id: 'a', text: 'hello', media: [{ path: card, alt: 'the card' }, { path: photo, alt: 'a photo' }] },
    ]);

    expect(out.media[0].kit.state).toBe('stale');
    expect(out.media[0].alt).toBe('the card');
    // ⚠️ The photo carries NO kit key at all — not `current`, not `unknown`.
    expect(out.media[1]).not.toHaveProperty('kit');
    expect(out.text).toBe('hello');
  });

  test('a queue with no media is handed back untouched, and does no disk work', async () => {
    const queue = [{ id: 'a', text: 'no pictures' }, { id: 'b', media: [] }];
    expect(await withCardFreshness(queue)).toBe(queue);
  });

  test('a broken check costs a warning, never the operator\'s whole board', async () => {
    // A freshness read that could throw would trade a cosmetic badge for the
    // queue itself. The entries come back either way.
    const out = await withCardFreshness([{ id: 'a', media: [{ path: null }] }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    // A path that is not a card is simply not judged — no key, no crash.
    expect(out[0].media[0]).not.toHaveProperty('kit');
  });
});
