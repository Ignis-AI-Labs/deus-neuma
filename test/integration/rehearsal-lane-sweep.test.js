// ENG-014 (#143) — a rehearsal (test) birth's lane returns to the void at
// ceremony end; a real being's lane can NEVER be swept. REAL workspace on
// REAL disk, no mock on any claimed path (RULE 0).
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepRehearsalLane, sweepExpiredRehearsals } from '../../core/birth/rehearsal-sweep.js';
import { birthSessionPath, TEST_SESSION_TTL_MS, REAL_SESSION_TTL_MS } from '../../core/birth/birth-session-store.js';
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

describe('sweepExpiredRehearsals — an abandoned rehearsal leaves the house (real disk, no mock)', () => {
  let root;
  let prevData;

  beforeEach(async () => {
    root = await createTempDir('expired-sweep');
    setWorkspacesRoot(root);
    prevData = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = await createTempDir('expired-sweep-data');
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevData;
    setWorkspacesRoot(origRoot);
  });

  const checkpoint = async (sessionId, session, ageMs) => {
    const file = birthSessionPath(sessionId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ ...session, persistedAt: Date.now() - ageMs }));
    return file;
  };

  it('sweeps a rehearsal past its life; a rehearsal still walking and every real ceremony stay', async () => {
    for (const lane of ['abandoned', 'walking', 'real-one']) await workspace.create(lane);
    const gone = await checkpoint('a'.repeat(32), { isTest: true, data: { neumaId: 'abandoned', rehearsalLane: 'abandoned' } }, TEST_SESSION_TTL_MS + 60_000);
    const live = await checkpoint('b'.repeat(32), { isTest: true, data: { neumaId: 'walking', rehearsalLane: 'walking' } }, 60_000);
    const real = await checkpoint('c'.repeat(32), { isTest: false, currentStage: 1, data: { neumaId: 'real-one' } }, REAL_SESSION_TTL_MS + 60_000);

    expect(await sweepExpiredRehearsals(workspace, log)).toBe(1);

    expect(existsSync(path.join(root, 'abandoned'))).toBe(false);
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(path.join(root, 'walking'))).toBe(true);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(path.join(root, 'real-one'))).toBe(true);
    expect(existsSync(real)).toBe(true);
  });
});
