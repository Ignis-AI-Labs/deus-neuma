/**
 * A BRAND KIT PER MANAGED COMPANY, IN THE OPERATOR'S OWN GROUND.
 *
 * Design note, 2026-08-30: […]
 *
 * Nothing here is mocked. A REAL house ground is raised in a temp realm through
 * `setHouseWorkspace` — the same function the operator's own choice runs
 * through — real kits are written to real disk, and the real loader resolves
 * them. The precedence rule is the whole feature, and a precedence rule proven
 * against a stub is a rule that has never been tested.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setRealmRoot, getRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import {
  loadBrand, listBrands, listBrandsDetailed, loadMarks, loadGuest, listGuestSlugs, brandsDir,
} from '../../backend/services/branding/brand-tokens.js';
import { pressOf, ownerOf, chartPaletteFor } from '../../backend/services/branding/kit-shape.js';
import { campaignCreateIntent } from '../../backend/services/intents/campaign-acts.js';

const WALLET = '0x00000000000000000000000000000000000000ff';
// The real realm is captured and restored rather than nulled: `setRealmRoot`
// resolves its argument, so there is no "unset" — and a test that left the
// realm pointing at a swept temp dir would poison every test after it.
const REAL_REALM = getRealmRoot();
let realm; let ground;

/** A kit exactly as an operator (or a being helping) would write one. */
const KIT = {
  brand: 'northwind',
  name: 'Northwind Capital',
  handle: '@northwind',
  owner: 'metidar',
  footer: 'NORTHWIND · northwind.example',
  colors: {
    bg: '#0b0b0c', bgScreen: '#141416', ink: '#fafafa', inkSoft: '#d4d4d6',
    muted: '#8e8e93', hairline: '#262629', accent: '#ff6b00', trim: '#3a3a3f',
    trimHot: '#ffd400', warn: '#ff2d2d', rise: '#00ff88', halo: '#ff9d3c',
  },
  type: {
    display: "'Rajdhani', sans-serif", voice: 'Inter, sans-serif', data: "'JetBrains Mono', monospace",
    numeral: "'JetBrains Mono', monospace",
    displayWeight: '700', displayTrack: '0',
    voiceWeight: '400',
    numeralWeight: '300', numeralTrack: '-0.02em',
    labelWeight: '400', labelTrack: '0.2em',
  },
  embedFonts: ['rajdhani-bold', 'inter-regular', 'mono-data'],
  // ⚠️ `mask` joined the gate on 2026-08-31 alongside `handle`: five of the six
  // templates compose around it, and neither was ever asked for — so a kit
  // could read READY and still refuse every card it was ready for.
  marks: {
    wordmark: { file: 'wordmark.svg', recolor: { '#000000': 'ink' } },
    mask: { file: 'mask.svg', recolor: { '#000000': 'ink' } },
  },
  press: { companyName: 'Northwind Capital', documentFooter: 'Northwind · Confidential', format: 'A4', marginCm: 2, logos: { primary: 'wordmark.svg' } },
};

const writeKit = async (name, kit, file = 'brand.json') => {
  const dir = path.join(ground, 'brands', name);
  await fs.mkdir(path.join(dir, 'marks'), { recursive: true });
  await fs.writeFile(path.join(dir, file), JSON.stringify(kit, null, 2));
  const art = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000000"/></svg>';
  await fs.writeFile(path.join(dir, 'marks', 'wordmark.svg'), art);
  await fs.writeFile(path.join(dir, 'marks', 'mask.svg'), art);
  return dir;
};

beforeEach(async () => {
  realm = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-kit-realm-'));
  ground = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-kit-ground-'));
  setRealmRoot(realm);
  await setHouseWorkspace(WALLET, ground);
});

afterEach(async () => {
  setRealmRoot(REAL_REALM);
  await fs.rm(realm, { recursive: true, force: true });
  await fs.rm(ground, { recursive: true, force: true });
});

describe('the ground carries a brands trunk', () => {
  test('setting the ground raises brands/ beside workspaces/', async () => {
    // Raised from the first set, like post/ and workspaces/ — so an operator
    // never has to know a directory name before he can author a kit.
    await expect(fs.access(path.join(ground, 'brands'))).resolves.toBeUndefined();
  });
});

describe('a managed company gets its own kit', () => {
  test('a workspace-only brand loads, and says it came from the workspace', async () => {
    await writeKit('northwind', KIT);
    const out = await loadBrand('northwind', { wallet: WALLET });
    expect(out.ok, out.error).toBe(true);
    expect(out.where).toBe('workspace');
    expect(out.tokens.colors.accent).toBe('#ff6b00');
  });

  test('it is INVISIBLE without the wallet — a kit belongs to a ground', async () => {
    await writeKit('northwind', KIT);
    const out = await loadBrand('northwind');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no brand "northwind"/);
  });

  test('the house member responsible is part of the brand', async () => {
    await writeKit('northwind', KIT);
    const { tokens } = await loadBrand('northwind', { wallet: WALLET });
    // Recorded IN the kit, not in its path: handing a brand to someone else is
    // an edit, never a file move.
    expect(ownerOf(tokens)).toBe('metidar');
  });

  test('marks resolve from the KIT\'S OWN directory, never the repo\'s', async () => {
    await writeKit('northwind', KIT);
    const brand = await loadBrand('northwind', { wallet: WALLET });
    const { marks, missing } = await loadMarks('northwind', brand.tokens, { dir: brand.dir, wallet: WALLET });
    expect(missing).toEqual([]);
    expect(marks.wordmark).toMatch(/^data:image\/svg\+xml;base64,/);
    // Recoloured by the WORKSPACE kit's own token, proving it read that file.
    const svg = Buffer.from(marks.wordmark.split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('#fafafa');
    expect(svg).not.toContain('#000000');
  });
});

describe('THE PRECEDENCE RULE — the workspace wins', () => {
  test('a workspace kit overrides a repo brand of the same name', async () => {
    // umbrae ships in this repo. The operator's own kit for it must win: his
    // file is the newer decision and the one he can actually edit.
    const repo = await loadBrand('umbrae');
    expect(repo.ok).toBe(true);
    expect(repo.where).toBe('repo');

    await writeKit('umbrae', { ...KIT, brand: 'umbrae', name: 'Umbrae' });
    const own = await loadBrand('umbrae', { wallet: WALLET });
    expect(own.where).toBe('workspace');
    expect(own.tokens.colors.accent).toBe('#ff6b00');
    expect(own.tokens.colors.accent).not.toBe(repo.tokens.colors.accent);
  });

  test('the list SHADOWS rather than duplicating — one name, one brand', async () => {
    await writeKit('umbrae', { ...KIT, brand: 'umbrae' });
    const names = await listBrands({ wallet: WALLET });
    // Two entries called umbrae would make `--brand umbrae` ambiguous.
    expect(names.filter((n) => n === 'umbrae')).toHaveLength(1);
    const detailed = await listBrandsDetailed({ wallet: WALLET });
    expect(detailed.find((b) => b.brand === 'umbrae').where).toBe('workspace');
    // …and a repo brand the operator has NOT overridden is still there.
    expect(detailed.find((b) => b.brand === 'ignis').where).toBe('repo');
  });

  test('the repo still renders with no ground at all — a fresh clone is not broken', async () => {
    const out = await loadBrand('ignis');
    expect(out.ok).toBe(true);
    expect(out.dir.startsWith(brandsDir())).toBe(true);
  });
});

describe('a legacy tokens.json is already a valid kit', () => {
  test('a workspace kit written as tokens.json loads the same way', async () => {
    // Every brand on disk today is a tokens.json. None of them is broken by
    // the merged shape, and nothing had to be migrated for this to ship.
    const { press, ...legacy } = KIT;
    await writeKit('northwind', legacy, 'tokens.json');
    const out = await loadBrand('northwind', { wallet: WALLET });
    expect(out.ok, out.error).toBe(true);
    expect(out.where).toBe('workspace');
  });
});

describe('the press half comes off the SAME kit', () => {
  test('page setup is read from the kit the cards use', async () => {
    await writeKit('northwind', KIT);
    const { tokens } = await loadBrand('northwind', { wallet: WALLET });
    const press = pressOf(tokens);
    expect(press.format).toBe('A4');
    expect(press.marginCm).toBe(2);
    expect(press.documentFooter).toBe('Northwind · Confidential');
  });

  test('a kit with NO press block still yields sane page setup', async () => {
    const { press, ...noPress } = KIT;
    await writeKit('northwind', noPress);
    const { tokens } = await loadBrand('northwind', { wallet: WALLET });
    const out = pressOf(tokens);
    expect(out.format).toBe('Letter');
    expect(out.marginCm).toBe(1.5);
    // The card footer answers for the page footer — a company that told us what
    // to put at the bottom of a card has told us what to put at the bottom of a page.
    expect(out.documentFooter).toBe('NORTHWIND · northwind.example');
  });

  test('THE PAGE KEEPS ITS OWN PAPER — a screen palette must not print', async () => {
    // A card is dark-on-dark; a document is ink on paper. Mapping bg→paper
    // mechanically would print a black page with white text. Only the parts
    // that identify the brand rather than the surface cross over.
    await writeKit('northwind', KIT);
    const { tokens } = await loadBrand('northwind', { wallet: WALLET });
    const out = pressOf(tokens);
    expect(out.colors.accent).toBe('#ff6b00');   // the accent travels
    expect(out.colors.paper).toBeUndefined();    // the dark bg does NOT
    expect(out.colors.ink).toBeUndefined();
  });

  test('a press block may override even the accent, and wins', async () => {
    await writeKit('northwind', { ...KIT, press: { ...KIT.press, colors: { accent: '#123456', paper: '#fffdf7' } } });
    const { tokens } = await loadBrand('northwind', { wallet: WALLET });
    const out = pressOf(tokens);
    expect(out.colors.accent).toBe('#123456');
    expect(out.colors.paper).toBe('#fffdf7');
  });

  test('THE CHART PALETTE IS THE BRAND — not a generic rainbow', async () => {
    // The bug this closes: the shipped Ignis press kit drew charts from
    // #FF4444/#4444FF/#44FF44 while the Ignis card drew in cyan. A company's
    // documents and its cards were literally different brands.
    await writeKit('northwind', KIT);
    const { tokens } = await loadBrand('northwind', { wallet: WALLET });
    const palette = chartPaletteFor(tokens);
    expect(palette[0]).toBe('#ff6b00');            // the brand's own accent leads
    expect(new Set(palette).size).toBe(palette.length); // no series shares a colour
    for (const c of palette) expect(Object.values(tokens.colors)).toContain(c);
  });
});

describe('a broken kit refuses BY NAME, before anything renders', () => {
  test('an unsupported page format is named with the ones that work', async () => {
    await writeKit('northwind', { ...KIT, press: { ...KIT.press, format: 'Poster' } });
    const out = await loadBrand('northwind', { wallet: WALLET });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/press\.format is "Poster"/);
    expect(out.error).toMatch(/Letter, A4/);
  });

  test('a logo that is a PATH rather than a name is refused', async () => {
    await writeKit('northwind', { ...KIT, press: { ...KIT.press, logos: { primary: '../../../etc/passwd.svg' } } });
    const out = await loadBrand('northwind', { wallet: WALLET });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not a logo file name/);
  });

  test('an owner that is not a neumaId is refused', async () => {
    await writeKit('northwind', { ...KIT, owner: '../metidar' });
    const out = await loadBrand('northwind', { wallet: WALLET });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/is not a neumaId/);
  });
});

describe('THE GATE — marketing work refuses a brand nobody has set up', () => {
  // Design note, 2026-08-30: […] A campaign is where marketing work
  // BEGINS, so this is the earliest honest place the gate can stand.
  const connection = { walletAddress: WALLET };
  const declare = (brand) =>
    campaignCreateIntent.validate({ name: 'Launch week', brand }, { connection });

  test('a brand with NO kit at all is refused, and told to start one', async () => {
    const out = await declare('nosuchbrand');
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no brand kit for "nosuchbrand"/);
    // A missing kit is a different fault from an incomplete one: there is
    // nothing to finish, only something to start.
    expect(out.reason).toMatch(/set up ONCE, before the work/);
  });

  test('an INCOMPLETE kit is refused with the checklist, not a bare error', async () => {
    await writeKit('northwind', KIT);   // visually complete, verbally empty
    const out = await declare('northwind');
    expect(out.ok).toBe(false);
    // The dangerous half is what is missing, and the refusal says so by name.
    expect(out.reason).toMatch(/CLAIMS/);
    expect(out.reason).toMatch(/claims\.forbidden/);
    expect(out.reason).toMatch(/VOICE/);
    expect(out.reason).toMatch(/sections are complete/);
  });

  test('a COMPLETE kit opens the gate — the campaign is declared', async () => {
    await writeKit('northwind', {
      ...KIT,
      positioning: 'Liquidity infrastructure for teams who do not run a desk.',
      audience: 'Protocol treasuries on Base.',
      pillars: ['capital efficiency', 'no unwind'],
      tagline: 'Liquidity that keeps working.',
      boilerplate: 'Northwind Capital builds liquidity infrastructure on Base.',
      voice: 'Plain, exact, unhurried.',
      tone: 'Level on launches; brief on incidents.',
      bannedPatterns: ['guaranteed returns', 'risk-free'],
      claims: { approved: ['non-custodial'], forbidden: ['any projected APY'] },
      disclosures: ['Not financial advice.'],
      logoRules: { clearSpace: 'one cap-height', minWidthPx: 96, misuse: ['never stretch'] },
      imagery: { direction: 'Instrument photography, hard light.', avoid: ['stock handshakes'] },
      accessibility: { contrastMin: 4.5, altTextRequired: true },
      channels: { x: { handle: '@northwind' } },
      competitors: { neverName: [] },
    });
    const out = await declare('northwind');
    expect(out.ok, out.reason).toBe(true);
    expect(out.value.brand).toBe('northwind');
  });

  test('the campaign still needs its own fields — the gate ADDS, never replaces', async () => {
    const out = await campaignCreateIntent.validate({ brand: 'northwind' }, { connection });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/needs \{name, brand\}/);
  });
});

describe('PER-ASSET FALLBACK — a shadowing kit does not hide the repo\'s files', () => {
  // 2026-09-01, the Virtuals listing card: the house ground's umbrae kit
  // (brand.json + marks, no guests/) shadowed the repo kit wholesale, so the
  // guest logo dropped into the REPO kit was invisible — and the refusal said
  // […] without naming a single directory. Kit
  // precedence is about DECISIONS (tokens, recolor rules), not about holding
  // individual files hostage.
  const shadowUmbrae = () => writeKit('umbrae', { ...KIT, brand: 'umbrae', name: 'Umbrae' });

  test('a guest dropped into the REPO kit resolves through a workspace kit that lacks it', async () => {
    await shadowUmbrae();
    const brand = await loadBrand('umbrae', { wallet: WALLET });
    expect(brand.where).toBe('workspace');
    // The workspace kit has no guests/ at all; the repo kit ships this fixture.
    const got = await loadGuest('umbrae', 'example-token', { dir: brand.dir, wallet: WALLET });
    expect(got.missing).toBe(null);
    expect(got.mark).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  test('a guest nobody has refuses naming EVERY directory that was checked', async () => {
    await shadowUmbrae();
    const brand = await loadBrand('umbrae', { wallet: WALLET });
    const got = await loadGuest('umbrae', 'nobody-here', { dir: brand.dir, wallet: WALLET });
    expect(got.mark).toBe(null);
    expect(got.missing).toContain('guests/nobody-here.svg');
    // Both homes, absolute — the workspace kit's and the repo's. "There" is
    // never unnamed again.
    expect(got.missing).toContain(path.join(ground, 'brands', 'umbrae', 'guests'));
    expect(got.missing).toContain(path.join(brandsDir(), 'umbrae', 'guests'));
  });

  test('a mark file the shadowing kit lacks falls through to the repo\'s copy', async () => {
    // The shadowing kit declares a wordmark but does not carry the file; the
    // repo kit does. The card still draws, recoloured by the WORKSPACE kit's
    // own tokens — the asset borrows a file, never a decision.
    const dir = await shadowUmbrae();
    await fs.rm(path.join(dir, 'marks', 'wordmark.svg'));
    const brand = await loadBrand('umbrae', { wallet: WALLET });
    const { marks, missing } = await loadMarks('umbrae', brand.tokens, { dir: brand.dir, wallet: WALLET });
    expect(missing.filter((m) => m.startsWith('wordmark'))).toEqual([]);
    expect(marks.wordmark).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  test('a mark missing EVERYWHERE is reported with the directories checked', async () => {
    const dir = await shadowUmbrae();
    await fs.rm(path.join(dir, 'marks', 'wordmark.svg'));
    await fs.rm(path.join(dir, 'marks', 'mask.svg'));
    const brand = await loadBrand('northwind-missing-everything', { wallet: WALLET });
    expect(brand.ok).toBe(false); // never wrote this kit — prove the ground really lacks it
    const { missing } = await loadMarks('umbrae', {
      ...KIT, marks: { ghost: { file: 'ghost.svg' } },
    }, { dir: brand.dir, wallet: WALLET });
    expect(missing[0]).toContain('no marks/ghost.svg');
    expect(missing[0]).toContain(path.join(brandsDir(), 'umbrae', 'marks'));
  });

  test('the describe surface lists the guest slugs that are actually on hand', async () => {
    await shadowUmbrae();
    const brand = await loadBrand('umbrae', { wallet: WALLET });
    const slugs = await listGuestSlugs('umbrae', { dir: brand.dir, wallet: WALLET });
    // Merged across homes: the repo kit's fixtures are on hand even though the
    // workspace kit carries none.
    expect(slugs).toContain('example-token');
  });
});
