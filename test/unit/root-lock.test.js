/**
 * ROOT LOCK — the backend refuses to boot into an empty house.
 *
 * The incident, 2026-07-31: a two-line change repointed the data root, and the
 * settings files holding the operator's workspace / realm / look pointers
 * resolved to a directory that did not exist. The desk came up with no history,
 * no realm, and default colours. NOTHING was deleted — it was all unreachable.
 *
 * The suite stayed green throughout, and would again: every settings spec
 * points at its own temp path, so no test can see where real data lives. That
 * is exactly why this check lives in the BOOT and is proven here on real disk —
 * real directories, real files, real counts, no mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assessRoot, countFiles, readLock, writeLock, checkRoots, enforceRootLock,
  refusalText, lockPath, WATCHED,
} from '../../backend/services/root-lock.js';

let tmp;
const dir = (name, files = []) => {
  const p = path.join(tmp, name);
  fs.mkdirSync(p, { recursive: true });
  files.forEach((f) => fs.writeFileSync(path.join(p, f), '{}'));
  return p;
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-rootlock-'));
  process.env.NEUMA_ROOT_LOCK_PATH = path.join(tmp, 'root-lock.json');
});
afterEach(() => {
  delete process.env.NEUMA_ROOT_LOCK_PATH;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('assessRoot — refuses ONLY when a move loses something', () => {
  it('THE INCIDENT: old root full, new root empty → REFUSE', () => {
    expect(assessRoot('/repo/data/settings', '/home/.neuma/data/settings', { was: 7, now: 0 }))
      .toEqual({ verdict: 'lost', refuse: true });
  });

  it('a first run records and continues — a fresh install must never be blocked', () => {
    expect(assessRoot(null, '/anywhere', { was: 0, now: 0 }).refuse).toBe(false);
    expect(assessRoot(undefined, '/anywhere', { was: 0, now: 0 }).verdict).toBe('first-run');
  });

  it('an unchanged root is silent — this runs on EVERY boot', () => {
    expect(assessRoot('/same', '/same', { was: 7, now: 7 }))
      .toEqual({ verdict: 'unchanged', refuse: false });
  });

  it('a COMPLETED migration passes — the new home already holds the data', () => {
    expect(assessRoot('/old', '/new', { was: 7, now: 7 }))
      .toEqual({ verdict: 'migrated', refuse: false });
    // Even a partial one: something is there, so nothing is out of reach.
    expect(assessRoot('/old', '/new', { was: 7, now: 1 }).refuse).toBe(false);
  });

  it('moving away from an ALREADY EMPTY root loses nothing', () => {
    expect(assessRoot('/old', '/new', { was: 0, now: 0 }))
      .toEqual({ verdict: 'empty-move', refuse: false });
  });

  it('A GUARD THAT CRIES WOLF GETS DISABLED — only one of five cases refuses', () => {
    const cases = [
      assessRoot(null, '/n', { was: 0, now: 0 }),
      assessRoot('/s', '/s', { was: 9, now: 9 }),
      assessRoot('/o', '/n', { was: 9, now: 9 }),
      assessRoot('/o', '/n', { was: 0, now: 0 }),
      assessRoot('/o', '/n', { was: 9, now: 0 }),
    ];
    expect(cases.filter((c) => c.refuse)).toHaveLength(1);
  });
});

describe('countFiles — on real disk', () => {
  it('counts files, walking into subdirectories', () => {
    const root = dir('settings', ['a.json', 'b.json']);
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'nested', 'c.json'), '{}');
    expect(countFiles(root)).toBe(3);
  });

  it('a missing directory is zero, not a throw — that is the whole failure mode', () => {
    expect(countFiles(path.join(tmp, 'does-not-exist'))).toBe(0);
    expect(countFiles('')).toBe(0);
  });

  it('is BOUNDED — it runs on every boot and must never become a disk walk', () => {
    const root = dir('big', []);
    for (let i = 0; i < 60; i += 1) fs.writeFileSync(path.join(root, `f${i}`), 'x');
    expect(countFiles(root, { cap: 10 })).toBe(10);
    // Depth-bounded too: a file below the limit is not counted.
    const deep = path.join(root, 'a', 'b', 'c', 'd');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'deep.json'), '{}');
    expect(countFiles(root, { maxDepth: 1, cap: 500 })).toBe(60);
  });
});

describe('the lock file', () => {
  it('round-trips the roots it recorded', () => {
    expect(writeLock({ settings: '/a', vault: '/b' })).toBe(true);
    expect(readLock()).toEqual({ settings: '/a', vault: '/b' });
  });

  it('an ABSENT or CORRUPT lock reads as a first run, never as a refusal', () => {
    expect(readLock()).toEqual({});
    fs.writeFileSync(lockPath(), 'not json at all');
    expect(readLock()).toEqual({});
    fs.writeFileSync(lockPath(), '{"roots":"wrong shape"}');
    expect(readLock()).toEqual({});
  });

  it('is anchored OUTSIDE the roots it watches', () => {
    // A lock stored under the data root would move with it and silently forget
    // — the exact failure it exists to catch.
    delete process.env.NEUMA_ROOT_LOCK_PATH;
    expect(lockPath()).toBe(path.join(os.homedir(), '.neuma', 'root-lock.json'));
  });
});

describe('THE BOOT GATE, replaying the real incident', () => {
  it('REFUSES the exact 2026-07-31 move, and says what is at each end', () => {
    // The operator's real settings dir, with the three pointers that were lost.
    const oldSettings = dir('repo-data-settings', ['workspace.json', 'user-realm.json', 'look.json']);
    const oldVault = dir('repo-vault', ['dna.json']);
    writeLock({ settings: oldSettings, vault: oldVault });

    // ...and the empty home the refactor pointed at.
    const newSettings = path.join(tmp, 'home-neuma-data-settings');
    const { refusals } = checkRoots({ settings: newSettings, vault: oldVault });

    expect(refusals).toHaveLength(1);
    expect(refusals[0].key).toBe('settings');
    expect(refusals[0].files).toEqual({ was: 3, now: 0 });
    // The message names BOTH ends and both counts — "refusing to boot" without
    // them is just another mystery.
    expect(refusals[0].text).toContain(oldSettings);
    expect(refusals[0].text).toContain(newSettings);
    expect(refusals[0].text).toMatch(/3 files/);
    expect(refusals[0].text).toMatch(/nothing has been deleted/i);
  });

  it('STOPS THE BOOT — it exits rather than coming up with an empty house', () => {
    const oldSettings = dir('full', ['workspace.json']);
    writeLock({ settings: oldSettings, vault: dir('v', ['x']) });
    const said = [];
    let code = null;
    const ok = enforceRootLock(
      { settings: path.join(tmp, 'empty'), vault: dir('v', ['x']) },
      { log: { error: (m) => said.push(m) }, exit: (c) => { code = c; } },
    );
    expect(ok).toBe(false);
    expect(code).toBe(1);
    expect(said.join(' ')).toMatch(/ROOT LOCK/);
  });

  it('a first boot records the roots and continues', () => {
    const settings = dir('s', ['workspace.json']);
    const vault = dir('v', ['dna.json']);
    let code = null;
    const ok = enforceRootLock({ settings, vault }, { log: { error: () => {} }, exit: (c) => { code = c; } });
    expect(ok).toBe(true);
    expect(code).toBeNull();
    expect(readLock()).toEqual({ settings, vault });
  });

  it('THE ORDINARY BOOT IS SILENT, over and over', () => {
    const settings = dir('s', ['workspace.json']);
    const vault = dir('v', ['dna.json']);
    const said = [];
    const io = { log: { error: (m) => said.push(m) }, exit: () => { throw new Error('must not exit'); } };
    for (let i = 0; i < 5; i += 1) {
      expect(enforceRootLock({ settings, vault }, io)).toBe(true);
    }
    expect(said).toEqual([]);
  });

  it('a MIGRATED root updates the lock and lets the boot through', () => {
    const oldSettings = dir('old', ['workspace.json']);
    writeLock({ settings: oldSettings, vault: dir('v', ['x']) });
    const newSettings = dir('new', ['workspace.json']); // the migration happened
    const vault = dir('v', ['x']);
    expect(enforceRootLock({ settings: newSettings, vault }, {
      log: { error: () => { throw new Error('must not refuse'); } },
    })).toBe(true);
    expect(readLock().settings).toBe(newSettings);
  });

  it('watches the INFRASTRUCTURE roots, and not the operator’s own', () => {
    // The workspace root is the operator's to repoint in preflight, and the new
    // one is legitimately empty when they do. Guarding it would break a real
    // flow to prevent an imaginary one.
    expect(WATCHED).toEqual(['settings', 'vault']);
    writeLock({ settings: dir('s', ['a']), vault: dir('v', ['b']), workspaces: dir('w', ['c']) });
    const { refusals } = checkRoots({
      settings: dir('s', ['a']), vault: dir('v', ['b']), workspaces: path.join(tmp, 'brand-new-house'),
    });
    expect(refusals).toEqual([]);
  });

  it('a root we cannot resolve is skipped, never guessed at', () => {
    writeLock({ settings: dir('s', ['a']), vault: dir('v', ['b']) });
    const { refusals } = checkRoots({ settings: null, vault: undefined });
    expect(refusals).toEqual([]);
  });
});

describe('refusalText', () => {
  it('reads as one sentence an operator can act on', () => {
    const t = refusalText('settings', '/old', '/new', { was: 1, now: 0 });
    expect(t).toMatch(/SETTINGS root moved/);
    expect(t).toMatch(/1 file\b/);       // singular, not "1 files"
    expect(t).toMatch(/REFUSING TO BOOT/);
  });
});
