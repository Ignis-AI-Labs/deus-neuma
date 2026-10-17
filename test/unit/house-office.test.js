/**
 * THE HOUSE OFFICES — seats and the legacy move, on REAL tmp disk, no double
 * anywhere (RULE 0). Two houses on one machine with the same lane id in
 * both (Design note, 2026-10-16: […]).
 *
 * Proven: each house seats its own CSO/CLO/CMO and never sees the other's;
 * a house seats only its own lane; the machine-wide seat and office data
 * move once to the house that owns the seated lane, or with no seat to the
 * original single operator; an unresolvable owner serves no house and leaves
 * the legacy record untouched; a house's own record is never overwritten.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { csoDesignation } from '../../backend/services/security/cso-designation.js';
import { cloDesignation } from '../../backend/services/legal/clo-designation.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { createLegacyMove, officeFile, officeHouses } from '../../backend/services/house-office.js';
import { soleOwner, sameWorld } from '../../backend/services/house-office-legacy.js';

const SEATS = [
  ['CSO', csoDesignation, 'house-cso.json', 'security-cso.json'],
  ['CLO', cloDesignation, 'house-clo.json', 'legal-clo.json'],
  ['CMO', cmoDesignation, 'house-cmo.json', 'marketing-cmo.json'],
];

describe('house office seats — one per house (real tmp disk)', () => {
  let houses;
  beforeEach(async () => { houses = await standTwoHouses({ label: 'office-seats' }); });
  afterEach(() => houses.restore());

  test.each(SEATS)('%s: the same lane id seated in two houses — each house sees only its own', async (_t, seat, file) => {
    houses.asHouse(HOUSE_A);
    const a = await seat.designate(HOUSE_A, 'keir');
    houses.asHouse(HOUSE_B);
    const b = await seat.designate(HOUSE_B, 'keir');
    expect(await houses.readJson(houses.houseFile(HOUSE_A, file))).toEqual(a);
    expect(await houses.readJson(houses.houseFile(HOUSE_B, file))).toEqual(b);

    await seat.clear(HOUSE_A);
    expect(await seat.getOfficer(HOUSE_A)).toBeNull();
    expect(await seat.holds(HOUSE_A, 'keir')).toBe(false);
    expect(await seat.holds(HOUSE_B, 'keir')).toBe(true);
    expect((await seat.getOfficer(HOUSE_B)).laneId).toBe('keir');
    // explicit null, never an absent file
    expect(await houses.readJson(houses.houseFile(HOUSE_A, file))).toBeNull();
  });

  test.each(SEATS)('%s: a house seats only its own lane; no wallet is no house', async (_t, seat) => {
    houses.asHouse(HOUSE_A);
    await expect(seat.designate(HOUSE_B, 'dovan')).rejects.toThrow(/not a lane of this house/);
    await expect(seat.designate('not-a-wallet', 'dovan')).rejects.toThrow(/wallet/);
    await expect(seat.clear(undefined)).rejects.toThrow(/wallet/);
    expect(await seat.getOfficer(undefined)).toBeNull();
    expect(await seat.getOfficer(HOUSE_B)).toBeNull();
  });

  test.each(SEATS)('%s: the legacy machine seat moves once to the house that owns its lane', async (_t, seat, file, legacyName) => {
    await houses.writeLegacy(legacyName, { laneId: 'dovan', designatedAt: '2026-08-06T13:56:32.074Z' });
    houses.asHouse(HOUSE_B); // even served from house B's process, dovan is A's lane by the original root
    expect(await seat.getOfficer(HOUSE_B)).toBeNull();
    expect((await seat.getOfficer(HOUSE_A)).laneId).toBe('dovan');
    const tomb = await houses.readJson(houses.legacy(legacyName));
    expect(tomb.migratedTo).toBe(HOUSE_A);
    expect(tomb.laneId).toBe('dovan');
    // idempotent: a clear in house A is never undone by the tombstone
    await seat.clear(HOUSE_A);
    expect(await seat.getOfficer(HOUSE_A)).toBeNull();
    expect(await seat.seatedHouses()).toEqual([]);
  });

  test.each(SEATS)('%s: a legacy seat whose owner cannot be resolved serves NO house, file untouched', async (_t, seat, _file, legacyName) => {
    const legacy = { laneId: 'ghostlane', designatedAt: '2026-08-06T00:00:00.000Z' };
    await houses.writeLegacy(legacyName, legacy);
    expect(await seat.getOfficer(HOUSE_A)).toBeNull();
    expect(await seat.getOfficer(HOUSE_B)).toBeNull();
    expect(await houses.readJson(houses.legacy(legacyName))).toEqual(legacy);
  });
});

describe('the legacy office data move (real tmp disk)', () => {
  let houses;
  beforeEach(async () => { houses = await standTwoHouses({ label: 'office-move' }); });
  afterEach(() => houses.restore());

  const moveOf = () => createLegacyMove({
    office: 'security',
    name: 'security-threats.json',
    legacyPath: () => houses.legacy('security-threats.json'),
    legacySeatPath: () => houses.legacy('security-cso.json'),
  });
  const dest = (wallet) => officeFile(wallet, 'security', 'security-threats.json');
  const RECORDS = [{ id: 'th_1', title: 'one' }, { id: 'th_2', title: 'two' }];

  test('the data goes to the house that owns the seated lane — never both', async () => {
    houses.asHouse(HOUSE_B);
    await writeOwner(houses.rootA, 'brio', HOUSE_A); // the original root says brio is A's
    await houses.writeLegacy('security-cso.json', { laneId: 'brio' });
    await houses.writeLegacy('security-threats.json', RECORDS);
    await moveOf()();
    expect(await houses.readJson(dest(HOUSE_A))).toEqual(RECORDS);
    await expect(fs.access(dest(HOUSE_B))).rejects.toThrow();
    const tomb = await houses.readJson(houses.legacy('security-threats.json'));
    expect(tomb).toMatchObject({ migratedTo: HOUSE_A, office: 'security/security-threats.json' });
    expect(JSON.stringify(tomb)).not.toContain('th_1');
  });

  test('a seat already moved names its house by the tombstone', async () => {
    await houses.writeLegacy('security-cso.json', { laneId: 'keir', migratedTo: HOUSE_B });
    await houses.writeLegacy('security-threats.json', RECORDS);
    await moveOf()();
    expect(await houses.readJson(dest(HOUSE_B))).toEqual(RECORDS);
  });

  test('no seat (absent or explicit null) → the original single operator', async () => {
    await houses.writeLegacy('security-cso.json', null);
    await houses.writeLegacy('security-threats.json', RECORDS);
    await moveOf()();
    expect(await houses.readJson(dest(HOUSE_A))).toEqual(RECORDS);
  });

  test('idempotent: a second move changes nothing, and the house keeps its own edits', async () => {
    await houses.writeLegacy('security-threats.json', RECORDS);
    await moveOf()();
    await fs.writeFile(dest(HOUSE_A), JSON.stringify([RECORDS[0]]));
    await moveOf()();
    expect(await houses.readJson(dest(HOUSE_A))).toEqual([RECORDS[0]]);
  });

  test('a seat whose owner cannot be resolved serves NO house; the legacy file is untouched', async () => {
    await houses.writeLegacy('security-cso.json', { laneId: 'ghostlane' });
    await houses.writeLegacy('security-threats.json', RECORDS);
    await moveOf()();
    expect(await houses.readJson(houses.legacy('security-threats.json'))).toEqual(RECORDS);
    await expect(fs.access(dest(HOUSE_A))).rejects.toThrow();
    await expect(fs.access(dest(HOUSE_B))).rejects.toThrow();
  });

  test('no seat and an original root naming two owners → no house', async () => {
    await writeOwner(houses.rootA, 'interloper', HOUSE_B);
    await houses.writeLegacy('security-threats.json', RECORDS);
    await moveOf()();
    expect(await houses.readJson(houses.legacy('security-threats.json'))).toEqual(RECORDS);
    await expect(fs.access(dest(HOUSE_A))).rejects.toThrow();
  });

  test('a house that already holds its own record is never overwritten; the legacy stays', async () => {
    await fs.mkdir(path.dirname(dest(HOUSE_A)), { recursive: true });
    await fs.writeFile(dest(HOUSE_A), JSON.stringify([{ id: 'th_own' }]));
    await houses.writeLegacy('security-threats.json', RECORDS);
    await moveOf()();
    expect(await houses.readJson(dest(HOUSE_A))).toEqual([{ id: 'th_own' }]);
    expect(await houses.readJson(houses.legacy('security-threats.json'))).toEqual(RECORDS);
  });

  test('the office houses: seated, or holding records', async () => {
    houses.asHouse(HOUSE_B);
    await csoDesignation.designate(HOUSE_B, 'brio');
    await houses.writeLegacy('security-threats.json', RECORDS);
    await moveOf()();
    expect((await officeHouses('security', 'cso')).sort()).toEqual([HOUSE_A, HOUSE_B].sort());
    expect(await officeHouses('legal', 'clo')).toEqual([]);
  });

  test('pure laws: one owner or none; temp and live never cross', () => {
    expect(soleOwner([HOUSE_A, HOUSE_A.toUpperCase().replace('0X', '0x')])).toBe(HOUSE_A);
    expect(soleOwner([HOUSE_A, HOUSE_B])).toBeNull();
    expect(soleOwner([])).toBeNull();
    expect(sameWorld(houses.legacy('x.json'))).toBe(true);
    expect(sameWorld('/workspace/repos/neuma/data/settings/security-threats.json')).toBe(false);
  });
});
