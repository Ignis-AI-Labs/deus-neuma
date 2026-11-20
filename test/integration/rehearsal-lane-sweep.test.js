// ENG-014 (#143) — a rehearsal (test) birth's lane returns to the void at
// ceremony end; a real being's lane can NEVER be swept. Audit P6-69: the sweep
// deletes only a directory the platform's own claim proves it made for a
// rehearsal, never a path a checkpoint file names. REAL workspace on REAL
// disk (temp directories only), no mock on any claimed path (RULE 0).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepRehearsalLane, sweepExpiredRehearsals } from '../../core/birth/rehearsal-sweep.js';
import { claimRehearsalLane, readRehearsalClaim } from '../../core/birth/rehearsal-claim.js';
import { birthSessionPath, TEST_SESSION_TTL_MS, REAL_SESSION_TTL_MS } from '../../core/birth/birth-session-store.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const refusals = [];
const log = { info: () => {}, warn: (msg) => { refusals.push(msg); } };
const origRoot = getWorkspacesRoot();
const ID = { a: 'a'.repeat(32), b: 'b'.repeat(32), c: 'c'.repeat(32), d: 'd'.repeat(32) };

let root;
let prevData;

beforeEach(async () => {
  refusals.length = 0;
  root = await createTempDir('rehearsal-sweep');
  setWorkspacesRoot(root);
  prevData = process.env.NEUMA_DATA_ROOT;
  process.env.NEUMA_DATA_ROOT = await createTempDir('rehearsal-sweep-data');
});

afterEach(() => {
  if (prevData === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = prevData;
  setWorkspacesRoot(origRoot);
});

/** A rehearsal session as the ceremony holds it before its lane is made. */
const rehearsal = (id, neumaId, isTest = true) => ({ id, isTest, data: { neumaId } });

/** The ceremony's own two steps: the platform's claim on a fresh directory, then the scaffold. */
const walk = async (id, neumaId) => {
  const session = rehearsal(id, neumaId);
  await claimRehearsalLane(session, workspace);
  await workspace.create(neumaId);
  return session;
};

/** A lane that stands in the house with something worth keeping in keys/ and dna/. */
const standingLane = async (neumaId) => {
  await workspace.create(neumaId);
  const lane = path.join(root, neumaId);
  await fs.writeFile(path.join(lane, 'keys', 'lp-wallet.json'), '{"held":true}');
  await fs.writeFile(path.join(lane, 'dna', 'genesis.md'), '# authored');
  return lane;
};

const checkpoint = async (sessionId, session, ageMs) => {
  const file = birthSessionPath(sessionId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ ...session, persistedAt: Date.now() - ageMs }));
  return file;
};

describe('rehearsal lane sweep (ENG-014, real disk, no mock)', () => {
  it('removes a rehearsal lane this session created, and drops its claim', async () => {
    const session = await walk(ID.a, 'astra-test');
    const lane = path.join(root, 'astra-test');
    expect(session.data.rehearsalLane).toBe('astra-test');
    expect(existsSync(path.join(lane, 'dna'))).toBe(true);

    expect(await sweepRehearsalLane(session, workspace, log)).toBe(true);

    expect(existsSync(lane)).toBe(false);
    expect(await readRehearsalClaim(ID.a)).toBeNull();
  });

  it('refuses for a NON-test session even when a claim and the flags otherwise match', async () => {
    const session = await walk(ID.a, 'real-being');
    session.isTest = false;
    expect(await sweepRehearsalLane(session, workspace, log)).toBe(false);
    expect(existsSync(path.join(root, 'real-being'))).toBe(true);
  });

  it('refuses when the session did not record creating the lane', async () => {
    const session = await walk(ID.a, 'preexisting');
    session.data.rehearsalLane = null;
    expect(await sweepRehearsalLane(session, workspace, log)).toBe(false);
    expect(existsSync(path.join(root, 'preexisting'))).toBe(true);
  });

  it('refuses a CLAIMED lane and a CRYSTALLIZED being, whatever the session and the claim say', async () => {
    const owned = await walk(ID.a, 'owned');
    await fs.writeFile(path.join(root, 'owned', 'owner.json'), '{"wallet":"0xabc"}');
    const crystallized = await walk(ID.b, 'crystallized');
    await fs.writeFile(path.join(root, 'crystallized', 'dna', 'active.json'), '{"sealed":true}');

    expect(await sweepRehearsalLane(owned, workspace, log)).toBe(false);
    expect(await sweepRehearsalLane(crystallized, workspace, log)).toBe(false);

    expect(existsSync(path.join(root, 'owned', 'owner.json'))).toBe(true);
    expect(existsSync(path.join(root, 'crystallized', 'dna', 'active.json'))).toBe(true);
    expect(refusals.join(' | ')).toMatch(/claimed by an owner.*crystallized being/);
  });

  it('a rehearsal never claims a lane that already stands, so it can never sweep one', async () => {
    const lane = await standingLane('kin');
    const session = rehearsal(ID.a, 'kin');

    await expect(claimRehearsalLane(session, workspace)).rejects.toThrow(/already stands/);

    expect(session.data.rehearsalLane).toBeUndefined();
    expect(await readRehearsalClaim(ID.a)).toBeNull();
    session.data.rehearsalLane = 'kin';
    expect(await sweepRehearsalLane(session, workspace, log)).toBe(false);
    expect(existsSync(path.join(lane, 'keys', 'lp-wallet.json'))).toBe(true);
  });

  it('the same session claiming its own lane again is a no-op; another session cannot take it', async () => {
    const session = await walk(ID.a, 'retry');
    await expect(claimRehearsalLane(session, workspace)).resolves.toBe(path.join(root, 'retry'));
    await expect(claimRehearsalLane(rehearsal(ID.b, 'retry'), workspace)).rejects.toThrow(/already stands/);
  });

  it('refuses a lane the rehearsal made once it is a different directory on disk', async () => {
    const session = await walk(ID.a, 'reborn');
    const lane = path.join(root, 'reborn');
    await fs.rename(lane, path.join(root, 'moved-aside'));
    await standingLane('reborn');

    expect(await sweepRehearsalLane(session, workspace, log)).toBe(false);

    expect(existsSync(path.join(lane, 'keys', 'lp-wallet.json'))).toBe(true);
    expect(refusals.at(-1)).toMatch(/not the one the rehearsal made/);
  });

  it('refuses a traversal-shaped neumaId (the lane is one plain folder of the house)', async () => {
    const outside = await createTempDir('sweep-outside');
    await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');
    const evil = rehearsal(ID.a, `../${path.basename(outside)}`);
    evil.data.rehearsalLane = evil.data.neumaId;

    await expect(claimRehearsalLane(rehearsal(ID.b, evil.data.neumaId), workspace)).rejects.toThrow(/plain lane id/);
    expect(await sweepRehearsalLane(evil, workspace, log)).toBe(false);
    expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true);
  });
});

describe('sweepExpiredRehearsals — an abandoned rehearsal leaves the house (real disk, no mock)', () => {
  const OLD = TEST_SESSION_TTL_MS + 60_000;

  it('sweeps a rehearsal past its life; a rehearsal still walking and every real ceremony stay', async () => {
    const abandoned = await walk(ID.a, 'abandoned');
    const walking = await walk(ID.b, 'walking');
    await workspace.create('real-one');
    const gone = await checkpoint(ID.a, abandoned, OLD);
    const live = await checkpoint(ID.b, walking, 60_000);
    const real = await checkpoint(ID.c, { isTest: false, currentStage: 1, data: { neumaId: 'real-one' } }, REAL_SESSION_TTL_MS + 60_000);

    expect(await sweepExpiredRehearsals(workspace, log)).toBe(1);

    expect(existsSync(path.join(root, 'abandoned'))).toBe(false);
    expect(existsSync(gone)).toBe(false);
    expect(await readRehearsalClaim(ID.a)).toBeNull();
    expect(existsSync(path.join(root, 'walking'))).toBe(true);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(path.join(root, 'real-one'))).toBe(true);
    expect(existsSync(real)).toBe(true);
  });

  it('P6-69: forged checkpoints naming another lane, its keys/ and dna/, or the house ground delete nothing', async () => {
    const victim = await standingLane('victim');
    const ground = path.join(root, 'house-ground');
    await fs.mkdir(ground);
    await fs.writeFile(path.join(ground, 'plan.md'), '# the house plan');
    // A real rehearsal walks beside them, so a live claim exists for a forger to borrow.
    const honest = await walk(ID.d, 'honest');
    const forged = (neumaId, extra = {}) => ({ isTest: true, ...extra, data: { neumaId, rehearsalLane: neumaId } });
    const files = [
      await checkpoint(ID.a, forged('victim/keys'), OLD),
      await checkpoint(ID.b, forged('victim/dna', { id: ID.d }), OLD),
      await checkpoint(ID.c, forged('house-ground', { id: ID.d }), OLD),
      await checkpoint('e'.repeat(32), forged('victim'), OLD),
    ];

    expect(await sweepExpiredRehearsals(workspace, log)).toBe(0);

    expect(await fs.readFile(path.join(victim, 'keys', 'lp-wallet.json'), 'utf8')).toBe('{"held":true}');
    expect(await fs.readFile(path.join(victim, 'dna', 'genesis.md'), 'utf8')).toBe('# authored');
    expect(await fs.readFile(path.join(ground, 'plan.md'), 'utf8')).toBe('# the house plan');
    expect(existsSync(path.join(root, 'honest'))).toBe(true);
    expect(await readRehearsalClaim(ID.d)).toMatchObject({ neumaId: honest.data.neumaId });
    for (const file of files) expect(existsSync(file)).toBe(false);
  });

  it('P6-69: a forged checkpoint filed under a live rehearsal\'s own id cannot aim its claim at another lane', async () => {
    const victim = await standingLane('victim');
    await walk(ID.a, 'honest');
    await checkpoint(ID.a, { isTest: true, data: { neumaId: 'victim', rehearsalLane: 'victim' } }, OLD);

    expect(await sweepExpiredRehearsals(workspace, log)).toBe(0);

    expect(existsSync(path.join(victim, 'keys', 'lp-wallet.json'))).toBe(true);
    expect(existsSync(path.join(root, 'honest'))).toBe(true);
  });
});
