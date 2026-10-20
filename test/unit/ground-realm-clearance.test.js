/**
 * A HOUSE'S GROUNDS NEVER STAND IN ANOTHER HOUSE'S RECORDS (security seat pen
 * matrix, 2026-10-19). A guest set its house ground — and, once that was shut,
 * its alliances root — to another wallet's realm folder, and the platform
 * wrote its marker and folders there. Both setters now refuse a ground inside
 * another wallet's realm folder, a ground holding the realm, and a ground
 * inside the install's settings, on the path as typed and through a link. The
 * caller's own realm folder, and a realm folder that is no wallet's, stay
 * legal grounds, as they always were.
 *
 * Real setters, a real realm and data root on a temp disk, a real symlink.
 */
import fs from 'fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'path';
import { setRealmRoot, getRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace, loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { setAllianceRoot, loadAllianceRoot } from '../../backend/services/alliance-ground.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const MINE = `0x${'ab'.repeat(20)}`;
const THEIRS = `0x${'cd'.repeat(20)}`;

describe('a house ground and an alliances root stay clear of the realm and the settings', () => {
  let dir, realm, priorRealm, priorData;

  beforeEach(async () => {
    // everything throwaway: the realm is temp, so a temp ground is legal here
    dir = mkdtempSync(path.join(os.tmpdir(), 'ground-realm-'));
    realm = path.join(dir, 'realm');
    await fs.mkdir(path.join(realm, MINE), { recursive: true });
    await fs.mkdir(path.join(realm, THEIRS), { recursive: true });
    priorRealm = getRealmRoot();
    priorData = process.env.NEUMA_DATA_ROOT;
    setRealmRoot(realm);
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
  });

  afterEach(() => {
    setRealmRoot(priorRealm);
    process.env.NEUMA_DATA_ROOT = priorData;
    rmSync(dir, { recursive: true, force: true });
  });

  const SETTERS = [['house ground', setHouseWorkspace, loadHouseWorkspace], ['alliances root', setAllianceRoot, loadAllianceRoot]];

  test.each(SETTERS)('the %s may not stand in another wallet\'s realm folder, and nothing is written there', async (_, set, load) => {
    await expect(set(MINE, path.join(realm, THEIRS))).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
    await expect(set(MINE, path.join(realm, THEIRS, 'deeper'))).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
    expect(existsSync(path.join(realm, THEIRS, 'lane.json'))).toBe(false);
    expect(existsSync(path.join(realm, THEIRS, 'deeper'))).toBe(false);
    expect((await load(MINE)).root).toBeNull();
  });

  test.each(SETTERS)("in a dev checkout, a guest's %s never holds or stands inside the owner's app checkout", async (_, set, load) => {
    await makeInstallOwner(THEIRS);
    // A throwaway checkout stands in for the app's own: if the rule ever
    // fails (or is broken on purpose), the setter writes here, never into
    // the real repository.
    const checkout = path.join(dir, 'parent', 'app-checkout');
    await fs.mkdir(path.join(checkout, 'docs'), { recursive: true });
    const priorApp = process.env.NEUMA_APP_ROOT;
    process.env.NEUMA_APP_ROOT = checkout;
    try {
      await expect(set(MINE, checkout)).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
      await expect(set(MINE, path.join(checkout, 'docs'))).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
      await expect(set(MINE, path.dirname(checkout))).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
      expect(existsSync(path.join(checkout, 'lane.json'))).toBe(false);
      expect(existsSync(path.join(checkout, 'docs', 'lane.json'))).toBe(false);
      expect((await load(MINE)).root).toBeNull();
    } finally {
      if (priorApp === undefined) delete process.env.NEUMA_APP_ROOT; else process.env.NEUMA_APP_ROOT = priorApp;
    }
  });

  test.each(SETTERS)('the %s may not be or hold the realm root', async (_, set) => {
    await expect(set(MINE, realm)).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
    await expect(set(MINE, dir)).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
  });

  test.each(SETTERS)('the %s may not stand in a wallet\'s realm folder that is not yet made', async (_, set) => {
    const unborn = `0x${'ef'.repeat(20)}`;
    await expect(set(MINE, path.join(realm, unborn, 'ground'))).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
    expect(existsSync(path.join(realm, unborn))).toBe(false);
  });

  test.each(SETTERS)('the %s may not reach another wallet\'s realm folder through a link', async (_, set) => {
    const link = path.join(dir, 'innocent');
    await fs.symlink(path.join(realm, THEIRS), link);
    await expect(set(MINE, link)).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
    expect(existsSync(path.join(realm, THEIRS, 'lane.json'))).toBe(false);
  });

  test.each(SETTERS)('the %s may not stand inside the install\'s settings', async (_, set) => {
    await expect(set(MINE, path.join(dir, 'data', 'settings', 'ground'))).rejects.toMatchObject({ code: 'GROUND_REFUSED' });
  });

  test('the house\'s own realm folder, and a realm folder that is no wallet\'s, are still legal grounds', async () => {
    const own = path.join(realm, MINE, 'ground');
    expect((await setHouseWorkspace(MINE, own)).root).toBe(own);
    const loose = path.join(realm, 'ground');
    expect((await setAllianceRoot(MINE, path.join(realm, 'alliances'))).root).toBe(path.join(realm, 'alliances'));
    expect((await setHouseWorkspace(MINE, loose)).root).toBe(loose);
  });

  test('a ground beside the realm, holding neither it nor the settings, is set as before', async () => {
    const ground = path.join(dir, 'grounds', 'house');
    expect((await setHouseWorkspace(MINE, ground)).root).toBe(ground);
    expect((await setAllianceRoot(MINE, path.join(dir, 'grounds', 'alliances'))).root).toBe(path.join(dir, 'grounds', 'alliances'));
  });
});
