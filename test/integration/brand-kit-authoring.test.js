/**
 * AUTHORING A BRAND KIT — the half of the ask that was still hand-edited JSON.
 *
 * Design note, 2026-08-31: […]
 *
 * The store and the readiness gate shipped on 2026-08-30; nothing could WRITE a
 * kit. This proves the write side against a REAL house ground raised through
 * `setHouseWorkspace` — the same call the operator's own choice runs through —
 * on real disk, read back by the real loader.
 *
 * The two laws under test are the ones that would quietly cost something:
 * a save never touches the repo's shipped kits, and saving is not held to the
 * nine-section standard that gates going out under a brand.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setRealmRoot, getRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { loadBrand, brandsDir } from '../../backend/services/branding/brand-tokens.js';
import {
  brandNameRefusal, kitSkeleton, listKits, readKit, writeKit,
} from '../../backend/services/branding/kit-store.js';
import { KIT_SECTIONS, kitReadiness } from '../../backend/services/branding/kit-readiness.js';

const WALLET = '0x00000000000000000000000000000000000000fe';
// Captured and restored rather than nulled: setRealmRoot resolves its argument,
// so there is no "unset", and a realm left pointing at a swept temp dir would
// poison every test after this file.
const REAL_REALM = getRealmRoot();
let realm; let ground;

beforeEach(async () => {
  realm = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-authoring-realm-'));
  ground = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-authoring-ground-'));
  setRealmRoot(realm);
  await setHouseWorkspace(WALLET, ground);
});

afterEach(async () => {
  setRealmRoot(REAL_REALM);
  await fs.rm(realm, { recursive: true, force: true });
  await fs.rm(ground, { recursive: true, force: true });
});

describe('a kit can be started from nothing', () => {
  test('the skeleton is immediately loadable — it saves on the first try', async () => {
    // A starting point that will not save is not a starting point.
    const saved = await writeKit('northwind', WALLET, kitSkeleton('northwind'));
    expect(saved.ok, saved.error || (saved.refusals || []).join('; ')).toBe(true);
    const loaded = await loadBrand('northwind', { wallet: WALLET });
    expect(loaded.ok, loaded.error).toBe(true);
    expect(loaded.where).toBe('workspace');
  });

  test('the whole shape is PRESENT, but every answer is still blank', async () => {
    // The standard IS the shape (Design note, 2026-08-31: […]), so a new kit carries all of it — nobody filling one in
    // should have to know nineteen field names first. What it must not carry is
    // answers: each is null, which `holds()` refuses for every kind.
    const saved = await writeKit('northwind', WALLET, kitSkeleton('northwind'));
    expect(saved.readiness.ready).toBe(false);
    const at = (o, p) => p.split('.').reduce((n, k) => (n == null ? undefined : n[k]), o);
    // Checked at the LEAVES. `claims` is a branch carrying `claims.approved`
    // and `claims.forbidden`, so the branch itself is an object — asserting the
    // branch is null would fail on a kit that is perfectly blank.
    for (const leaf of ['positioning', 'voice', 'claims.approved', 'claims.forbidden',
      'tagline', 'audience', 'pillars', 'logoRules.misuse', 'accessibility.contrastMin']) {
      expect(at(saved.kit, leaf), `${leaf} is missing from the shape`).not.toBeUndefined();
      expect(at(saved.kit, leaf), `${leaf} was answered on the company's behalf`).toBeNull();
    }
    // `type.voice` is the face PROSE is set in — a different thing from
    // `voice`, the way the brand speaks. Both exist; only one is filled.
    expect(saved.kit.type.voice).toBeTruthy();
  });

  test('and NOT ONE of the nine sections passes on a fresh kit', async () => {
    // The trap this closes: seeding `disclosures: []` or `competitors.neverName:
    // []` would clear LEGAL and half of CHANNELS on creation, because an empty
    // list IS a real answer in those two places. A brand nobody had thought
    // about would walk straight through the check that exists to force it.
    const readiness = kitReadiness(kitSkeleton('northwind'));
    expect(readiness.sections.filter((s) => s.ready)).toEqual([]);
  });

  test('the scaffold is GENERATED from the gate, so the two cannot drift', () => {
    // This is the mechanism behind […]. Add a
    // section to KIT_SECTIONS tomorrow and it appears in every new kit the same
    // day. A hand-written starter would drift on the first change, and the
    // drift would surface as somebody filling in a kit that still refuses.
    const kit = kitSkeleton('northwind');
    const at = (o, p) => p.split('.').reduce((n, k) => (n == null ? undefined : n[k]), o);
    for (const section of KIT_SECTIONS) {
      for (const field of section.fields) {
        expect(at(kit, field.path), `${field.path} is not in the scaffold`).not.toBeUndefined();
      }
    }
  });

  test('it lands on disk as brand.json in the operator\'s own ground', async () => {
    await writeKit('northwind', WALLET, kitSkeleton('northwind'));
    const onDisk = path.join(ground, 'brands', 'northwind', 'brand.json');
    expect(JSON.parse(await fs.readFile(onDisk, 'utf8')).brand).toBe('northwind');
  });
});

describe('saving is not the gate', () => {
  test('a kit missing eight of nine sections still SAVES', async () => {
    // Completeness gates going OUT under a brand. Holding the save to it would
    // mean a kit could only be written once it was already finished — and
    // nobody authors that way.
    const saved = await writeKit('northwind', WALLET, kitSkeleton('northwind'));
    expect(saved.ok).toBe(true);
    expect(saved.readiness.sections.filter((s) => s.ready).length).toBeLessThan(9);
  });

  test('but a kit the RENDERER could not open is refused, by field', async () => {
    // The floor is exactly "loadable": save something the card path cannot
    // read and the panel could never read it back either.
    const broken = { ...kitSkeleton('northwind'), colors: { bg: '#0b0b0c' } };
    const result = await writeKit('northwind', WALLET, broken);
    expect(result.ok).toBe(false);
    expect(result.refusals.join(' ')).toMatch(/ink/);
    expect(result.refusals.join(' ')).toMatch(/accent/);
  });

  test('a refused save writes NOTHING — a bad edit never lands half-applied', async () => {
    await writeKit('northwind', WALLET, kitSkeleton('northwind'));
    const good = await readKit('northwind', WALLET);
    await writeKit('northwind', WALLET, { ...kitSkeleton('northwind'), colors: {} });
    const after = await readKit('northwind', WALLET);
    expect(after.kit).toEqual(good.kit);
  });

  test('a colour the renderer cannot trust is named rather than accepted', async () => {
    const result = await writeKit('northwind', WALLET, {
      ...kitSkeleton('northwind'),
      colors: { bg: '#0b0b0c', ink: '#fafafa', accent: 'sort of blue' },
    });
    expect(result.ok).toBe(false);
    expect(result.refusals.join(' ')).toContain('sort of blue');
  });
});

describe('a write never reaches the repo', () => {
  test('editing a SHIPPED brand shadows it instead of changing it', async () => {
    // `ignis` ships in the source tree. The operator editing it must get a kit
    // of their own — the fallback a fresh clone depends on stays untouched.
    const before = await fs.readFile(path.join(brandsDir(), 'ignis', 'tokens.json'), 'utf8');
    const saved = await writeKit('ignis', WALLET, {
      ...kitSkeleton('ignis'), name: 'Ignis, as the operator wants it',
    });
    expect(saved.ok, saved.error).toBe(true);
    expect(saved.where).toBe('workspace');
    expect(await fs.readFile(path.join(brandsDir(), 'ignis', 'tokens.json'), 'utf8')).toBe(before);
  });

  test('and the shadow is what everything downstream then reads', async () => {
    await writeKit('ignis', WALLET, { ...kitSkeleton('ignis'), name: 'Shadowed' });
    const loaded = await loadBrand('ignis', { wallet: WALLET });
    expect(loaded.tokens.name).toBe('Shadowed');
    // Without the wallet there is no ground, so the repo's own still stands.
    expect((await loadBrand('ignis')).tokens.name).toBe('Ignis AI Labs');
  });

  test('with no ground at all, a save refuses rather than choosing a place', async () => {
    const result = await writeKit('northwind', null, kitSkeleton('northwind'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no house ground/);
  });
});

describe('the list answers what the operator asked to see', () => {
  test('how many kits there are, and how many are actually usable', async () => {
    await writeKit('northwind', WALLET, kitSkeleton('northwind'));
    const kits = await listKits(WALLET);
    const names = kits.map((k) => k.brand);
    expect(names).toContain('northwind');
    // The repo's two ride along — they are reachable, so they are listed.
    expect(names).toContain('ignis');
    expect(names).toContain('umbrae');
    for (const kit of kits) {
      expect(kit).toHaveProperty('done');
      expect(kit).toHaveProperty('total');
      expect(typeof kit.ready).toBe('boolean');
    }
  });

  test('a workspace kit SHADOWS the repo one rather than listing twice', async () => {
    await writeKit('ignis', WALLET, kitSkeleton('ignis'));
    const kits = await listKits(WALLET);
    expect(kits.filter((k) => k.brand === 'ignis')).toHaveLength(1);
    expect(kits.find((k) => k.brand === 'ignis').where).toBe('workspace');
  });

  test('a DAMAGED kit is listed carrying its error, never silently missing', async () => {
    // An operator whose brand vanishes from the list concludes it was deleted
    // and writes it again — over the file that was merely unparseable.
    const dir = path.join(ground, 'brands', 'broken');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'brand.json'), '{ this is not json');
    const entry = (await listKits(WALLET)).find((k) => k.brand === 'broken');
    expect(entry).toBeTruthy();
    expect(entry.error).toMatch(/could not be read/);
  });
});

describe('a brand name reaches disk, so it is a name and never a path', () => {
  test('traversal, separators and empties are refused before any write', async () => {
    for (const bad of ['../../etc', 'a/b', '', 'Northwind', '.hidden', 'x'.repeat(41)]) {
      expect(brandNameRefusal(bad), `"${bad}" was accepted`).toBeTruthy();
      expect((await writeKit(bad, WALLET, kitSkeleton('x'))).ok).toBe(false);
    }
  });

  test('an ordinary name passes', () => {
    expect(brandNameRefusal('northwind-capital')).toBeNull();
  });
});
