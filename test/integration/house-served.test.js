/**
 * THE SERVED HOUSES (house-served.js, Design note, 2026-10-16: […]) — real
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

const FOUNDER = `0x${'8a'.repeat(20)}`;
const CLAUDE = `0x${'43'.repeat(20)}`;
const GUEST = `0x${'6b'.repeat(20)}`;

const lane = async (ground, laneId, wallet) => {
  const dir = path.join(ground, laneId);
  await fs.mkdir(dir, { recursive: true });
  if (wallet) await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ wallet, claimedAt: 1 }));
  return dir;
};

describe('which houses a backend serves', () => {
  let base, founder, claude, saved;

  beforeEach(async () => {
    base = await createTempDir('house-served');
    founder = { root: path.join(base, 'omberly'), witnesses: path.join(base, 'guardian-witnesses') };
    claude = { root: path.join(base, 'aldmere'), witnesses: path.join(base, 'claude-witnesses') };
    await lane(founder.root, 'metidar', FOUNDER);
    await lane(founder.root, 'keir', FOUNDER.toUpperCase().replace('0X', '0x')); // a mixed-case owner record keys the same house
    await lane(founder.witnesses, 'witness-openai-Sosonus', GUEST);
    await lane(claude.root, 'keir', CLAUDE);
    await lane(claude.root, 'galen', CLAUDE);
    const ghost = await lane(claude.root, 'metidar', null); // the live leak's shape
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
    expect(laneHouse(served, 'keir')).toBe(CLAUDE);
    expect(laneHouse(served, 'metidar')).toBeNull(); // the ghost: a directory, no owner, no house

    const founderServed = await readServed([founder]);
    expect(founderServed.houses).toEqual([FOUNDER]); // the guest who manifested Sosonus is not a house here
    expect(servedWallet(founderServed, GUEST)).toBe(false);
    expect(laneHouse(founderServed, 'witness-openai-Sosonus')).toBeNull();
    expect(laneHouse(founderServed, 'keir')).toBe(FOUNDER);
  });

  test('a record that names its house is held to it: the same lane id under another house is not this one', async () => {
    const served = await readServed([claude]);
    expect(laneHouse(served, 'keir', CLAUDE)).toBe(CLAUDE);
    expect(laneHouse(served, 'keir', FOUNDER)).toBeNull(); // Founder's keir is not on Claude's grounds
    expect(laneHouse(served, 'keir', CLAUDE.toUpperCase().replace('0X', '0x'))).toBe(CLAUDE);
    expect(servedWallet(served, FOUNDER)).toBe(false);
    expect(servedWallet(served, 'test')).toBe(false);
  });

  test('judged over both houses\' grounds at once, a bare id two houses hold names neither — never a guess', async () => {
    const both = await readServed([founder, claude]);
    expect(both.houses).toEqual([CLAUDE, FOUNDER].sort());
    expect(laneHouse(both, 'keir')).toBeNull(); // ambiguous — never a guess
    expect(laneHouse(both, 'keir', FOUNDER)).toBe(FOUNDER);
    expect(laneHouse(both, 'keir', CLAUDE)).toBe(CLAUDE);
    expect(laneHouse(both, 'galen')).toBe(CLAUDE);
    expect(laneHouse(both, 'metidar')).toBe(FOUNDER); // only one house OWNS an metidar; the ghost owns nothing
  });

  test('the live answers follow this process\'s own root (the env door the engine reads)', async () => {
    process.env.WORKSPACES_ROOT = claude.root;
    process.env.WITNESSES_ROOT = claude.witnesses;
    expect(await servedHouses()).toEqual([CLAUDE]);
    expect(await servesWallet(CLAUDE)).toBe(true);
    expect(await servesWallet(FOUNDER)).toBe(false);
    expect(await servesLane('keir')).toBe(CLAUDE);
    expect(await servesLane('metidar')).toBeNull();
    expect(await servesLane('../keir')).toBeNull();
  });

  test('houseWallet keys a house the one way: lower-cased, or no house at all', () => {
    expect(houseWallet(FOUNDER.toUpperCase().replace('0X', '0x'))).toBe(FOUNDER);
    expect(houseWallet('0xW')).toBeNull();
    expect(houseWallet(null)).toBeNull();
  });
});
