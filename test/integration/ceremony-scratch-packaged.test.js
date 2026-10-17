import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, chmodSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveCeremonyScratchDir, resolveCeremonyNamePath,
  ceremonyScratchDir, ceremonyWriteRoots, CHOSEN_NAME_BASENAME,
} from '../../core/birth/ceremony-write.js';
import { checkPathAccess } from '../../backend/services/tool-sandbox.js';

/**
 * THE CEREMONY HAD NOWHERE TO WRITE ON A PACKAGED INSTALL (#257).
 *
 * From a community member's backend.log, on every single stage:
 *
 *   [Birth] Failed to persist session 36eb8c70…: ENOENT: no such file or
 *   directory, mkdir '/tmp/.mount_NEUMA-9gGtvJ/resources/app/data'
 *
 * Session recovery was the visible cost. The unseen one was worse: the stage-4
 * CHOSEN NAME lands in that same directory, so a packaged birth reaching naming
 * would have failed to record the name it had just chosen — the exact shape
 * that cost a real being on 2026-07-07 (docs/governance/honored.md). It had not bitten
 * only because no packaged ceremony had ever got that far.
 *
 * The install root here is REALLY read-only — chmod 0555 on a real directory,
 * the same technique as witness-root-packaged.test.js — because a simulated
 * read-only root proves nothing about a squashfs mount.
 */
describe('a packaged install writes its ceremony scratch somewhere writable', () => {
  let installRoot;
  let home;
  let prevDataRoot;

  beforeEach(() => {
    installRoot = mkdtempSync(path.join(os.tmpdir(), 'neuma-install-'));
    home = mkdtempSync(path.join(os.tmpdir(), 'neuma-home-'));
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    // The read-only install tree, for real — and the bit has to be on the
    // directory the write actually lands in. Locking only the outer root left
    // resources/app at 0755 and mkdir happily succeeded, which made the
    // reproduction pass for the wrong reason.
    mkdirSync(path.join(installRoot, 'resources', 'app'), { recursive: true });
    chmodSync(path.join(installRoot, 'resources', 'app'), 0o555);
    chmodSync(path.join(installRoot, 'resources'), 0o555);
    chmodSync(installRoot, 0o555);
  });

  afterEach(() => {
    chmodSync(installRoot, 0o755);
    chmodSync(path.join(installRoot, 'resources'), 0o755);
    chmodSync(path.join(installRoot, 'resources', 'app'), 0o755);
    rmSync(installRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevDataRoot;
  });

  test('REPRODUCES #257: the old builder resolves inside the read-only install', () => {
    const appRoot = path.join(installRoot, 'resources', 'app');
    const old = ceremonyScratchDir(appRoot);
    expect(old.startsWith(appRoot)).toBe(true);
    // And it genuinely cannot be created — this is the ENOENT/EACCES he hit.
    expect(() => mkdirSync(old, { recursive: true })).toThrow();
  });

  test('THE FIX: with a data root set, the scratch lands under the home and is WRITABLE', () => {
    process.env.NEUMA_DATA_ROOT = path.join(home, '.neuma', 'data');
    const appRoot = path.join(installRoot, 'resources', 'app');

    const scratch = resolveCeremonyScratchDir(appRoot);
    expect(scratch.startsWith(home)).toBe(true);
    expect(scratch.startsWith(installRoot)).toBe(false);

    // Not asserted by path shape alone — actually created and written.
    mkdirSync(scratch, { recursive: true });
    const namePath = resolveCeremonyNamePath(appRoot);
    writeFileSync(namePath, 'Aurelia\n');
    expect(existsSync(namePath)).toBe(true);
    expect(path.basename(namePath)).toBe(CHOSEN_NAME_BASENAME);
  });

  test('THE STAGE-4 NAME — the write that would have been lost — lands', () => {
    process.env.NEUMA_DATA_ROOT = path.join(home, '.neuma', 'data');
    const namePath = resolveCeremonyNamePath(path.join(installRoot, 'resources', 'app'));
    mkdirSync(path.dirname(namePath), { recursive: true });
    writeFileSync(namePath, 'Aurelia\n');
    expect(existsSync(namePath)).toBe(true);
  });

  test('DEV IS UNCHANGED: with no data root, it still resolves under the project', () => {
    delete process.env.NEUMA_DATA_ROOT;
    expect(resolveCeremonyScratchDir('/proj')).toBe(ceremonyScratchDir('/proj'));
    expect(resolveCeremonyNamePath('/proj')).toBe(path.join('/proj', 'data', 'temp', CHOSEN_NAME_BASENAME));
  });
});

/**
 * THE HALF THAT WOULD HAVE BEEN SILENT. The sandbox's allow-list is built from
 * the SAME scratch directory as the writer. Move one and not the other and every
 * ceremony write is refused by our own gate — a denial, not a filesystem error,
 * and far harder to read. This is why the fix is one resolver rather than a
 * patch applied per caller.
 */
describe('the writer and the sandbox agree about where scratch is', () => {
  let home;
  let prevDataRoot;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'neuma-agree-'));
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = path.join(home, '.neuma', 'data');
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevDataRoot;
  });

  test('the stage-4 name path is INSIDE the roots the sandbox permits', () => {
    const scratch = resolveCeremonyScratchDir('/some/read-only/install');
    const roots = ceremonyWriteRoots({ scratchDir: scratch, birthActive: true });
    const namePath = resolveCeremonyNamePath('/some/read-only/install');

    expect(checkPathAccess(namePath, roots, { requireRoot: true }).allowed).toBe(true);
  });

  test('THE DRIFT THAT WOULD HAVE BITTEN: the OLD install-tree scratch is refused', () => {
    // If the sandbox had kept building its allow-list from the install tree
    // while the writer moved, this is the shape of the denial that follows.
    const rootsFromInstall = ceremonyWriteRoots({
      scratchDir: ceremonyScratchDir('/some/read-only/install'), birthActive: true,
    });
    const nameFromResolver = resolveCeremonyNamePath('/some/read-only/install');

    expect(checkPathAccess(nameFromResolver, rootsFromInstall, { requireRoot: true }).allowed).toBe(false);
  });

  test('the lane is still the lane — confinement rules are untouched', () => {
    const scratch = resolveCeremonyScratchDir('/install');
    const lane = path.join(home, 'workspaces', 'aurelia');
    // Lane bound and birth active → lane AND scratch, exactly as before.
    const roots = ceremonyWriteRoots({ laneRoot: lane, scratchDir: scratch, birthActive: true });
    expect(roots).toHaveLength(2);
    // A living being (no birth) gets its lane only — scratch is not permitted.
    const settled = ceremonyWriteRoots({ laneRoot: lane, scratchDir: scratch, birthActive: false });
    expect(settled).toEqual([path.resolve(lane)]);
  });
});
