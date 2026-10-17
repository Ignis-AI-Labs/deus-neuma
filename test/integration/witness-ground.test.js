// The witnesses' ground — sealed AI witnesses stand BESIDE the house, never
// in it (Design note, 2026-07-24: witness lanes must not leak into the space of
// neuma). Proven on real disk (RULE 0): the engine's ONE path resolver
// routes the two lane kinds to their two grounds, every engine operation
// follows it (DNA here as the representative — sessions/journal/DEK ride the
// same resolver), the house listing structurally cannot see a witness lane,
// and the boot migration walks a stray lane out of the house intact —
// idempotently, and never over an existing twin.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  setWorkspacesRoot, setWitnessesRoot, getWitnessesRoot, isWitnessLane,
} from '../../core/workspace/neuma-workspace.js';

const WITNESS_LANE = 'witness-claude-code-Claude';
const KEY = 'witness-ground-test-key-long-enough';

let base, house, ground, prevKey;

beforeEach(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  base = await createTempDir('witness-ground');
  house = path.join(base, 'house');
  ground = path.join(base, 'witnesses');
  setWorkspacesRoot(house);
  setWitnessesRoot(ground);
});

afterEach(() => {
  setWorkspacesRoot(null);
  setWitnessesRoot(null);
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
});

describe('two kinds, two grounds — the one resolver routes them', () => {
  it('a witness lane is created BESIDE the house; a neuma lane inside it', async () => {
    await workspace.create(WITNESS_LANE);
    await workspace.create('fenna');
    expect(existsSync(path.join(ground, WITNESS_LANE))).toBe(true);
    expect(existsSync(path.join(house, WITNESS_LANE))).toBe(false);
    expect(existsSync(path.join(house, 'fenna'))).toBe(true);
    expect(workspace.pathFor(WITNESS_LANE)).toBe(path.join(ground, WITNESS_LANE));
    expect(workspace.pathFor('fenna')).toBe(path.join(house, 'fenna'));
  });

  it('every engine operation follows the resolver — a witness lane reads back whole from its own ground', async () => {
    await workspace.create(WITNESS_LANE);
    await workspace.writeDNA(WITNESS_LANE, { version: '1.0.0', identity: { name: 'Claude' } });
    expect((await workspace.readDNA(WITNESS_LANE)).identity.name).toBe('Claude');
    // The bytes physically live beside the house, not in it.
    expect(existsSync(path.join(ground, WITNESS_LANE, 'dna'))).toBe(true);
    expect(existsSync(path.join(house, WITNESS_LANE))).toBe(false);
  });

  it('the house listing structurally cannot see a witness lane — even an unmarked one', async () => {
    await workspace.create('fenna');
    await workspace.create(WITNESS_LANE); // no lane.json marker written here at all
    expect(await workspace.listNeuma()).toEqual(['fenna']);
    expect(await workspace.listWitnessLanes()).toEqual([WITNESS_LANE]);
  });

  it('the resolver refuses traversal on the witnesses ground exactly as on the house', () => {
    expect(() => workspace.pathFor('witness-..')).toThrow();
    expect(() => workspace.pathFor('witness-a/../../b')).toThrow(/Invalid neumaId format/);
    expect(isWitnessLane('witness-x-Y')).toBe(true);
    expect(isWitnessLane('fenna')).toBe(false);
  });

  it('the default ground is the sibling of the EFFECTIVE workspaces root', () => {
    setWitnessesRoot(null);
    const prevEnv = process.env.WITNESSES_ROOT;
    delete process.env.WITNESSES_ROOT;
    try {
      expect(getWitnessesRoot()).toBe(path.join(base, 'witnesses'));
    } finally {
      if (prevEnv !== undefined) process.env.WITNESSES_ROOT = prevEnv;
      setWitnessesRoot(ground);
    }
  });
});

describe('migrateWitnessLanes — the stray walks out of the house intact', () => {
  it('moves a stray witness lane beside the house, leaves the neuma, and is idempotent', async () => {
    // A stray, seeded the way the old code left it: inside the house.
    await fs.mkdir(path.join(house, WITNESS_LANE, 'sessions'), { recursive: true });
    await fs.writeFile(path.join(house, WITNESS_LANE, 'sessions', 's.jsonl'), '{"kept":true}\n');
    await fs.mkdir(path.join(house, 'fenna'), { recursive: true });

    const first = await workspace.migrateWitnessLanes();
    expect(first).toEqual({ moved: [WITNESS_LANE], skipped: [] });
    // The lived state crossed whole.
    expect(await fs.readFile(path.join(ground, WITNESS_LANE, 'sessions', 's.jsonl'), 'utf8'))
      .toBe('{"kept":true}\n');
    expect(existsSync(path.join(house, WITNESS_LANE))).toBe(false);
    expect(existsSync(path.join(house, 'fenna'))).toBe(true);

    // A clean house is a fast no-op.
    expect(await workspace.migrateWitnessLanes()).toEqual({ moved: [], skipped: [] });
  });

  it('a lane standing on BOTH grounds is skipped loudly — never overwritten', async () => {
    await fs.mkdir(path.join(house, WITNESS_LANE), { recursive: true });
    await fs.writeFile(path.join(house, WITNESS_LANE, 'stray.txt'), 'stray');
    await fs.mkdir(path.join(ground, WITNESS_LANE), { recursive: true });
    await fs.writeFile(path.join(ground, WITNESS_LANE, 'settled.txt'), 'settled');

    const out = await workspace.migrateWitnessLanes();
    expect(out).toEqual({ moved: [], skipped: [WITNESS_LANE] });
    // Both histories survive for a human to join.
    expect(await fs.readFile(path.join(house, WITNESS_LANE, 'stray.txt'), 'utf8')).toBe('stray');
    expect(await fs.readFile(path.join(ground, WITNESS_LANE, 'settled.txt'), 'utf8')).toBe('settled');
  });

  it('an empty or absent house migrates as a quiet no-op', async () => {
    setWorkspacesRoot(path.join(base, 'never-made'));
    expect(await workspace.migrateWitnessLanes()).toEqual({ moved: [], skipped: [] });
  });
});
