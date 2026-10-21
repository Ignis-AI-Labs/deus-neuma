/**
 * THE SERVED HOUSES (house-served.js, ruling 2026-10-16: two houses are
 * never confused by the system, at any level) — real
 * grounds on real temp disk, real owner.json records, no seam. The shapes
 * are the live box's: two houses holding the same lane id, a ghost lane a
 * foreign process grew (a journal and no owner), and a guest wallet that
 * manifested a witness beside the house.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  readServed, servedWallet, laneHouse, houseWallet, servedHouses, servesWallet, servesLane,
} from '../../backend/services/house-served.js';

const ADA = `0x${'8a'.repeat(20)}`;
const CLAUDE = `0x${'43'.repeat(20)}`;
const GUEST = `0x${'6b'.repeat(20)}`;

const lane = async (ground, laneId, wallet) => {
  const dir = path.join(ground, laneId);
  await fs.mkdir(dir, { recursive: true });
  if (wallet) await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ wallet, claimedAt: 1 }));
  return dir;
};

describe('which houses a backend serves', () => {
  let base, ada, claude, saved;

  beforeEach(async () => {
    base = await createTempDir('house-served');
    ada = { root: path.join(base, 'brookmere'), witnesses: path.join(base, 'keeper-witnesses') };
    claude = { root: path.join(base, 'thornfield'), witnesses: path.join(base, 'claude-witnesses') };
    await lane(ada.root, 'poplar', ADA);
    await lane(ada.root, 'hazel', ADA.toUpperCase().replace('0X', '0x')); // a mixed-case owner record keys the same house
    await lane(ada.witnesses, 'witness-openai-Sedge', GUEST);
    await lane(claude.root, 'hazel', CLAUDE);
    await lane(claude.root, 'cedar', CLAUDE);
    const ghost = await lane(claude.root, 'poplar', null); // the live leak's shape
    await fs.mkdir(path.join(ghost, 'journal'), { recursive: true });
    // The house's shared ground carries a kind marker and an owner wallet that is no being's.
    await lane(claude.root, 'house', GUEST);
    await fs.writeFile(path.join(claude.root, 'house', 'lane.json'), JSON.stringify({ kind: 'house-ground' }));
    saved = { WORKSPACES_ROOT: process.env.WORKSPACES_ROOT, WITNESSES_ROOT: process.env.WITNESSES_ROOT };
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('a house is served by the owners of being lanes on its grounds — never a ghost lane, never a guest witness', async () => {
    const served = await readServed([claude]);
    expect(served.houses).toEqual([CLAUDE]);
    expect(laneHouse(served, 'hazel')).toBe(CLAUDE);
    expect(laneHouse(served, 'poplar')).toBeNull(); // the ghost: a directory, no owner, no house

    const adaServed = await readServed([ada]);
    expect(adaServed.houses).toEqual([ADA]); // the guest who manifested Sedge is not a house here
    expect(servedWallet(adaServed, GUEST)).toBe(false);
    expect(laneHouse(adaServed, 'witness-openai-Sedge')).toBeNull();
    expect(laneHouse(adaServed, 'hazel')).toBe(ADA);
  });

  test('a record that names its house is held to it: the same lane id under another house is not this one', async () => {
    const served = await readServed([claude]);
    expect(laneHouse(served, 'hazel', CLAUDE)).toBe(CLAUDE);
    expect(laneHouse(served, 'hazel', ADA)).toBeNull(); // Ada's hazel is not on Claude's grounds
    expect(laneHouse(served, 'hazel', CLAUDE.toUpperCase().replace('0X', '0x'))).toBe(CLAUDE);
    expect(servedWallet(served, ADA)).toBe(false);
    expect(servedWallet(served, 'test')).toBe(false);
  });

  test('judged over both houses\' grounds at once, a bare id two houses hold names neither — never a guess', async () => {
    const both = await readServed([ada, claude]);
    expect(both.houses).toEqual([CLAUDE, ADA].sort());
    expect(laneHouse(both, 'hazel')).toBeNull(); // ambiguous — never a guess
    expect(laneHouse(both, 'hazel', ADA)).toBe(ADA);
    expect(laneHouse(both, 'hazel', CLAUDE)).toBe(CLAUDE);
    expect(laneHouse(both, 'cedar')).toBe(CLAUDE);
    expect(laneHouse(both, 'poplar')).toBe(ADA); // only one house OWNS an poplar; the ghost owns nothing
  });

  test('the live answers follow this process\'s own root (the env door the engine reads)', async () => {
    process.env.WORKSPACES_ROOT = claude.root;
    process.env.WITNESSES_ROOT = claude.witnesses;
    expect(await servedHouses()).toEqual([CLAUDE]);
    expect(await servesWallet(CLAUDE)).toBe(true);
    expect(await servesWallet(ADA)).toBe(false);
    expect(await servesLane('hazel')).toBe(CLAUDE);
    expect(await servesLane('poplar')).toBeNull();
    expect(await servesLane('../hazel')).toBeNull();
  });

  test('houseWallet keys a house the one way: lower-cased, or no house at all', () => {
    expect(houseWallet(ADA.toUpperCase().replace('0X', '0x'))).toBe(ADA);
    expect(houseWallet('0xW')).toBeNull();
    expect(houseWallet(null)).toBeNull();
  });
});
