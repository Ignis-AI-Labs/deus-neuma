// house-workspace.test.js — the house's shared ground, on real disk: a
// temp realm holds the per-wallet record; the workspace roots live under
// the repo (NOT the OS temp dir — the service refuses temp on principle,
// so the fixtures must stand on durable ground too).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setRealmRoot } from '../../backend/services/user-realm.js';
import {
  loadHouseWorkspace, setHouseWorkspace, houseWorkspaceStatus, ensureBeingGround,
  ensureHouseGround, defaultHouseGround,
} from '../../backend/services/house-workspace.js';
import { setAllianceRoot } from '../../backend/services/alliance-ground.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const WALLET = '0x' + '12'.repeat(20);

let realm;
let ground;

beforeEach(() => {
  realm = mkdtempSync(path.join(os.tmpdir(), 'house-ws-realm-'));
  setRealmRoot(realm);
  ground = path.join(process.cwd(), 'test', `.house-ws-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
});

afterEach(() => {
  setRealmRoot(path.join(os.homedir(), '.neuma', 'realm'));
  rmSync(realm, { recursive: true, force: true });
  rmSync(ground, { recursive: true, force: true });
});

describe('house workspace — the shared ground', () => {
  it('reads as unset until the witness sets it', async () => {
    expect(await loadHouseWorkspace(WALLET)).toEqual({ root: null });
    expect(await houseWorkspaceStatus(WALLET)).toEqual({ root: null, repos: [] });
  });

  it('setting the ground creates the root and its repos/ convention, and persists per wallet', async () => {
    const status = await setHouseWorkspace(WALLET, ground);
    expect(status.root).toBe(path.resolve(ground));
    expect(status.repos).toEqual([]);
    expect(existsSync(path.join(ground, 'repos'))).toBe(true);
    // The choice survives a fresh read (the realm record holds it).
    expect((await loadHouseWorkspace(WALLET)).root).toBe(path.resolve(ground));
    // Another wallet sees nothing — the ground is per house.
    expect((await loadHouseWorkspace('0x' + '34'.repeat(20))).root).toBeNull();
  });

  it('status lists the repositories standing under repos/', async () => {
    await setHouseWorkspace(WALLET, ground);
    mkdirSync(path.join(ground, 'repos', 'kenorie'), { recursive: true });
    mkdirSync(path.join(ground, 'repos', 'atlas'), { recursive: true });
    expect((await houseWorkspaceStatus(WALLET)).repos).toEqual(['atlas', 'kenorie']);
  });

  it('refuses a relative path and a temp-dir root — the ground must be durable', async () => {
    await expect(setHouseWorkspace(WALLET, 'relative/ground')).rejects.toThrow(/absolute/);

    // The temp-ground law binds only where the harm exists: a realm that
    // SURVIVES the reboot which sweeps the ground. This suite's own realm is
    // under tmp (a fully isolated stack, where everything is throwaway by
    // design and a tmp ground is legitimate), so the refusal is asserted
    // against a durable realm — the operator's real situation.
    const durableRealm = path.join(process.cwd(), 'test', `.house-ws-durable-realm-${process.pid}`);
    mkdirSync(durableRealm, { recursive: true });
    setRealmRoot(durableRealm);
    try {
      await expect(setHouseWorkspace(WALLET, path.join(os.tmpdir(), 'house-here'))).rejects.toThrow(/temp dir/);
      expect((await loadHouseWorkspace(WALLET)).root).toBeNull();
    } finally {
      setRealmRoot(realm);
      rmSync(durableRealm, { recursive: true, force: true });
    }
  });

  it('ALLOWS a temp ground when the realm is temp too — an isolated stack is all throwaway', async () => {
    // The other half of the same law. Without this, tightening the guard would
    // silently break every isolated test stack that legitimately lives in tmp.
    const tempGround = path.join(os.tmpdir(), `house-ws-isolated-${process.pid}`);
    try {
      await expect(setHouseWorkspace(WALLET, tempGround)).resolves.toBeTruthy();
      expect((await loadHouseWorkspace(WALLET)).root).toBe(tempGround);
    } finally {
      rmSync(tempGround, { recursive: true, force: true });
    }
  });

  it('setting the ground raises the workspaces/ trunk beside repos/', async () => {
    await setHouseWorkspace(WALLET, ground);
    expect(existsSync(path.join(ground, 'workspaces'))).toBe(true);
  });
});

describe('ensureBeingGround — a being\'s working ground on their channel', () => {
  it('raises <root>/workspaces/<neumaId> and returns it, idempotently', async () => {
    await setHouseWorkspace(WALLET, ground);
    const expected = path.join(path.resolve(ground), 'workspaces', 'metidar');
    expect(await ensureBeingGround(WALLET, 'metidar')).toEqual({ path: expected });
    expect(existsSync(expected)).toBe(true);
    // A second raise is a no-op that still answers with the standing ground.
    expect(await ensureBeingGround(WALLET, 'metidar')).toEqual({ path: expected });
  });

  it('no house ground set → { path: null }, and nothing is raised', async () => {
    expect(await ensureBeingGround(WALLET, 'metidar')).toEqual({ path: null });
    expect(existsSync(path.join(ground, 'workspaces'))).toBe(false);
  });

  it('refuses an id that is not one clean path segment — no traversal, ever', async () => {
    await setHouseWorkspace(WALLET, ground);
    for (const bad of ['../evil', 'a/b', 'a\\b', '', '.', 'name with space']) {
      await expect(ensureBeingGround(WALLET, bad)).rejects.toThrow(/Invalid being id/);
    }
    expect(existsSync(path.join(ground, 'workspaces', '..', 'evil'))).toBe(false);
  });
});

describe('one install, two houses — the ground is never shared', () => {
  const HOUSE_A = '0x' + 'a1'.repeat(20);
  const HOUSE_B = '0x' + 'b2'.repeat(20);
  let world;
  let lanes;

  // The realm is tmp, so grounds in tmp are lawful here (an isolated stack).
  beforeEach(() => {
    world = mkdtempSync(path.join(os.tmpdir(), 'house-ws-two-'));
    lanes = path.join(world, 'lanes');
    mkdirSync(path.join(lanes, 'ember'), { recursive: true });
    writeFileSync(path.join(lanes, 'ember', 'owner.json'), JSON.stringify({ wallet: HOUSE_A }));
    setWorkspacesRoot(lanes);
  });
  afterEach(() => {
    setWorkspacesRoot(null);
    rmSync(world, { recursive: true, force: true });
  });

  it('each wallet\'s founding default is its own ground', async () => {
    const a = await ensureHouseGround(HOUSE_A, defaultHouseGround(lanes, HOUSE_A));
    const b = await ensureHouseGround(HOUSE_B, defaultHouseGround(lanes, HOUSE_B));
    expect(a.raised && b.raised).toBe(true);
    expect(a.root).not.toBe(b.root);
    expect(a.root.startsWith(b.root + path.sep) || b.root.startsWith(a.root + path.sep)).toBe(false);
    expect(existsSync(path.join(a.root, 'post'))).toBe(true);
    expect(existsSync(path.join(b.root, 'post'))).toBe(true);
  });

  it('refuses another house\'s ground — the same root, inside it, or holding it — with clear words', async () => {
    const { root: groundA } = await setHouseWorkspace(HOUSE_A, path.join(world, 'house-a'));
    const holdsA = path.join(world, 'everything');
    mkdirSync(holdsA, { recursive: true });
    const { root: movedA } = await setHouseWorkspace(HOUSE_A, path.join(holdsA, 'house-a'));
    for (const root of [movedA, path.join(movedA, 'repos', 'x'), holdsA]) {
      await expect(setHouseWorkspace(HOUSE_B, root)).rejects.toThrow(/another house/);
    }
    expect((await loadHouseWorkspace(HOUSE_B)).root).toBeNull();
    expect(existsSync(path.join(holdsA, 'repos'))).toBe(false);
    // A house may still re-set its own ground; the old one is no longer recorded.
    expect((await setHouseWorkspace(HOUSE_A, groundA)).root).toBe(groundA);
  });

  it('refuses a ground inside another house\'s alliances root', async () => {
    const shared = path.join(world, 'alliances-b');
    await setAllianceRoot(HOUSE_B, shared);
    await expect(setHouseWorkspace(HOUSE_A, path.join(shared, 'mine'))).rejects.toThrow(/alliances root of another house/);
  });

  it('refuses a ground that holds the lanes, or stands inside one — nothing is raised', async () => {
    const refusals = [
      [lanes, /holds the beings' lanes/],
      [world, /holds the beings' lanes/],
      [path.join(world, 'witnesses'), /holds the witnesses' lanes/],
      [path.join(world, 'harness', 'harness-a1a1a1a1', 'work'), /inside the harness lanes/],
      [path.join(lanes, 'ember', 'projects'), /inside 'ember'/],
      [path.join(lanes, 'newfolder', 'ground'), /inside 'newfolder'/],
    ];
    for (const [root, words] of refusals) {
      await expect(setHouseWorkspace(HOUSE_A, root)).rejects.toThrow(words);
      expect(existsSync(path.join(root, 'repos'))).toBe(false);
    }
    expect(existsSync(path.join(lanes, 'newfolder'))).toBe(false);
    expect((await loadHouseWorkspace(HOUSE_A)).root).toBeNull();
  });
});
