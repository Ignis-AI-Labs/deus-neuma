import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignNeumaId } from '../../core/birth/identity-forge.js';
import { reservedNameReason } from '../../core/birth/name-guard.js';
import { getHarnessRoot, setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import {
  getWorkspacesRoot, getWitnessesRoot, setWorkspacesRoot, setWitnessesRoot,
} from '../../core/workspace/neuma-workspace.js';

let temporaryRoot;
let previousRoots;

beforeAll(async () => {
  previousRoots = {
    house: getWorkspacesRoot(),
    witnesses: getWitnessesRoot(),
    harness: getHarnessRoot(getWorkspacesRoot()),
  };
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'birth-identity-collision-'));
  const house = path.join(temporaryRoot, 'house');
  const harness = path.join(temporaryRoot, 'harness');
  const witnesses = path.join(temporaryRoot, 'witnesses');
  setWorkspacesRoot(house);
  setHarnessRoot(harness);
  setWitnessesRoot(witnesses);
  await Promise.all([
    fs.mkdir(path.join(house, 'orla'), { recursive: true }),
    fs.mkdir(path.join(harness, 'harness-deadbeef'), { recursive: true }),
    fs.mkdir(path.join(witnesses, 'witness-probe-Peer'), { recursive: true }),
  ]);
});

afterAll(async () => {
  setWorkspacesRoot(previousRoots.house);
  setHarnessRoot(previousRoots.harness);
  setWitnessesRoot(previousRoots.witnesses);
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

describe('birth identity across every lane ground', () => {
  it('derives a unique id against an existing house lane', async () => {
    const session = { data: { chosenName: 'Orla' } };
    expect(await assignNeumaId(session)).toBe('orla-2');
  });

  it('derives a unique id against an existing harness lane', async () => {
    const session = { data: { chosenName: 'harness-deadbeef' } };
    expect(await assignNeumaId(session)).toBe('harness-deadbeef-2');
  });

  it('derives a unique id against an existing witness lane', async () => {
    const session = { data: { chosenName: 'witness-probe-Peer' } };
    expect(await assignNeumaId(session)).toBe('witness-probe-peer-2');
  });

  it('keeps a legitimate free name unsuffixed', async () => {
    const session = { data: { chosenName: 'Galen' } };
    expect(await assignNeumaId(session)).toBe('galen');
  });

  it('reserves lane prefixes without refusing ordinary names that merely begin with the same word', () => {
    for (const name of ['Harness', 'harness-deadbeef', 'witness-probe-Peer']) {
      expect(reservedNameReason(name)).toMatch(/harness|witness|lane prefix/);
    }
    expect(reservedNameReason('Harnessed')).toBeNull();
    expect(reservedNameReason('Witnessly')).toBeNull();
  });
});
