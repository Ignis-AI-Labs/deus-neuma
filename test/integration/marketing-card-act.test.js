/**
 * THE MARKETING SEAT SHAPES EACH COMPANY'S CARDS — Design note, 2026-11-16: […]
 *
 * Rule 0: a real house ground in a temp realm, a real kit on disk, the real templates, the real
 * renderer, a real seat record. The act is driven the way the harness drives it: validate, then
 * execute. Nothing mocked.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setRealmRoot, getRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { loadTemplate, loadBrand } from '../../backend/services/branding/brand-tokens.js';
import { cardGallery } from '../../backend/services/branding/card-gallery.js';
import { readRetired } from '../../backend/services/branding/card-set.js';
import { describeCards, renderCardForLane } from '../../backend/services/branding/card-tool.js';
import { marketingCardIntent, cardLine } from '../../backend/services/intents/marketing-card-acts.js';
import { intentType } from '../../backend/services/intents/registry.js';

const WALLET = '0x00000000000000000000000000000000000000fd';
const LANE = 'metidar';
const REAL_REALM = getRealmRoot();
const REAL_WORKSPACES = getWorkspacesRoot();
let realm; let ground; let lanes;
const connection = (lane = LANE) => ({ walletAddress: WALLET, companion: { neumaId: lane } });

const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000000"/></svg>';
const run = async (payload, conn = connection()) => {
  const checked = await marketingCardIntent.validate(payload, { connection: conn });
  return checked.ok ? marketingCardIntent.execute(checked.value, { connection: conn }) : checked;
};
const draft = (card, ext) => path.join(ground, 'workspaces', LANE, 'card-designs', 'northwind', `${card}.${ext}`);

beforeEach(async () => {
  realm = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-cardact-realm-'));
  ground = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-cardact-ground-'));
  setRealmRoot(realm);
  // A member of this house: its lane names the house's wallet as owner, as a born being's does.
  lanes = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-cardact-lanes-'));
  setWorkspacesRoot(lanes);
  await fs.mkdir(path.join(lanes, LANE), { recursive: true });
  await fs.writeFile(path.join(lanes, LANE, 'owner.json'), JSON.stringify({ wallet: WALLET, claimedAt: 1 }));
  await setHouseWorkspace(WALLET, ground);
  const { tokens } = await loadBrand('umbrae');
  const dir = path.join(ground, 'brands', 'northwind');
  await fs.mkdir(path.join(dir, 'marks'), { recursive: true });
  await fs.writeFile(path.join(dir, 'brand.json'), JSON.stringify({
    ...tokens, brand: 'northwind', name: 'Northwind', handle: '@northwind',
    marks: { wordmark: { file: 'wordmark.svg', recolor: { '#000000': 'ink' } }, mask: { file: 'mask.svg', recolor: { '#000000': 'ink' } } },
  }, null, 2));
  await fs.writeFile(path.join(dir, 'marks', 'wordmark.svg'), art);
  await fs.writeFile(path.join(dir, 'marks', 'mask.svg'), art);
  await cmoDesignation.designate(WALLET, LANE);
});

afterEach(async () => {
  setRealmRoot(REAL_REALM);
  setWorkspacesRoot(REAL_WORKSPACES);
  await fs.rm(lanes, { recursive: true, force: true });
  await fs.rm(realm, { recursive: true, force: true });
  await fs.rm(ground, { recursive: true, force: true });
});

describe('marketing/card', () => {
  test('it is a registered act, offered to the marketing seat alone', async () => {
    expect(intentType('marketing/card')).toBe(marketingCardIntent);
    expect(await marketingCardIntent.availableFor({ laneId: LANE, connection: connection() })).toEqual({});
    expect(await marketingCardIntent.availableFor({ laneId: 'someone', connection: connection('someone') })).toBe(null);
    expect(await run({ do: 'list', company: 'northwind' }, connection('someone'))).toMatchObject({ ok: false, status: 'denied' });
    expect(await run({ do: 'paint', company: 'northwind' })).toMatchObject({ ok: false, status: 'invalid' });
    expect((await run({ do: 'list', company: 'nobody' })).reason).toMatch(/has no brand kit in this house — the kits are: .*northwind/);
    expect((await run({ do: 'open', company: 'northwind', card: '../etc' })).status).toBe('invalid');
  });

  test('list says what each card is; open, edit, keep makes one the company\'s own', async () => {
    const listed = await run({ do: 'list', company: 'northwind' });
    expect(listed.detail).toMatch(/^northwind's cards: 0 its own, \d+ still the shared layout, 0 retired/);
    expect(listed.detail).toContain('- stat — SHARED LAYOUT');

    const opened = await run({ do: 'open', company: 'northwind', card: 'stat' });
    expect(opened.ok, opened.reason).toBe(true);
    expect(opened.detail).toContain(draft('stat', 'svg'));
    const shared = await loadTemplate('stat');
    expect(await fs.readFile(draft('stat', 'svg'), 'utf8')).toBe(shared.svg);
    // Opening changes nothing for the company.
    expect((await loadTemplate('stat', { brand: 'northwind', wallet: WALLET })).source).toBe('shared');

    // The member redraws it in its own ground: a rail and an orbit no shared card has.
    await fs.writeFile(draft('stat', 'svg'), shared.svg.replace('</svg>', '<rect id="northwind-rail" x="0" y="0" width="24" height="900" fill="{{token.accent}}"/><circle id="northwind-orbit" cx="1380" cy="450" r="300" fill="none" stroke="{{token.trim}}"/></svg>'));
    const kept = await run({ do: 'keep', company: 'northwind', card: 'stat' });
    expect(kept.ok, kept.reason).toBe(true);
    expect(kept.detail).toMatch(/^northwind now draws its own stat card\./);
    const mine = await loadTemplate('stat', { brand: 'northwind', wallet: WALLET });
    expect(mine.source).toBe('company');
    expect(mine.svg).toContain('northwind-orbit');
    expect((await loadTemplate('stat', { brand: 'umbrae', wallet: WALLET })).source).toBe('shared');
    expect((await run({ do: 'list', company: 'northwind' })).detail).toMatch(/1 its own/);
  });

  test('an unsafe or undrawable design is refused with the reasons, and nothing is kept', async () => {
    expect((await run({ do: 'keep', company: 'northwind', card: 'stat' })).reason).toMatch(/there is no design at .*open it first/);
    await run({ do: 'open', company: 'northwind', card: 'stat' });
    const good = await fs.readFile(draft('stat', 'svg'), 'utf8');
    await fs.writeFile(draft('stat', 'svg'), good.replace('</svg>', '<script>alert(1)</script></svg>'));
    const refused = await run({ do: 'keep', company: 'northwind', card: 'stat' });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/<script> is not something a card draws/);
    await fs.writeFile(draft('stat', 'svg'), good.replace('</svg>', '<text>{{data.nothingDeclared}}</text></svg>'));
    expect((await run({ do: 'keep', company: 'northwind', card: 'stat' })).ok).toBe(false);
    await fs.writeFile(draft('stat', 'svg'), good);
    await fs.writeFile(draft('stat', 'json'), '{ not json');
    expect((await run({ do: 'keep', company: 'northwind', card: 'stat' })).reason).toMatch(/is not readable JSON/);
    expect((await loadTemplate('stat', { brand: 'northwind', wallet: WALLET })).source).toBe('shared');
  });

  test('a new card type starts from an existing one and belongs to this company alone; drop removes it', async () => {
    expect((await run({ do: 'open', company: 'northwind', card: 'pool-spotlight' })).reason).toMatch(/For a NEW card type, name an existing one to start from/);
    expect((await run({ do: 'open', company: 'northwind', card: 'pool-spotlight', from: 'stat' })).ok).toBe(true);
    expect(JSON.parse(await fs.readFile(draft('pool-spotlight', 'json'), 'utf8')).title).toBe('pool-spotlight');
    expect((await run({ do: 'keep', company: 'northwind', card: 'pool-spotlight' })).ok).toBe(true);
    const card = (await cardGallery('northwind', WALLET)).cards.find((c) => c.name === 'pool-spotlight');
    expect(card).toMatchObject({ source: 'company', ownType: true, retired: false });
    expect(cardLine(card)).toMatch(/^- pool-spotlight — ITS OWN CARD TYPE/);
    expect((await cardGallery('umbrae', WALLET)).cards.map((c) => c.name)).not.toContain('pool-spotlight');
    expect((await run({ do: 'retire', company: 'northwind', card: 'pool-spotlight' })).reason).toMatch(/is not a shared card type/);
    expect((await run({ do: 'drop', company: 'northwind', card: 'pool-spotlight' })).detail).toBe('northwind\'s pool-spotlight card type is gone (no other company had it).');
    expect((await cardGallery('northwind', WALLET)).cards.map((c) => c.name)).not.toContain('pool-spotlight');
  });

  test('retire takes a shared card away from one company only, render_card refuses it there, restore brings it back', async () => {
    const before = await cardGallery('northwind', WALLET);
    expect((await run({ do: 'retire', company: 'northwind', card: 'listing' })).detail).toMatch(/^northwind no longer uses the listing card; every other company keeps it\./);
    expect(await readRetired('northwind', WALLET)).toEqual(['listing']);
    expect(await readRetired('umbrae', WALLET)).toEqual([]);
    const after = await cardGallery('northwind', WALLET);
    expect(after.cards.find((c) => c.name === 'listing').retired).toBe(true);
    expect([after.retired, after.shared]).toEqual([1, before.shared - 1]);
    expect((await run({ do: 'list', company: 'northwind' })).detail).toContain('- listing — RETIRED (not used by this company)');
    expect(await describeCards({ wallet: WALLET })).toContain('does NOT use: listing (retired for northwind');

    const drawn = await renderCardForLane({ laneId: LANE, args: { brand: 'northwind', template: 'listing', data: {} }, rasterize: async () => { throw new Error('a retired card must not reach the rasterizer'); }, wallet: WALLET });
    expect(drawn).toMatchObject({ ok: false, errors: [expect.stringMatching(/^northwind does not use the listing card/)] });

    expect((await run({ do: 'restore', company: 'northwind', card: 'listing' })).detail).toBe('northwind uses the listing card again.');
    expect((await cardGallery('northwind', WALLET)).retired).toBe(0);
  });

  test('a company\'s own design is let go before the shared one can be retired', async () => {
    await run({ do: 'open', company: 'northwind', card: 'stat' });
    await run({ do: 'keep', company: 'northwind', card: 'stat' });
    expect((await run({ do: 'retire', company: 'northwind', card: 'stat' })).reason).toMatch(/draws its own stat design — let that go first/);
    expect((await run({ do: 'drop', company: 'northwind', card: 'stat' })).detail).toMatch(/draws the shared stat card again/);
    expect((await run({ do: 'retire', company: 'northwind', card: 'stat' })).ok).toBe(true);
  });
});
