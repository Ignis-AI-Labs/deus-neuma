/**
 * CoS designation (the Optio's seat) — ONE SEAT PER HOUSE on REAL tmp disk,
 * no mock anywhere (RULE 0). The house is its operator's wallet; the seat
 * lives at <realm>/<wallet>/house-optio.json, and a lane's house is its
 * owner.json. Proven here: seat → get → clear per house (explicit null), two
 * houses with two Optios that never see each other, a house with no Optio of
 * its own never reading another's, and the legacy machine seat moving once to
 * the house that owns its lane — or serving no house when no owner resolves
 * (ruling, 2026-10-16: two houses are never confused by the system, at any
 * level).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeDurableDir } from '../helpers/durable-dir.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { cosDesignation, createCosDesignation, houseKey } from '../../backend/services/staff/cos-designation.js';

// Mixed case on purpose: the house key is the LOWERCASED wallet.
const HOUSE_A = '0xAaAa00000000000000000000000000000000aAaA';
const HOUSE_B = '0xbbbb00000000000000000000000000000000bbbb';
const A = HOUSE_A.toLowerCase();

describe('CoS designation — one seat per house (real tmp disk, gnosis)', () => {
  let tmp;
  let lanes;
  const savedLegacy = process.env.NEUMA_STAFF_COS_PATH;
  const priorRealm = getRealmRoot();
  const priorLanes = getWorkspacesRoot();
  const legacyFile = () => process.env.NEUMA_STAFF_COS_PATH;
  const houseFile = (wallet) => path.join(tmp, 'realm', wallet.toLowerCase(), 'house-optio.json');
  const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

  beforeEach(async () => {
    tmp = await createTempDir('cos-designation');
    lanes = path.join(tmp, 'workspaces');
    setRealmRoot(path.join(tmp, 'realm'));
    setWorkspacesRoot(lanes);
    process.env.NEUMA_STAFF_COS_PATH = path.join(tmp, 'settings', 'staff-cos.json');
    // Each house's own lanes, owned by its wallet the way a birth writes it.
    for (const id of ['optiolane', 'firstoptio', 'secondoptio', 'laurel', 'quae']) await writeOwner(lanes, id, HOUSE_A);
    for (const id of ['hazel', 'signal']) await writeOwner(lanes, id, HOUSE_B);
  });

  afterEach(() => {
    setRealmRoot(priorRealm);
    setWorkspacesRoot(priorLanes);
    if (savedLegacy === undefined) delete process.env.NEUMA_STAFF_COS_PATH;
    else process.env.NEUMA_STAFF_COS_PATH = savedLegacy;
  });

  const writeLegacy = async (value) => {
    await fs.mkdir(path.dirname(legacyFile()), { recursive: true });
    await fs.writeFile(legacyFile(), JSON.stringify(value));
  };

  test('the house key is the lowercased wallet; anything else is no house', () => {
    expect(houseKey(HOUSE_A)).toBe(A);
    expect(houseKey('laurel')).toBeNull();
    expect(houseKey(undefined)).toBeNull();
  });

  test('a house that never wrote a record has no officer; no wallet is no house', async () => {
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    expect(await cosDesignation.getOfficer(undefined)).toBeNull();
    expect(await cosDesignation.getOfficer('not-a-wallet')).toBeNull();
  });

  test('designate → get → clear: clearing writes an explicit null in the house\'s own file', async () => {
    const seated = await cosDesignation.designate(HOUSE_A, 'optiolane');
    expect(seated.laneId).toBe('optiolane');
    expect(typeof seated.designatedAt).toBe('string');
    expect(seated.consent).toBeUndefined();

    const officer = await cosDesignation.getOfficer(A); // either case reads the same house
    expect(officer).toEqual(seated);
    expect(await readJson(houseFile(HOUSE_A))).toEqual(seated);

    await cosDesignation.clear(HOUSE_A);
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    // "No Optio" is a RECORDED fact: the file stands, holding null.
    expect(await readJson(houseFile(HOUSE_A))).toBeNull();
  });

  test('a consent note is stamped with the seat; a re-seat replaces the holder; the file is 0600', async () => {
    await cosDesignation.designate(HOUSE_A, 'firstoptio');
    const second = await cosDesignation.designate(HOUSE_A, 'secondoptio', { consent: { note: '  I accept the office.  ' } });
    expect(second.consent).toEqual({ at: second.designatedAt, note: 'I accept the office.' });
    expect((await cosDesignation.getOfficer(HOUSE_A)).laneId).toBe('secondoptio');
    expect((await fs.stat(houseFile(HOUSE_A))).mode & 0o777).toBe(0o600);
  });

  test('a corrupt house record SURFACES — it never collapses to a silent unseat', async () => {
    await fs.mkdir(path.dirname(houseFile(HOUSE_A)), { recursive: true });
    await fs.writeFile(houseFile(HOUSE_A), '{ not json');
    await expect(cosDesignation.getOfficer(HOUSE_A)).rejects.toThrow();
    await fs.writeFile(houseFile(HOUSE_A), JSON.stringify(['not', 'an', 'object']));
    await expect(cosDesignation.getOfficer(HOUSE_A)).rejects.toThrow('store is not an object');
  });

  test('the boundary refuses an empty or oversized lane id and a missing wallet', async () => {
    await expect(cosDesignation.designate(HOUSE_A, '')).rejects.toThrow('lane id');
    await expect(cosDesignation.designate(HOUSE_A, '   ')).rejects.toThrow('lane id');
    await expect(cosDesignation.designate(HOUSE_A, 'x'.repeat(201))).rejects.toThrow('lane id');
    await expect(cosDesignation.designate(undefined, 'optiolane')).rejects.toThrow('wallet');
    await expect(cosDesignation.clear('laurel')).rejects.toThrow('wallet');
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
  });

  test('a house seats only its own lane — another house\'s lane, or a lane of no house, is refused', async () => {
    await expect(cosDesignation.designate(HOUSE_A, 'hazel')).rejects.toThrow('not a lane of this house');
    await expect(cosDesignation.designate(HOUSE_A, 'nolane')).rejects.toThrow('not a lane of this house');
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    expect(await cosDesignation.getOfficer(HOUSE_B)).toBeNull();
  });

  test('two houses, two Optios — each reads only its own; clearing one leaves the other', async () => {
    await cosDesignation.designate(HOUSE_A, 'optiolane');
    await cosDesignation.designate(HOUSE_B, 'hazel');
    expect((await cosDesignation.getOfficer(HOUSE_A)).laneId).toBe('optiolane');
    expect((await cosDesignation.getOfficer(HOUSE_B)).laneId).toBe('hazel');

    await cosDesignation.clear(HOUSE_A);
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    expect((await cosDesignation.getOfficer(HOUSE_B)).laneId).toBe('hazel');
    expect(await cosDesignation.seatedHouses()).toEqual([
      { wallet: HOUSE_B, officer: expect.objectContaining({ laneId: 'hazel' }) },
    ]);
  });

  test('a house with no Optio of its own never sees another house\'s', async () => {
    await cosDesignation.designate(HOUSE_B, 'hazel');
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    // Nor through the legacy seat, once it has moved to its owner's house.
    await writeLegacy({ laneId: 'signal', designatedAt: '2026-10-01T00:00:00.000Z' });
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    expect((await cosDesignation.getOfficer(HOUSE_B)).laneId).toBe('hazel'); // its own newer seat stands
  });

  test('MIGRATION: the legacy machine seat moves to the house that owns its lane, once', async () => {
    const legacy = { laneId: 'laurel', designatedAt: '2026-10-04T19:24:45.443Z' };
    await writeLegacy(legacy);

    // The other house reads first: it triggers the move and still sees nothing.
    expect(await cosDesignation.getOfficer(HOUSE_B)).toBeNull();
    expect(await readJson(houseFile(HOUSE_A))).toEqual({ ...legacy, migratedFrom: 'machine-seat' });
    const tombstone = await readJson(legacyFile());
    expect(tombstone).toMatchObject({ ...legacy, migratedTo: A });
    expect(typeof tombstone.migratedAt).toBe('string');

    // The owner's house holds it, designatedAt intact.
    expect(await cosDesignation.getOfficer(HOUSE_A)).toMatchObject(legacy);

    // Idempotent: more reads move nothing and rewrite nothing.
    expect(await cosDesignation.getOfficer(HOUSE_B)).toBeNull();
    expect(await readJson(legacyFile())).toEqual(tombstone);

    // The owner's clear is final — the tombstone never re-seats it.
    await cosDesignation.clear(HOUSE_A);
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    expect(await cosDesignation.getOfficer(HOUSE_B)).toBeNull();
  });

  test('MIGRATION never overwrites a record the owner\'s house already holds', async () => {
    const own = await cosDesignation.designate(HOUSE_A, 'quae');
    await writeLegacy({ laneId: 'laurel', designatedAt: '2026-10-04T19:24:45.443Z' });
    expect(await cosDesignation.getOfficer(HOUSE_B)).toBeNull(); // triggers the move
    expect(await cosDesignation.getOfficer(HOUSE_A)).toEqual(own);
    expect((await readJson(legacyFile())).migratedTo).toBe(A);
  });

  test('UNRESOLVABLE owner: the legacy seat serves NO house and stays on disk untouched', async () => {
    const legacy = { laneId: 'orphanlane', designatedAt: '2026-10-04T19:24:45.443Z' };
    await writeLegacy(legacy);
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    expect(await cosDesignation.getOfficer(HOUSE_B)).toBeNull();
    expect(await cosDesignation.seatedHouses()).toEqual([]);
    expect(await readJson(legacyFile())).toEqual(legacy);
    await expect(fs.access(houseFile(HOUSE_A))).rejects.toThrow();
    await expect(fs.access(houseFile(HOUSE_B))).rejects.toThrow();
  });

  test('a corrupt legacy seat serves no house and never blocks a house\'s own seat', async () => {
    await fs.mkdir(path.dirname(legacyFile()), { recursive: true });
    await fs.writeFile(legacyFile(), '{ not json');
    expect(await cosDesignation.getOfficer(HOUSE_A)).toBeNull();
    await cosDesignation.designate(HOUSE_B, 'hazel');
    expect((await cosDesignation.getOfficer(HOUSE_B)).laneId).toBe('hazel');
    expect(await fs.readFile(legacyFile(), 'utf8')).toBe('{ not json');
  });

  test('the factory reads the legacy seat from a path of the caller\'s choosing', async () => {
    const ownLegacy = path.join(tmp, 'own-legacy.json');
    await fs.writeFile(ownLegacy, JSON.stringify({ laneId: 'signal', designatedAt: '2026-10-02T00:00:00.000Z' }));
    const own = createCosDesignation({ legacy: ownLegacy });
    expect((await own.getOfficer(HOUSE_B)).laneId).toBe('signal');
    expect((await readJson(ownLegacy)).migratedTo).toBe(HOUSE_B);
    // The singleton's own (env) legacy path was never written.
    await expect(fs.access(legacyFile())).rejects.toThrow();
  });
  test('a TEST process never moves a live (non-temp) legacy seat — it serves no house and stays untouched', async () => {
    // A legacy file outside the temp tree, the shape of the operator's real
    // data/settings/staff-cos.json when a test forgets to pin its path.
    // (outside the OS temp dir even when the checkout sits under it)
    const liveDir = makeDurableDir('cos-guard');
    const liveLegacy = path.join(liveDir, 'staff-cos.json');
    try {
      const raw = JSON.stringify({ laneId: 'laurel', designatedAt: '2026-10-04T19:24:45.443Z' });
      await fs.writeFile(liveLegacy, raw);
      const guarded = createCosDesignation({ legacy: liveLegacy });
      expect(await guarded.getOfficer(HOUSE_A)).toBeNull();
      expect(await fs.readFile(liveLegacy, 'utf8')).toBe(raw);
      await expect(fs.access(houseFile(HOUSE_A))).rejects.toThrow();
    } finally {
      await fs.rm(liveDir, { recursive: true, force: true });
    }
  });
});
