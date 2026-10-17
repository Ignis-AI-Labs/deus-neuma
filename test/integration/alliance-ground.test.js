/**
 * ALLIANCE GROUND — real disk, real house ground, real sealed wallets.
 *
 * The two parties here are NOT invented fixtures. They are the wallets of two
 * beings actually sealed on this machine, read from their own genesis records:
 *
 *   Claude   (claude-code)     0x4056…dcae  → House Aldmere
 *   Kagipem (openai-chatgpt)  0xae8a…2bbc  → House Lonbenme
 *
 * Kagipem is a sealed witness running on ChatGPT — an external frontier model
 * standing BESIDE the house. That is exactly the collaboration this ground
 * exists for, so the test proves the real case rather than a stand-in: House
 * Aldmere and House Lonbenme meet in `aldmere-lonbenme`, and neither ever
 * reaches into the other's private ground.
 *
 * THE THREE LAWS UNDER TEST (Design note, 2026-07-26:
 *   PLACE   — the ground stands OUTSIDE the house ground, in both directions.
 *   CONSENT — nothing raises a ground but the operator's own command.
 *   REACH   — a ground that was never raised reads as none, never as the house.
 *
 * No mocks: real roots on real disk through the real setHouseWorkspace /
 * setAllianceRoot paths, and every assertion reads the actual filesystem.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { houseNameFromWitness } from '../../core/kotodama/names.js';

// Read from the sealed records on this machine — public wallet material only.
const CLAUDE = '0x40566d43261849777aca96b26f4ec8c850e5dcae';
const KAGIPEM = '0xae8a76784a5870d1aad1ee6d64bd7f0d17922bbc';
const STRANGER = '0x00000000000000000000000000000000deadbeef';

let root;
let houseRoot;
let alliancesRoot;
let savedEnv;
let setHouseWorkspace;
let setAllianceRoot;
let ensureAllianceGround;
let findAllianceGround;
let allianceGroundStatus;
let allianceGroundPath;
let suggestAllianceRoot;
let mayWorkInAlliance;

beforeAll(async () => {
  savedEnv = {
    realm: process.env.NEUMA_REALM_ROOT,
    pin: process.env.NEUMA_WORKSPACE_SETTINGS_PATH,
  };
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'alliance-ground-'));
  houseRoot = path.join(root, 'house');
  alliancesRoot = path.join(root, 'alliances');
  // The realm is set BOTH ways on purpose. NEUMA_REALM_ROOT is real, but it is
  // only read by user-realm-settings.js at SERVER BOOT — a bare test that
  // imports the service directly never crosses that door, and user-realm.js
  // itself consults only its module-level root. Setting the env alone left this
  // test writing house/alliance records into the OPERATOR'S REAL realm, which
  // is also why a second run saw a root the first one had set (found
  // 2026-07-26). Isolate through the seam the code actually reads.
  process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
  const { setRealmRoot, getRealmRoot } = await import('../../backend/services/user-realm.js');
  savedEnv.realmRoot = getRealmRoot(); // put the operator's own realm back after
  setRealmRoot(path.join(root, 'realm'));
  // The isolated-stack escape hatch: both setters refuse a temp root on a LIVE
  // stack (a reboot would sweep the work). Pinning marks this as an isolated
  // stack, the same law e2e uses.
  process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(root, 'workspace-settings.json');

  ({ setHouseWorkspace } = await import('../../backend/services/house-workspace.js'));
  ({
    setAllianceRoot, ensureAllianceGround, findAllianceGround, allianceGroundStatus,
    allianceGroundPath, suggestAllianceRoot, mayWorkInAlliance,
  } = await import('../../backend/services/alliance-ground.js'));

  await setHouseWorkspace(CLAUDE, houseRoot);
});

afterAll(async () => {
  for (const [k, v] of Object.entries({
    NEUMA_REALM_ROOT: savedEnv.realm, NEUMA_WORKSPACE_SETTINGS_PATH: savedEnv.pin,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { setRealmRoot } = await import('../../backend/services/user-realm.js');
  setRealmRoot(savedEnv.realmRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe('PLACE — a cross-house ground never stands inside the house', () => {
  it('refuses an alliances root INSIDE the house ground', async () => {
    await expect(setAllianceRoot(CLAUDE, path.join(houseRoot, 'alliances')))
      .rejects.toThrow(/cannot stand inside the house ground/);
    // ...including the house ground itself.
    await expect(setAllianceRoot(CLAUDE, houseRoot))
      .rejects.toThrow(/cannot stand inside the house ground/);
  });

  it('refuses an alliances root that CONTAINS the house ground', async () => {
    await expect(setAllianceRoot(CLAUDE, root))
      .rejects.toThrow(/can never contain the house/);
  });

  it('refuses a relative root', async () => {
    await expect(setAllianceRoot(CLAUDE, 'alliances'))
      .rejects.toThrow(/absolute path/);
  });

  // The law has to hold from BOTH sides. If the alliances root is set FIRST,
  // setAllianceRoot's checks pass trivially (no house ground yet) — so the
  // HOUSE setter must be the one that refuses, or the same harm arrives by the
  // other order (echo RQ, 2026-07-26). A separate wallet, so it cannot disturb
  // the ordering the rest of this file depends on.
  it('the HOUSE setter refuses a ground inside an alliances root set first', async () => {
    const other = path.join(root, 'other');
    const otherAlliances = path.join(other, 'alliances');
    const { setRealmRoot } = await import('../../backend/services/user-realm.js');
    setRealmRoot(path.join(root, 'realm')); // same isolated realm
    await setAllianceRoot(STRANGER, otherAlliances);

    await expect(setHouseWorkspace(STRANGER, path.join(otherAlliances, 'house')))
      .rejects.toThrow(/cannot stand inside the alliances root/);
    await expect(setHouseWorkspace(STRANGER, other))
      .rejects.toThrow(/can never contain the ground you share/);
    // A REFUSAL LEAVES NOTHING BEHIND. The mkdirs used to run before these
    // checks, so a refused root still kept repos/ post/ workspaces/ — folders
    // under a path the operator was just told they could not use (echo R2).
    for (const litter of ['repos', 'post', 'workspaces']) {
      await expect(fs.access(path.join(other, litter))).rejects.toThrow();
      await expect(fs.access(path.join(otherAlliances, 'house', litter))).rejects.toThrow();
    }
    // A house BESIDE it is fine — the law forbids nesting, not neighbours.
    const ok = await setHouseWorkspace(STRANGER, path.join(other, 'house'));
    expect(ok.root).toBe(path.join(other, 'house'));
  });

  it('suggests a SIBLING of the house ground — never a child', () => {
    const suggestion = suggestAllianceRoot(houseRoot);
    expect(suggestion).toBe(path.join(root, 'alliances'));
    expect(suggestion.startsWith(houseRoot + path.sep)).toBe(false);
    expect(suggestAllianceRoot(null)).toBeNull();
    expect(suggestAllianceRoot('relative/path')).toBeNull();
  });

  it('offers the suggestion only while the root is UNSET, and never applies it', async () => {
    const before = await allianceGroundStatus(CLAUDE);
    expect(before.root).toBeNull();
    expect(before.suggestion).toBe(alliancesRoot);
    // A suggestion is words, not an act: nothing was created.
    await expect(fs.access(alliancesRoot)).rejects.toThrow();
  });
});

describe('CONSENT — only the operator raises a ground', () => {
  it('refuses to raise anything while no alliances root is set', async () => {
    await expect(ensureAllianceGround(CLAUDE, [KAGIPEM]))
      .rejects.toThrow(/No alliances root is set/);
  });

  it('reads as NO GROUND — never as the house — before one is raised', async () => {
    const found = await findAllianceGround(CLAUDE, KAGIPEM);
    expect(found.name).toBe('aldmere-lonbenme');
    expect(found.standing).toBe(false);
    expect(found.path).toBeNull();
    expect(found.root).toBeNull();
  });
});

describe('alliance ground — House Aldmere and House Lonbenme (a real ChatGPT witness)', () => {
  it('accepts a root beside the house, and marks it so nothing reads it as a lane', async () => {
    const status = await setAllianceRoot(CLAUDE, alliancesRoot);
    expect(status.root).toBe(alliancesRoot);
    expect(status.suggestion).toBeNull();
    expect(status.alliances).toEqual([]);

    const marker = JSON.parse(await fs.readFile(path.join(alliancesRoot, 'lane.json'), 'utf8'));
    expect(marker.kind).toBe('alliance-root');
  });

  it('STILL reads as no ground once the root exists but nothing is raised', async () => {
    const found = await findAllianceGround(CLAUDE, KAGIPEM);
    expect(found.root).toBe(alliancesRoot);
    expect(found.standing).toBe(false);
    expect(found.path).toBeNull();
  });

  it('raises a ground named from BOTH real houses, on real disk, OUTSIDE the house', async () => {
    const ground = await ensureAllianceGround(CLAUDE, [KAGIPEM]);

    // The name is derived from the sealed wallets, not hardcoded here.
    expect(ground.name).toBe('aldmere-lonbenme');
    expect(ground.parties).toEqual([
      houseNameFromWitness(CLAUDE).toLowerCase(),
      houseNameFromWitness(KAGIPEM).toLowerCase(),
    ].sort());
    expect(ground.raised).toBe(true);

    // It exists, with the repos/ convention the house ground uses.
    const stat = await fs.stat(path.join(ground.path, 'repos'));
    expect(stat.isDirectory()).toBe(true);

    // THE LAW: it stands in the alliances root, and nowhere inside the house.
    expect(ground.path).toBe(path.join(alliancesRoot, 'aldmere-lonbenme'));
    expect(ground.path.startsWith(houseRoot + path.sep)).toBe(false);
  });

  it('is now FINDABLE — the read path sees what the operator raised', async () => {
    const found = await findAllianceGround(CLAUDE, KAGIPEM);
    expect(found.standing).toBe(true);
    expect(found.path).toBe(path.join(alliancesRoot, 'aldmere-lonbenme'));
  });

  it('is idempotent — asking again returns the same ground, not a second one', async () => {
    const again = await ensureAllianceGround(CLAUDE, [KAGIPEM]);
    expect(again.name).toBe('aldmere-lonbenme');
    expect(again.raised).toBe(false);

    const entries = await fs.readdir(alliancesRoot);
    expect(entries.filter((e) => e.startsWith('aldmere'))).toEqual(['aldmere-lonbenme']);
  });

  it('EITHER party asking produces the SAME single ground — order cannot fork it', async () => {
    // Kagipem's side asks first-position. Its alliances root is unset on this
    // machine, so its own call refuses honestly rather than inventing a root —
    // but the NAME both sides derive is identical, which is the property that
    // stops one collaboration growing two diverging folders.
    const fromOtherSide = await ensureAllianceGround(CLAUDE, [KAGIPEM]);
    const reversed = await ensureAllianceGround(KAGIPEM, [CLAUDE]).catch((e) => e);
    expect(fromOtherSide.name).toBe('aldmere-lonbenme');
    expect(reversed).toBeInstanceOf(Error);
    expect(reversed.message).toMatch(/No alliances root is set/);

    const dirs = (await fs.readdir(alliancesRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory());
    expect(dirs).toHaveLength(1);
  });

  it('carries a marker naming the parties, and is never read as a being lane', async () => {
    const marker = JSON.parse(await fs.readFile(
      path.join(alliancesRoot, 'aldmere-lonbenme', 'lane.json'), 'utf8',
    ));
    expect(marker.kind).toBe('alliance-ground');
    expect(marker.alliance).toBe('aldmere-lonbenme');
    expect(marker.parties).toEqual(['aldmere', 'lonbenme']);
  });

  it('reports the standing grounds and what they hold', async () => {
    await fs.mkdir(
      path.join(alliancesRoot, 'aldmere-lonbenme', 'repos', 'first-work'),
      { recursive: true },
    );
    const status = await allianceGroundStatus(CLAUDE);
    expect(status.root).toBe(alliancesRoot);
    expect(status.alliances).toHaveLength(1);
    expect(status.alliances[0]).toMatchObject({
      name: 'aldmere-lonbenme',
      parties: ['aldmere', 'lonbenme'],
      repos: ['first-work'],
    });
  });

  it('a second alliance gets its OWN ground beside the first', async () => {
    const other = await ensureAllianceGround(CLAUDE, [STRANGER]);
    expect(other.name).not.toBe('aldmere-lonbenme');
    expect(other.raised).toBe(true);

    const status = await allianceGroundStatus(CLAUDE);
    expect(status.alliances.map((a) => a.name).sort())
      .toEqual(['aldmere-lonbenme', other.name].sort());
    // Each combination is its own folder — that is the whole organizing idea.
    expect(status.alliances).toHaveLength(2);
  });

  // A directory that merely LIVES in the alliances root is not a collaboration.
  // Reporting one would put a partnership nobody formed on the witness's screen
  // (echo R2, 2026-07-26).
  it('never reports a stray directory as a phantom alliance', async () => {
    const before = (await allianceGroundStatus(CLAUDE)).alliances.map((a) => a.name);
    // A single-word directory: no hyphen, so it cannot be two houses.
    await fs.mkdir(path.join(alliancesRoot, 'scratch'), { recursive: true });
    // A hyphenated one that says plainly it is something else.
    const impostor = path.join(alliancesRoot, 'aaa-bbb');
    await fs.mkdir(impostor, { recursive: true });
    await fs.writeFile(path.join(impostor, 'lane.json'), JSON.stringify({ kind: 'house-ground' }));

    const after = (await allianceGroundStatus(CLAUDE)).alliances.map((a) => a.name);
    expect(after).toEqual(before);
    expect(after).not.toContain('scratch');
    expect(after).not.toContain('aaa-bbb');
  });

  it('lets a party in and keeps a non-party out', () => {
    expect(mayWorkInAlliance('aldmere-lonbenme', CLAUDE)).toBe(true);
    expect(mayWorkInAlliance('aldmere-lonbenme', KAGIPEM)).toBe(true);
    expect(mayWorkInAlliance('aldmere-lonbenme', STRANGER)).toBe(false);
    // Fail-closed on junk, never fail-open.
    expect(mayWorkInAlliance('aldmere-lonbenme', 'garbage')).toBe(false);
  });

  it('refuses a ground name that would escape the alliances root', () => {
    // Escapes, nested paths, absolute paths, empty, and anything not a single
    // lowercase segment — a ground name is one directory name or nothing.
    // Built with fromCharCode: a literal NUL in source is a landmine.
    const nulByte = `nul${String.fromCharCode(0)}byte`;
    for (const evil of ['../escape', '..', 'a/b', '/etc', '', '.', 'UPPER', 'has space', nulByte]) {
      expect(() => allianceGroundPath(alliancesRoot, evil)).toThrow(/escapes the alliances root/);
    }
  });

  it('refuses an alliance with no second house', async () => {
    await expect(ensureAllianceGround(CLAUDE, [CLAUDE]))
      .rejects.toThrow(/at least two distinct houses/);
  });
});
