// A card drawn from a kit that is not on disk.
//
// The BRAND KITS panel previews the DRAFT — whatever is in the editor right
// now, unsaved. That is the whole point: change a colour, see the card change,
// then decide. This file holds the two properties that make it usable:
//
//   1. it draws with the same renderer the real card uses, so it can be trusted
//   2. it does NOT embed fonts, so it can be called on a keystroke stream
//
// The second is not a nicety. Umbrae's six embedded faces are ~1.6MB of base64
// per render; at that size a live preview is indefensible and the feature
// quietly becomes a button nobody presses. The browser installs the same
// vendored bytes once from /faces/:id/file instead.
//
// Rule 0: no mocks. Real templates, real marks, real kits off disk.

import { describe, expect, test } from 'vitest';
import { previewCard, previewFaceIds } from '../../backend/services/branding/card-preview.js';
import { sampleFor } from '../../backend/services/branding/card-sample.js';
import { loadBrand, loadTemplate, listTemplates } from '../../backend/services/branding/brand-tokens.js';
import { kitSkeleton } from '../../backend/services/branding/kit-store.js';

const umbrae = async () => (await loadBrand('umbrae')).tokens;

describe('every shipped template previews from a real kit', () => {
  test('every template draws, and none carries an embedded face', async () => {
    const kit = await umbrae();
    const templates = await listTemplates();
    // Guards an EMPTY loop, which would otherwise read as a pass. It does not
    // pin the family size — `brand-card-craft.test.js` owns that list, and two
    // places owning one number is exactly how this went stale when the voice
    // cards landed.
    expect(templates.length).toBeGreaterThan(5);
    for (const template of templates) {
      const out = await previewCard({ brand: 'umbrae', kit, template });
      expect(out.ok, `${template} refused: ${out.errors?.join(' | ')}`).toBe(true);
      expect(out.svg).toMatch(/^<svg/);
      // ⚠️ The size guard. A preview that embeds fonts is ~1.6MB; one that does
      // not is single-digit KB. If this ever fails it means fontFace stopped
      // being '' and every keystroke now moves a megabyte.
      expect(out.svg).not.toContain('@font-face');
      expect(out.svg).not.toContain('base64,AAEAAA');
      expect(
        out.svg.length,
        `${template} preview is ${Math.round(out.svg.length / 1024)}KB — fonts are being embedded again`,
      ).toBeLessThan(60_000);
    }
  });

  test('the marks still ride, so the card is not a wireframe', async () => {
    const out = await previewCard({ brand: 'umbrae', kit: await umbrae(), template: 'milestone' });
    expect(out.missing).toEqual([]);
    expect(out.svg).toContain('data:image/svg+xml;base64,');
  });

  test('a guest slot is filled from our OWN fixture, never a real trademark', async () => {
    // listing and partnership both declare a required guest. A preview that
    // needed someone else's logo on disk would refuse for most operators, and
    // committing a real one to satisfy it is not ours to do.
    for (const template of ['listing', 'partnership']) {
      const out = await previewCard({ brand: 'umbrae', kit: await umbrae(), template });
      expect(out.ok, `${template}: ${out.errors?.join(' | ')}`).toBe(true);
    }
  });
});

describe('it previews the DRAFT, not what is saved', () => {
  test('a colour changed only in memory reaches the card', async () => {
    const kit = structuredClone(await umbrae());
    kit.colors.accent = '#ff00ff';
    const out = await previewCard({ brand: 'umbrae', kit, template: 'stat' });
    expect(out.ok).toBe(true);
    expect(out.svg).toContain('#ff00ff');
    // And the saved kit is untouched — a preview must never write.
    expect((await umbrae()).colors.accent).toBe('#22d3ee');
  });

  test('a brand-new scaffold kit resolves every TOKEN — only its artwork is absent', async () => {
    // Until 2026-08-31 the scaffold seeded five colour roles while the
    // templates drew fourteen, so a fresh kit saved and then refused every one
    // cards on NINE missing colours. What it still legitimately lacks is
    // artwork: a wordmark and a mask are files nobody can invent for a company,
    // so those stay absent until an operator supplies them. That distinction is
    // the assertion — no colour and no type slot may appear in the refusal.
    const kit = kitSkeleton('northwind');
    kit.handle = '@northwind';
    for (const template of await listTemplates()) {
      const out = await previewCard({ brand: 'northwind', kit, template });
      const reasons = (out.errors || []).join(' | ');
      expect(reasons, `${template} refuses on a token the scaffold should have seeded`)
        .not.toMatch(/\{\{\s*(token|font|brand)\./);
      // Everything it DOES refuse on is a mark or a guest logo — a file.
      for (const reason of out.errors || []) {
        expect(reason, `${template}: unexpected refusal`).toMatch(/\{\{\s*(mark|guest)\./);
      }
    }
  });

  test('give that scaffold kit artwork and every card draws', async () => {
    // The other half of the same proof: with marks declared, nothing else is
    // missing. Umbrae's files stand in for artwork the scaffold cannot invent.
    const kit = kitSkeleton('umbrae');
    kit.handle = '@northwind';
    kit.marks = { wordmark: { file: 'wordmark.svg' }, mask: { file: 'mask.svg' } };
    for (const template of await listTemplates()) {
      const out = await previewCard({ brand: 'umbrae', kit, template });
      expect(out.ok, `${template}: ${out.errors?.join(' | ')}`).toBe(true);
    }
  });
});

describe('a card that cannot be drawn says why, and is not an error', () => {
  test('a missing colour names itself rather than throwing', async () => {
    const kit = structuredClone(await umbrae());
    delete kit.colors.hairlineSoft;
    const out = await previewCard({ brand: 'umbrae', kit, template: 'stat' });
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toMatch(/hairlineSoft/);
  });

  test('an unknown template refuses by name', async () => {
    const out = await previewCard({ brand: 'umbrae', kit: await umbrae(), template: 'nosuch' });
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toMatch(/nosuch/);
  });

  test('no kit at all is refused, not crashed', async () => {
    expect((await previewCard({ brand: 'umbrae', kit: null, template: 'stat' })).ok).toBe(false);
  });
});

describe('the sample copy is honest about being sample copy', () => {
  test('nothing it draws overruns what the template declares it holds', async () => {
    for (const template of await listTemplates()) {
      const { spec } = await loadTemplate(template);
      const sample = sampleFor(spec, await umbrae());
      for (const [field, rule] of Object.entries(spec.fields || {})) {
        if (field === 'guest') continue;
        expect(sample[field], `${template}.${field} has no sample`).toBeTruthy();
        if (Number.isFinite(rule.max)) {
          expect(
            sample[field].length,
            `${template}.${field} sample is ${sample[field].length} of ${rule.max} — an operator would read our overrun as a fault in their kit`,
          ).toBeLessThanOrEqual(rule.max);
        }
      }
    }
  });

  test('the brand\'s own name is real where the kit knows it', async () => {
    const { spec } = await loadTemplate('listing');
    expect(sampleFor(spec, { name: 'Umbrae' }).name).toBe('Umbrae');
    // ...and is still fitted to the field, never overrunning it.
    expect(sampleFor(spec, { name: 'A Very Long Company Name Indeed' }).name.length)
      .toBeLessThanOrEqual(spec.fields.name.max);
  });
});

describe('the faces the browser is told to install', () => {
  test('they come from the kit\'s own embedFonts, and a kit without them asks for none', async () => {
    expect(previewFaceIds(await umbrae())).toContain('grotesk-light');
    expect(previewFaceIds({})).toEqual([]);
    expect(previewFaceIds({ embedFonts: 'not an array' })).toEqual([]);
  });
});
