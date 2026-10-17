/**
 * THE BRAND CARD SYSTEM — the pure laws, against the REAL brands and the REAL
 * templates that ship in this repo. No mock anywhere (RULE 0): every test loads
 * the same tokens.json and .svg files the render command loads.
 *
 * Design note, 2026-08-28, holding up a competitor's feed: […] Professional means the card is the same
 * every time, and that a card which cannot be drawn correctly is NOT drawn.
 *
 * Four laws:
 * 1. DETERMINISM — same inputs, same bytes. This is the whole argument for a
 *    template pipeline over a generative one.
 * 2. REFUSE, NEVER DEFORM — a missing, over-long, or misspelled field refuses
 *    by name. A card that renders "undefined", or spills a label out of its
 *    frame, gets posted; a refusal gets fixed.
 * 3. ESCAPING — card copy comes from a stats feed and from beings. An
 *    unescaped `&` breaks the document; an unescaped `<` is an injection into
 *    our own render.
 * 4. THE SEAM IS REAL — one template layer, tokens per brand. Proven by
 *    rendering the SAME template for two brands and finding each brand's own
 *    palette in the output and none of the other's.
 */
import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  renderCardSvg, fieldRefusals, escapeXml, fontFaceBlock,
} from '../../backend/services/branding/card-svg.js';
import {
  loadBrand, loadTemplate, listBrands, listTemplates, tokenRefusals, loadMarks,
  loadGuest, embedFaces, EMBEDDABLE, fontsDir,
} from '../../backend/services/branding/brand-tokens.js';

// Every template signs with the brand's real mark, so a render needs them.
const withMarks = async (brand) => {
  const loaded = await loadBrand(brand);
  const { marks, missing } = await loadMarks(brand, loaded.tokens);
  return { tokens: loaded.tokens, marks, missing };
};

const MILESTONE = {
  eyebrow: 'MILESTONE',
  value: '$100K',
  label: 'claimed by users providing liquidity',
  asOf: '2026-08-28T15:00:00Z',
};

describe('the brands and templates that actually ship', () => {
  test('every brand on disk is renderable — no typo\'d colour reaches a card', async () => {
    const brands = await listBrands();
    expect(brands.length).toBeGreaterThanOrEqual(2);
    for (const name of brands) {
      const brand = await loadBrand(name);
      expect(brand.ok, `${name}: ${brand.error}`).toBe(true);
      expect(tokenRefusals(brand.tokens)).toEqual([]);
    }
  });

  test('every template on disk declares its fields, and every field it draws is declared', async () => {
    const templates = await listTemplates();
    expect(templates.sort()).toEqual([
      // ⚠️ 'stat' sorts BEFORE 'statement' — it is a prefix of it.
      'announcement', 'changelog', 'explainer', 'launch', 'listing', 'milestone',
      'partnership', 'platform-listing', 'quote', 'stat', 'statement',
    ]);
    for (const name of templates) {
      const t = await loadTemplate(name);
      expect(t.ok, `${name}: ${t.error}`).toBe(true);
      expect(Object.keys(t.spec.fields || {}).length).toBeGreaterThan(0);
      // A template that draws another company's mark must DECLARE that it needs
      // one. The declaration is what lets the CLI and the routes refuse a
      // listing card asked for without a logo, instead of rendering a hole
      // where the token's mark belongs and posting it.
      const usesGuest = /\{\{\s*guest\./.test(t.svg);
      expect(Boolean(t.spec.guest), `${name} ${usesGuest ? 'draws a guest mark but declares no guest' : 'declares a guest it never draws'}`)
        .toBe(usesGuest);
      // Every {{data.x}} the SVG draws must be a declared field, or the
      // refusal machinery has nothing to check it against.
      const drawn = [...t.svg.matchAll(/\{\{\s*data\.([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)].map((m) => m[1]);
      for (const field of new Set(drawn)) {
        expect(t.spec.fields[field], `${name} draws data.${field} but does not declare it`).toBeTruthy();
      }
      // ...and every declared field must actually be drawn, or the spec is
      // asking the writer for copy that appears nowhere.
      for (const field of Object.keys(t.spec.fields)) {
        expect(drawn, `${name} declares ${field} but never draws it`).toContain(field);
      }
    }
  });

  test('every card wears the SAME corner brackets', async () => {
    // Design note, 2026-08-31: […]
    //
    // It is not decoration. At 40/1560/860 the bottom-right bracket lands
    // exactly where the half-cut mask's lower edge sweeps past it, and that
    // only reads as intentional if it is the same on every card. Three
    // templates had drifted to three different frames (launch 96/1504/804,
    // milestone 24/1576/876), and launch's was also what put its footer
    // outside its own frame.
    const HOUSE = ['M40 64 V40 H64', 'M1536 40 H1560 V64', 'M1560 836 V860 H1536', 'M64 860 H40 V836'];
    for (const name of await listTemplates()) {
      const { svg } = await loadTemplate(name);
      for (const d of HOUSE) {
        expect(svg, `${name} is missing the house bracket "${d}"`).toContain(d);
      }
    }
  });

  test('a real card renders, and renders IDENTICALLY twice', async () => {
    const brand = await withMarks('umbrae');
    const t = await loadTemplate('milestone');
    const once = renderCardSvg(t.svg, { ...brand, data: MILESTONE, spec: t.spec });
    const twice = renderCardSvg(t.svg, { ...brand, data: MILESTONE, spec: t.spec });
    expect(once.ok).toBe(true);
    expect(once.svg).toBe(twice.svg);
    expect(once.svg).toContain('$100K');
    // Read from the BRAND, never pinned as a literal. A hex typed here fails
    // on a taste decision rather than on a breakage — this palette has already
    // moved three times (mint → near-white → the look-dev's signal cyan → the
    // semantic set).
    //
    // ⚠️ `halo`, not `accent`. The milestone card stopped drawing `accent` on
    // 2026-08-31: `accent` now means FLOW on the stat card (cyan), while this
    // card's hero number wants a warm glow, so the halo got its own token. A
    // card is proven by a colour it actually draws — asserting `accent` here
    // would have been asserting a token this template no longer references.
    expect(once.svg).toContain(brand.tokens.colors.halo);
    expect(once.svg).not.toContain('{{');        // nothing unresolved reaches a render
  });

  test('THE SEAM — one template, two brands, neither wearing the other\'s palette', async () => {
    const t = await loadTemplate('stat');
    const data = {
      eyebrow: 'THIS WEEK', headline: 'At a glance',
      aValue: '8', aLabel: 'ONE', bValue: '262K', bLabel: 'TWO', cValue: '4', cLabel: 'THREE',
      asOf: '2026-08-29T00:00:00Z',
    };
    const umbraeBrand = await withMarks('umbrae');
    const ignisBrand = await withMarks('ignis');
    const umbrae = renderCardSvg(t.svg, { ...umbraeBrand, data, spec: t.spec });
    const ignis = renderCardSvg(t.svg, { ...ignisBrand, data, spec: t.spec });
    expect(umbrae.ok && ignis.ok).toBe(true);
    // Each brand's OWN accent, read from its own tokens — and, the half that
    // actually proves a seam, NEITHER wearing the other's.
    const umbraeAccent = umbraeBrand.tokens.colors.accent;
    const ignisAccent = ignisBrand.tokens.colors.accent;
    expect(umbraeAccent).not.toBe(ignisAccent); // else the check below is vacuous
    expect(umbrae.svg).toContain(umbraeAccent);
    expect(ignis.svg).toContain(ignisAccent);
    expect(umbrae.svg).not.toContain(ignisAccent);
    expect(ignis.svg).not.toContain(umbraeAccent);
    expect(umbrae.svg).not.toBe(ignis.svg);
  });
});

describe('refuse, never deform', () => {
  const spec = { fields: { value: { required: true, max: 12 }, label: { max: 20 } } };

  test('a value past the frame refuses WITH THE NUMBERS, so it is fixed in one pass', () => {
    const out = fieldRefusals(spec, { value: '$100,000,000,000' });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"value" is 16 characters and this template holds 12');
  });

  test('a required field that is absent, empty, or whitespace all refuse the same', () => {
    for (const value of [undefined, '', '   ']) {
      expect(fieldRefusals(spec, { value })[0]).toContain('"value" is required');
    }
  });

  test('a misspelled field refuses and NAMES the fields that exist', () => {
    const out = fieldRefusals(spec, { value: 'ok', labl: 'typo' });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('"labl" is not a field of this template — it takes: value, label');
  });

  test('a refused card yields NO svg at all — there is nothing to post by accident', async () => {
    const brand = await withMarks('umbrae');
    const t = await loadTemplate('milestone');
    const out = renderCardSvg(t.svg, { ...brand, data: { ...MILESTONE, value: '' }, spec: t.spec });
    expect(out.ok).toBe(false);
    expect(out.svg).toBeUndefined();
    expect(out.errors.join(' ')).toContain('"value" is required');
  });

  test('a missing required field is said ONCE, not twice', async () => {
    // The field check and the placeholder check both see it; a reader who is
    // shown the same fault twice learns to skim the list.
    const brand = await withMarks('umbrae');
    const t = await loadTemplate('milestone');
    const { errors } = renderCardSvg(t.svg, { ...brand, data: { ...MILESTONE, label: '' }, spec: t.spec });
    expect(errors.filter((e) => e.includes('label'))).toHaveLength(1);
  });

  test('a template asking for something no brand carries names ITSELF as the fault', async () => {
    const brand = await loadBrand('umbrae');
    const out = renderCardSvg('<svg>{{token.chartreuse}}</svg>', { tokens: brand.tokens, data: {}, spec: {} });
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toContain('{{token.chartreuse}} resolved to nothing');
  });

  test('an empty template refuses rather than rendering a blank card', () => {
    expect(renderCardSvg('   ', { tokens: {}, data: {} })).toEqual({ ok: false, errors: ['the template is empty'] });
  });
});

describe('the copy is escaped — it comes from a feed and from beings', () => {
  test('an ampersand in a label does not break the document', () => {
    const out = renderCardSvg('<svg><text>{{data.label}}</text></svg>', {
      tokens: {}, data: { label: 'Fees & rewards' }, spec: { fields: { label: {} } },
    });
    expect(out.svg).toContain('Fees &amp; rewards');
    expect(out.svg).not.toContain('Fees & rewards');
  });

  test('markup in the copy is drawn as TEXT, never as elements in our own card', () => {
    const hostile = '</text><script>alert(1)</script><text>';
    const out = renderCardSvg('<svg><text>{{data.label}}</text></svg>', {
      tokens: {}, data: { label: hostile }, spec: { fields: { label: {} } },
    });
    expect(out.svg).not.toContain('<script>');
    expect(out.svg).toContain('&lt;script&gt;');
  });

  test('escapeXml covers every character that changes an SVG\'s meaning', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
    expect(escapeXml(null)).toBe('');
  });
});

describe('embedded fonts — a card must render the same on another machine', () => {
  test('faces become a real @font-face block; nothing embeddable yields nothing', () => {
    const css = fontFaceBlock([{ family: 'Inter', weight: 700, format: 'ttf', base64: 'QUJD' }]);
    expect(css).toContain('@font-face');
    expect(css).toContain("font-family:'Inter'");
    expect(css).toContain('data:font/ttf;base64,QUJD');
    expect(fontFaceBlock([])).toBe('');
    expect(fontFaceBlock(null)).toBe('');
    expect(fontFaceBlock([{ family: 'Inter' }])).toBe(''); // no bytes, no face
  });

  test('the font block rides the card, so the render carries its own type', async () => {
    const brand = await withMarks('umbrae');
    const t = await loadTemplate('milestone');
    const out = renderCardSvg(t.svg, {
      ...brand, data: MILESTONE, spec: t.spec,
      fontFace: fontFaceBlock([{ family: 'Inter', weight: 400, format: 'ttf', base64: 'QUJD' }]),
    });
    expect(out.svg).toContain('@font-face');
    // The block is NOT escaped — it is ours, and escaping it would render CSS
    // as visible text across the card.
    expect(out.svg).not.toContain('&lt;style');
  });
});

/**
 * THE MARKS. Design note, 2026-08-29: […]
 *
 * The trap, found by reading the assets rather than trusting them: BOTH Umbrae
 * marks are drawn in pure #000000 with no background — built for a light
 * surface, and dropped onto our near-black cards they are INVISIBLE. So a
 * brand DECLARES which fill to swap for which of its own tokens. Nothing
 * guesses at a colour, and a mark needing no swap declares none.
 */
describe('the marks — vendored, recoloured by declaration, never guessed', () => {
  test('every brand\'s declared marks load, with nothing missing', async () => {
    for (const name of await listBrands()) {
      const brand = await loadBrand(name);
      const { marks, missing } = await loadMarks(name, brand.tokens);
      expect(missing, `${name}: ${missing.join('; ')}`).toEqual([]);
      // Both brands carry the two marks the templates draw.
      expect(Object.keys(marks).sort()).toEqual(['mask', 'wordmark']);
      for (const uri of Object.values(marks)) {
        expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
      }
    }
  });

  test('the black-on-black trap is closed — no #000000 survives in the Umbrae marks', async () => {
    const brand = await loadBrand('umbrae');
    const { marks } = await loadMarks('umbrae', brand.tokens);
    const wordmark = Buffer.from(marks.wordmark.split('base64,')[1], 'base64').toString('utf8');
    const mask = Buffer.from(marks.mask.split('base64,')[1], 'base64').toString('utf8');
    expect(wordmark).not.toContain('#000000');
    expect(wordmark).toContain(brand.tokens.colors.ink);
    expect(mask).not.toContain('#000000');
    // THE MASK'S APPROVED TINTS, and only those. Umbrae's own look-dev states
    // it as a rule: […] Asserting the accent instead would have quietly
    // licensed a cyan mask the brand does not permit, which is exactly what
    // this file shipped until 2026-08-31.
    const approved = [brand.tokens.colors.ink, brand.tokens.colors.rise, brand.tokens.colors.fall]
      .filter(Boolean);
    expect(approved.some((tint) => mask.includes(tint)), `the mask wears none of ${approved.join(', ')}`).toBe(true);
  });

  test('a mark rides the card as a data URI, unescaped and whole', async () => {
    const brand = await withMarks('umbrae');
    const t = await loadTemplate('milestone');
    const out = renderCardSvg(t.svg, { ...brand, data: MILESTONE, spec: t.spec });
    expect(out.svg).toContain('href="data:image/svg+xml;base64,');
    // Base64 carries no character that XML-escapes, so the URI is byte-identical.
    expect(out.svg).toContain(brand.marks.wordmark);
  });

  test('a template that draws a mark the brand lacks REFUSES — it does not draw a hole', async () => {
    const brand = await loadBrand('umbrae');
    const t = await loadTemplate('milestone');
    const out = renderCardSvg(t.svg, { tokens: brand.tokens, data: MILESTONE, spec: t.spec, marks: {} });
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toContain('{{mark.wordmark}} resolved to nothing');
  });

  test('a mark declaration that is not a mark file name is refused before any read', async () => {
    const brand = await loadBrand('umbrae');
    for (const file of ['../../../etc/passwd', 'wordmark.svg/../x', 'Wordmark.SVG', '']) {
      const { marks, missing } = await loadMarks('umbrae', {
        ...brand.tokens, marks: { evil: { file } },
      });
      expect(marks.evil).toBeUndefined();
      expect(missing[0]).toContain('not a mark file name');
    }
  });

  test('a recolour naming a token the brand does not carry is reported, not silently skipped', async () => {
    const brand = await loadBrand('umbrae');
    const { missing } = await loadMarks('umbrae', {
      ...brand.tokens,
      marks: { wordmark: { file: 'wordmark.svg', recolor: { '#000000': 'chartreuse' } } },
    });
    expect(missing[0]).toContain('recolours to "chartreuse", which this brand does not carry');
  });
});

describe('embedded faces name their real format', () => {
  test('an .otf face is opentype — declaring it truetype loads NOTHING and drifts silently', () => {
    const css = fontFaceBlock([{ family: 'JetBrains Mono', weight: 400, format: 'otf', base64: 'QUJD' }]);
    expect(css).toContain("format('opentype')");
    expect(css).toContain('data:font/otf;base64,');
  });

  test('the brands ask for the mono, so a machine without it says so', async () => {
    for (const name of await listBrands()) {
      const brand = await loadBrand(name);
      expect(brand.tokens.embedFonts).toContain('mono-data');
    }
  });
});

describe('every template carries its own type', () => {
  test('EVERY template declares {{fontface}} — without it the card silently falls back', async () => {
    // THE SILENT ONE. A template missing this placeholder still renders, still
    // returns ok, still looks right on the machine that happens to have the
    // fonts installed — and draws in a fallback stack everywhere else. That is
    // the exact drift vendoring the faces was meant to end, and nothing else
    // in this file would notice: the frame-fit tests pass fontFace in
    // explicitly, so they measure a card the renderer never actually builds.
    // (Witnessed 2026-08-30: milestone.svg lost the placeholder in an edit and
    // every other check stayed green.)
    for (const name of await listTemplates()) {
      const { svg } = await loadTemplate(name);
      expect(svg, `${name}.svg is missing {{fontface}} — its cards draw in whatever font the machine has`)
        .toContain('{{fontface}}');
    }
  });
});

describe('THE CROSS-PRODUCT — every template against every brand', () => {
  // WHY THIS EXISTS. Adding {{font.display}} to the shared templates broke the
  // Ignis brand instantly and invisibly: Ignis carried no `display`, and
  // `renderCardSvg` REFUSES an unresolved token rather than falling back, so
  // every Ignis card stopped rendering while every Umbrae card looked perfect.
  // A template is shared by construction, so anything one template asks for is
  // a demand on EVERY brand — that is a class, and it must be swept as one.
  //
  // The data is synthesised FROM EACH TEMPLATE'S OWN SPEC, so a template added
  // tomorrow is covered the day it lands rather than the day someone remembers.
  const dataFor = (spec) => Object.fromEntries(
    Object.entries(spec?.fields || {})
      .map(([name, rule]) => [name, 'x'.repeat(Math.max(1, Math.min(4, rule?.max ?? 4)))]),
  );

  test('no template asks a brand for a token, font or mark it does not carry', async () => {
    const [brands, templates] = await Promise.all([listBrands(), listTemplates()]);
    expect(brands.length).toBeGreaterThanOrEqual(2);
    expect(templates.length).toBeGreaterThanOrEqual(3);
    for (const brandName of brands) {
      const brand = await withMarks(brandName);
      expect(brand.missing, `${brandName} marks`).toEqual([]);
      for (const templateName of templates) {
        const t = await loadTemplate(templateName);
        expect(t.ok, `${templateName}: ${t.error}`).toBe(true);
        // A co-branded template demands a guest mark from EVERY brand the same
        // way {{font.display}} demands a display face from every brand — which
        // is the exact failure this describe block was written for. Loaded
        // through the real loader, so a brand missing the fixture fails here
        // rather than at the first listing someone actually needs to post.
        let guest = {};
        if (t.spec.guest) {
          const got = await loadGuest(brandName, 'example-token');
          expect(got.missing, `${brandName} guest fixture`).toBe(null);
          guest = { mark: got.mark };
        }
        const out = renderCardSvg(t.svg, { ...brand, data: dataFor(t.spec), spec: t.spec, guest });
        // The failure this guards is silent for the brand you happened to
        // render and total for the one you did not, so it names BOTH.
        expect(out.ok, `${brandName} × ${templateName}: ${(out.errors || []).join('; ')}`).toBe(true);
        expect(out.svg).not.toContain('{{');
      }
    }
  });

  test('every brand declares all three type slots — display, voice and data', async () => {
    for (const name of await listBrands()) {
      const { tokens } = await loadBrand(name);
      for (const slot of ['display', 'voice', 'data']) {
        expect(tokens.type?.[slot], `${name} type.${slot}`).toBeTruthy();
      }
      // And a brand that names a face must name one this renderer can embed —
      // a typo here is a card that silently draws in whatever the machine has.
      for (const face of tokens.embedFonts || []) {
        expect(Object.keys(EMBEDDABLE), `${name} embedFonts`).toContain(face);
      }
    }
  });
});

describe('every face is CARRIED, not borrowed from the machine', () => {
  // A face under /usr/share/fonts is whatever this machine happens to have
  // installed; a face under fonts/ is the same bytes everywhere. This repo
  // ships a Dockerfile, and a container has none of those packages — so a
  // system path is a card that renders differently depending on where it ran.
  test('no registered face reads from outside this repository', () => {
    for (const [key, f] of Object.entries(EMBEDDABLE)) {
      expect(f.file.startsWith(fontsDir()), `${key} reads from ${f.file}`).toBe(true);
    }
  });

  test('every registered face embeds — none is merely declared', async () => {
    const keys = Object.keys(EMBEDDABLE);
    const { faces, missing } = await embedFaces(keys);
    expect(missing).toEqual([]);
    expect(faces).toHaveLength(keys.length);
    for (const [i, f] of faces.entries()) {
      expect(f.family, keys[i]).toBe(EMBEDDABLE[keys[i]].family);
      expect(f.weight, keys[i]).toBe(EMBEDDABLE[keys[i]].weight);
      // The declared format has to match the real bytes, or the @font-face
      // says `truetype` over an OpenType file and the face silently drops.
      expect(f.format, keys[i]).toBe(EMBEDDABLE[keys[i]].format || 'ttf');
      expect(f.base64.length, keys[i]).toBeGreaterThan(10000);
    }
  });

  test('every registered family is present and embeds real bytes', async () => {
    // Named families rather than a fixed list: the display face is a LOOK
    // decision the operator revisits (Rajdhani → Noto Sans Condensed Black,
    // 2026-08-30), and a test that pins today's choice fails on taste rather
    // than on breakage. What must hold is that every face registered actually
    // embeds — the invariant vendoring exists for.
    const { faces, missing } = await embedFaces(Object.keys(EMBEDDABLE));
    expect(missing).toEqual([]);
    expect(faces).toHaveLength(Object.keys(EMBEDDABLE).length);
    const families = new Set(faces.map((f) => f.family));
    expect(families.has('Inter')).toBe(true);        // the voice
    expect(families.has('JetBrains Mono')).toBe(true); // the data
    for (const f of faces) expect(f.base64.length).toBeGreaterThan(10000);
  });

  test('the licence travels with the bytes', async () => {
    // SIL OFL 1.1 permits bundling and redistribution; it also requires the
    // licence to ship alongside. Vendoring a face without its OFL is the one
    // way this reproducibility win turns into a licensing problem.
    for (const name of ['Inter-OFL.txt', 'JetBrainsMono-OFL.txt', 'Rajdhani-OFL.txt']) {
      const text = await readFile(path.join(fontsDir(), name), 'utf8');
      expect(text, name).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
});

describe('names that reach disk are names, not paths', () => {
  test('traversal in a brand or template name refuses before any read', async () => {
    for (const bad of ['../../etc', 'a/b', '.', 'Umbrae', '']) {
      expect((await loadBrand(bad)).ok, `brand ${bad}`).toBe(false);
      expect((await loadTemplate(bad)).ok, `template ${bad}`).toBe(false);
    }
  });
});
