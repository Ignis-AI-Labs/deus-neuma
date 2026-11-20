/**
 * EACH COMPANY ITS OWN CARDS — Design note, 2026-11-16: […]
 *
 * Rule 0: a real house ground in a temp realm (setHouseWorkspace, the operator's own path), a real
 * kit on disk, the real templates, the real renderer. Nothing mocked.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setRealmRoot, getRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { loadTemplate, loadBrand } from '../../backend/services/branding/brand-tokens.js';
import { saveDesign, removeDesign } from '../../backend/services/branding/card-design-save.js';
import { cardGallery } from '../../backend/services/branding/card-gallery.js';
import { previewCard } from '../../backend/services/branding/card-preview.js';
import { describeCards } from '../../backend/services/branding/card-tool.js';
import { TOO_ALIKE } from '../../backend/services/branding/card-likeness.js';

const WALLET = '0x00000000000000000000000000000000000000fe';
const REAL_REALM = getRealmRoot();
let realm; let ground;

const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000000"/></svg>';
const plantKit = async () => {
  // Umbrae's real tokens under another company's name: the kit is real, only the company is new.
  const { tokens } = await loadBrand('umbrae');
  const dir = path.join(ground, 'brands', 'northwind');
  await fs.mkdir(path.join(dir, 'marks'), { recursive: true });
  await fs.writeFile(path.join(dir, 'brand.json'), JSON.stringify({
    ...tokens, brand: 'northwind', name: 'Northwind', handle: '@northwind',
    marks: { wordmark: { file: 'wordmark.svg', recolor: { '#000000': 'ink' } }, mask: { file: 'mask.svg', recolor: { '#000000': 'ink' } } },
  }, null, 2));
  await fs.writeFile(path.join(dir, 'marks', 'wordmark.svg'), art);
  await fs.writeFile(path.join(dir, 'marks', 'mask.svg'), art);
};

// A stat card drawn NORTHWIND's way: three stacked rows on a left rail, nothing where the shared one
// puts anything — a different drawing, in the same kit's paint.
const REDESIGN = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-label="{{data.headline}}">
  <rect width="1600" height="900" fill="{{token.bg}}"/>
  <rect x="0" y="0" width="24" height="900" fill="{{token.accent}}"/>
  <circle id="northwind-orbit" cx="1380" cy="450" r="300" fill="none" stroke="{{token.trim}}" stroke-width="2"/>
  <text x="96" y="140" font-family="{{font.data}}" font-size="30" fill="{{token.muted}}">{{data.eyebrow}}</text>
  <text x="96" y="230" font-family="{{font.display}}" font-size="72" fill="{{token.ink}}">{{data.headline}}</text>
  <text x="96" y="420" font-family="{{font.numeral}}" font-size="110" fill="{{token.ink}}">{{data.aValue}}</text>
  <text x="560" y="420" font-family="{{font.voice}}" font-size="30" fill="{{token.muted}}">{{data.aLabel}}</text>
  <text x="96" y="580" font-family="{{font.numeral}}" font-size="110" fill="{{token.ink}}">{{data.bValue}}</text>
  <text x="560" y="580" font-family="{{font.voice}}" font-size="30" fill="{{token.muted}}">{{data.bLabel}}</text>
  <text x="96" y="740" font-family="{{font.numeral}}" font-size="110" fill="{{token.accent}}">{{data.cValue}}</text>
  <text x="560" y="740" font-family="{{font.voice}}" font-size="30" fill="{{token.muted}}">{{data.cLabel}}</text>
  <text x="1504" y="860" text-anchor="end" font-family="{{font.data}}" font-size="34" fill="{{token.muted}}">{{data.asOf}}</text>
</svg>`;

beforeEach(async () => {
  realm = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-cards-realm-'));
  ground = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-cards-ground-'));
  setRealmRoot(realm);
  await setHouseWorkspace(WALLET, ground);
  await plantKit();
});

afterEach(async () => {
  setRealmRoot(REAL_REALM);
  await fs.rm(realm, { recursive: true, force: true });
  await fs.rm(ground, { recursive: true, force: true });
});

describe("a company's own design is the card it draws", () => {
  test('saved, it wins over the shared card of the same name — for this company only', async () => {
    const shared = await loadTemplate('stat');
    const saved = await saveDesign({ brand: 'northwind', template: 'stat', svg: REDESIGN, spec: shared.spec, wallet: WALLET });
    expect(saved.ok, saved.error).toBe(true);
    expect(saved.dir).toBe(path.join(ground, 'brands', 'northwind', 'cards'));

    const mine = await loadTemplate('stat', { brand: 'northwind', wallet: WALLET });
    expect(mine.source).toBe('company');
    expect(mine.svg).toContain('northwind-orbit');
    expect((await loadTemplate('stat', { brand: 'umbrae', wallet: WALLET })).source).toBe('shared');

    // The preview and the being's render path both draw it.
    const { tokens } = await loadBrand('northwind', { wallet: WALLET });
    const drawn = await previewCard({ brand: 'northwind', kit: tokens, template: 'stat', wallet: WALLET });
    expect(drawn.ok, drawn.errors?.join(' | ')).toBe(true);
    expect(drawn.source).toBe('company');
    expect(drawn.svg).toContain('northwind-orbit');
  });

  test('let go, the shared card stands again', async () => {
    const shared = await loadTemplate('stat');
    await saveDesign({ brand: 'northwind', template: 'stat', svg: REDESIGN, spec: shared.spec, wallet: WALLET });
    expect((await removeDesign({ brand: 'northwind', template: 'stat', wallet: WALLET })).ok).toBe(true);
    expect((await loadTemplate('stat', { brand: 'northwind', wallet: WALLET })).source).toBe('shared');
    expect((await removeDesign({ brand: 'northwind', template: 'stat', wallet: WALLET })).ok).toBe(false);
  });

  test('a card type of its own appears for this company, with its own fields, and for the being too', async () => {
    const spec = { title: 'Pool spotlight', use: 'one pool, its three numbers', fields: { ...(await loadTemplate('stat')).spec.fields } };
    expect((await saveDesign({ brand: 'northwind', template: 'pool-spotlight', svg: REDESIGN, spec, wallet: WALLET })).ok).toBe(true);
    const gallery = await cardGallery('northwind', WALLET);
    const card = gallery.cards.find((c) => c.name === 'pool-spotlight');
    expect(card).toMatchObject({ source: 'company', ownType: true, title: 'Pool spotlight' });
    expect((await cardGallery('umbrae', WALLET)).cards.map((c) => c.name)).not.toContain('pool-spotlight');
    expect(await describeCards({ wallet: WALLET })).toContain('its OWN pool-spotlight card');
  });
});

describe('the gallery says when a card is the same drawing as another company\'s', () => {
  test('a shared card is the same layout every other company still on it draws', async () => {
    const gallery = await cardGallery('northwind', WALLET);
    const stat = gallery.cards.find((c) => c.name === 'stat');
    expect(stat.source).toBe('shared');
    expect(stat.likeness.map((l) => l.brand).sort()).toEqual(['ignis', 'umbrae']);
    expect(stat.likeness.every((l) => l.score === 1)).toBe(true);
    expect(gallery.shared).toBe(gallery.cards.length);
  });

  test('a copy that is only recoloured is still the same drawing; a redesign is not', async () => {
    const shared = await loadTemplate('stat');
    const recoloured = shared.svg.replaceAll('{{token.accent}}', '{{token.rise}}');
    await saveDesign({ brand: 'northwind', template: 'stat', svg: recoloured, spec: shared.spec, wallet: WALLET });
    let stat = (await cardGallery('northwind', WALLET)).cards.find((c) => c.name === 'stat');
    expect(stat.source).toBe('company');
    expect(stat.likeness[0].score).toBeGreaterThanOrEqual(TOO_ALIKE);

    await saveDesign({ brand: 'northwind', template: 'stat', svg: REDESIGN, spec: shared.spec, wallet: WALLET });
    stat = (await cardGallery('northwind', WALLET)).cards.find((c) => c.name === 'stat');
    expect(stat.likeness).toEqual([]);
  });
});

describe('a design is refused, never deformed or drawn unsafe', () => {
  const spec = { fields: { headline: { required: true, max: 40 } } };
  const refused = async (svg) => saveDesign({ brand: 'northwind', template: 'bad', svg, spec, wallet: WALLET });

  test('script, a handler, an outside link — refused by name, nothing written', async () => {
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>{{data.headline}}</text></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" width="1" height="1"/><text>{{data.headline}}</text></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/><text>{{data.headline}}</text></svg>',
    ]) {
      const out = await refused(svg);
      expect(out.ok).toBe(false);
      expect(out.errors.length).toBeGreaterThan(0);
    }
    await expect(fs.access(path.join(ground, 'brands', 'northwind', 'cards', 'bad.svg'))).rejects.toThrow();
  });

  test('a placeholder the kit cannot fill is refused with the renderer\'s own reason', async () => {
    const out = await refused('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="{{token.nosuchcolour}}"/><text>{{data.headline}}</text></svg>');
    expect(out.ok).toBe(false);
    expect(out.error).toContain('{{token.nosuchcolour}}');
  });

  test('an unsafe design planted on disk is never drawn, and an unsaved one is never previewed', async () => {
    const dir = path.join(ground, 'brands', 'northwind', 'cards');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'stat.svg'), '<svg><foreignObject><div>x</div></foreignObject></svg>');
    await fs.writeFile(path.join(dir, 'stat.json'), JSON.stringify(spec));
    const read = await loadTemplate('stat', { brand: 'northwind', wallet: WALLET });
    expect(read.ok).toBe(false);
    expect(read.error).toContain('<foreignObject>');

    const { tokens } = await loadBrand('northwind', { wallet: WALLET });
    const unsaved = await previewCard({
      brand: 'northwind', kit: tokens, template: 'stat', wallet: WALLET,
      design: { svg: '<svg><image href="x" onerror="alert(1)"/></svg>', spec },
    });
    expect(unsaved.ok).toBe(false);
    expect(unsaved.errors.join(' ')).toContain('onerror=');
  });
});
