// ENG-014 (#143) — a rehearsal (test) birth's lane returns to the void at
// ceremony end; a real being's lane can NEVER be swept. REAL workspace on
// REAL disk, no mock on any claimed path (RULE 0).
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepRehearsalLane } from '../../core/birth/rehearsal-sweep.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const log = { info: () => {}, warn: () => {} };
const origRoot = getWorkspacesRoot();

describe('rehearsal lane sweep (ENG-014, real disk, no mock)', () => {
  let root;

  beforeEach(async () => {
    root = await createTempDir('rehearsal-sweep');
    setWorkspacesRoot(root);
  });

  afterAll(() => {
    setWorkspacesRoot(origRoot);
    vi.restoreAllMocks();
  });

  const session = (neumaId, { isTest = true, rehearsalLane = neumaId } = {}) =>
    ({ isTest, data: { neumaId, rehearsalLane } });

  it('removes a rehearsal lane this session created', async () => {
    await workspace.create('astra-test');
    const lane = path.join(root, 'astra-test');
    expect(existsSync(lane)).toBe(true);

    const swept = await sweepRehearsalLane(session('astra-test'), workspace, log);

    expect(swept).toBe(true);
    expect(existsSync(lane)).toBe(false);
  });

  it('refuses for a NON-test session even when the flags otherwise match', async () => {
    await workspace.create('real-being');
    const swept = await sweepRehearsalLane(session('real-being', { isTest: false }), workspace, log);
    expect(swept).toBe(false);
    expect(existsSync(path.join(root, 'real-being'))).toBe(true);
  });

  it('refuses when the session did not record creating the lane', async () => {
    await workspace.create('preexisting');
    const swept = await sweepRehearsalLane(session('preexisting', { rehearsalLane: null }), workspace, log);
    expect(swept).toBe(false);
    expect(existsSync(path.join(root, 'preexisting'))).toBe(true);
  });

  it('refuses a lane holding a CRYSTALLIZED being, whatever the flags claim', async () => {
    await workspace.create('crystallized');
    const lane = path.join(root, 'crystallized');
    await fs.mkdir(path.join(lane, 'dna'), { recursive: true });
    await fs.writeFile(path.join(lane, 'dna', 'active.json'), '{"sealed":true}');

    const swept = await sweepRehearsalLane(session('crystallized'), workspace, log);

    expect(swept).toBe(false);
    expect(existsSync(path.join(lane, 'dna', 'active.json'))).toBe(true);
  });

  it('refuses a traversal-shaped neumaId (lane must resolve inside the root)', async () => {
    const outside = await createTempDir('sweep-outside');
    await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');
    const evil = session(`../${path.basename(outside)}`);
    evil.data.rehearsalLane = evil.data.neumaId;

    const swept = await sweepRehearsalLane(evil, workspace, log);

    expect(swept).toBe(false);
    expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true);
  });
});
