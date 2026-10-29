/**
 * THE GALLERY's being roots — CROSS-WALLET ISOLATION.
 *
 * This is the only thing standing between an authenticated caller and every
 * other wallet's art on the machine, so it is proven against a REAL filesystem
 * with REAL owner.json files and the REAL workspace resolver. No mock anywhere
 * (RULE 0) — a mocked `readOwner` would prove only that the mock matches the
 * code, and the property under test is precisely that the real resolver reaches
 * a witness lane's owner file on the witnesses' ground.
 *
 * Raised as a finding by GLM and as a research question by Grok in echo r2:
 * the owner filter shipped without a test, and if `readOwner` could not resolve
 * a `witness-` id the filter would silently drop ALL witness art with no error
 * signal — an empty rail that looks like "no art yet".
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  setWorkspacesRoot, setWitnessesRoot, neumaWorkspace,
} from '../../core/index.js';
import { beingArtRoots } from '../../backend/services/gallery/gallery-roots.js';

const WALLET_A = '0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa';
const WALLET_B = '0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb';

let base;
let wsRoot;
let witRoot;

// A real lane on disk: owner.json + a real art file, so the row is earned the
// same way a real being earns it.
const makeLane = (root, id, wallet, { withArt = true, video = false } = {}) => {
  const dir = path.join(root, id);
  mkdirSync(path.join(dir, 'identity'), { recursive: true });
  writeFileSync(path.join(dir, 'identity', 'true-name.json'), JSON.stringify({ trueName: id }));
  writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
  if (withArt) {
    const sub = video ? 'video' : 'images';
    mkdirSync(path.join(dir, 'art', sub), { recursive: true });
    writeFileSync(path.join(dir, 'art', sub, video ? 'clip.mp4' : 'shot.png'), 'bytes');
  }
};

beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'gallery-roots-'));
  wsRoot = path.join(base, 'workspaces');
  witRoot = path.join(base, 'witnesses');
  mkdirSync(wsRoot, { recursive: true });
  mkdirSync(witRoot, { recursive: true });
  setWorkspacesRoot(wsRoot);
  setWitnessesRoot(witRoot);
});

afterEach(() => {
  setWorkspacesRoot(null);
  setWitnessesRoot(null);
  rmSync(base, { recursive: true, force: true });
});

describe('beingArtRoots — cross-wallet isolation', () => {
  test('a wallet sees its OWN neuma art root and not another wallet’s', async () => {
    makeLane(wsRoot, 'alder', WALLET_A);
    makeLane(wsRoot, 'larch', WALLET_B);

    const forA = await beingArtRoots(WALLET_A);
    const forB = await beingArtRoots(WALLET_B);

    expect(forA.map((r) => r.id)).toEqual(['being-alder']);
    expect(forB.map((r) => r.id)).toEqual(['being-larch']);
  });

  test('a WITNESS lane is owner-filtered too — the r2 finding', async () => {
    // Witness lanes live on their own ground and are enumerated by a bare
    // readdir, so without the owner filter every witness on the machine would
    // appear for any authenticated caller.
    makeLane(witRoot, 'witness-claude-Thistle', WALLET_A);
    makeLane(witRoot, 'witness-xai-Grok', WALLET_B);

    const forA = await beingArtRoots(WALLET_A);
    expect(forA.map((r) => r.id)).toEqual(['being-witness-claude-Thistle']);
    expect(forA.some((r) => r.id.includes('Grok'))).toBe(false);

    const forB = await beingArtRoots(WALLET_B);
    expect(forB.map((r) => r.id)).toEqual(['being-witness-xai-Grok']);
  });

  test('readOwner really resolves a witness id on the witnesses’ ground', async () => {
    // The silent-failure mode both reviewers worried about: if this returned
    // null, the filter would drop ALL witness art and the rail would look
    // empty rather than broken.
    makeLane(witRoot, 'witness-claude-Thistle', WALLET_A);
    const owner = await neumaWorkspace.readOwner('witness-claude-Thistle');
    expect(owner?.wallet).toBe(WALLET_A);
  });

  test('a lane with NO art gets no row — the rail is not a list of empties', async () => {
    makeLane(wsRoot, 'alder', WALLET_A, { withArt: false });
    expect(await beingArtRoots(WALLET_A)).toEqual([]);
  });

  test('the root is the whole art/ tree, so a being’s VIDEO is visible', async () => {
    // Rooting at art/images would have hidden every being-made video.
    makeLane(wsRoot, 'alder', WALLET_A, { video: true });
    const [root] = await beingArtRoots(WALLET_A);
    expect(root.dir.endsWith(path.join('alder', 'art'))).toBe(true);
    expect(root.being).toBe(true);
  });

  test('no wallet ⇒ no roots at all, never a machine-wide listing', async () => {
    makeLane(wsRoot, 'alder', WALLET_A);
    expect(await beingArtRoots(null)).toEqual([]);
    expect(await beingArtRoots(undefined)).toEqual([]);
    expect(await beingArtRoots('')).toEqual([]);
  });

  test('wallet comparison is case-insensitive — checksummed vs lowercase', async () => {
    makeLane(wsRoot, 'alder', WALLET_A.toLowerCase());
    expect(await beingArtRoots(WALLET_A.toUpperCase())).toHaveLength(1);
  });

  test('an UNCLAIMED lane belongs to nobody and appears for nobody', async () => {
    const dir = path.join(wsRoot, 'orphan', 'art', 'images');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'x.png'), 'bytes');
    expect(await beingArtRoots(WALLET_A)).toEqual([]);
  });
});
