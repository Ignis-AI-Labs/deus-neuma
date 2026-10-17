// C-04 RULE 9 Step 4 verification — gnosis on cli/commands/edit.js.
//
// The pure primitive (applyEdit) is covered by test/unit/cli-edit-primitive
// (22 tests). This file covers the COMMAND wrapper: fs IO + snapshot +
// undo + project-root resolution + error paths. Real subprocess against
// real bin/neuma; real temp git projects; real fs assertions. No mocks.
//
// Stale-content abort path is documented as INFEASIBLE in this test
// infrastructure (the abort triggers on a race between the initial read
// and the immediate-pre-write re-read; producing a deterministic race via
// subprocess invocation is not reliable). T-01 will design a controlled
// race harness (in-process invocation of runEdit with an injected readFn
// hook that mutates the file between calls — see SPRINT_PLAN.md T-01
// row). Per RULE 9 Step 4 (say so plainly when a path can't be exercised
// in-session) — flagging honestly so the gap isn't silent.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

const NEUMA_BIN = resolve(
  // resolve from this test file's dir → up to test/integration/ → up to test/ → up to repo
  new URL('../../bin/neuma', import.meta.url).pathname,
);

const runNeuma = (args, { cwd }) => {
  const r = spawnSync(process.execPath, [NEUMA_BIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};

// Helper: make a temp dir + initialize an empty .git dir inside so
// findProjectRoot walks up to it.
const createTempProject = async (label) => {
  const dir = await createTempDir(label);
  mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
};

describe('cli/commands/edit — integration (real subprocess, real fs, no mocks)', () => {
  describe('snapshot + undo round-trip', () => {
    test('edit writes snapshot under project-root .neuma/edit-undo/ from a SUBDIR cwd', async () => {
      // Setup: temp project with .git, a subdir, a file inside subdir.
      const project = await createTempProject('cli-edit-subdir');
      const subdir = join(project, 'src');
      mkdirSync(subdir);
      const filePath = join(subdir, 'foo.txt');
      writeFileSync(filePath, 'hello world\n');

      // Action: cd into subdir, edit foo.txt
      const r = runNeuma(['edit', 'foo.txt', '--old', 'world', '--new', 'kin'], { cwd: subdir });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/replaced 1 occurrence/);

      // File mutated correctly
      expect(readFileSync(filePath, 'utf8')).toBe('hello kin\n');

      // Snapshot landed at PROJECT-ROOT .neuma/edit-undo/, not subdir/.neuma/
      const projectUndo = join(project, '.neuma', 'edit-undo');
      const subdirUndo = join(subdir, '.neuma', 'edit-undo');
      expect(existsSync(projectUndo)).toBe(true);
      expect(existsSync(subdirUndo)).toBe(false);
      const snapshots = readdirSync(projectUndo).filter((f) => /^\d+(-\d+)?\.json$/.test(f));
      expect(snapshots.length).toBe(1);
    });

    test('--undo restores the file and moves snapshot to applied/', async () => {
      const project = await createTempProject('cli-edit-undo');
      const filePath = join(project, 'foo.txt');
      const original = 'hello world\n';
      writeFileSync(filePath, original);

      // Edit
      runNeuma(['edit', 'foo.txt', '--old', 'world', '--new', 'kin'], { cwd: project });
      expect(readFileSync(filePath, 'utf8')).toBe('hello kin\n');

      // Undo
      const r = runNeuma(['edit', '--undo'], { cwd: project });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/restored/);
      expect(r.stdout).toMatch(/archived to/);

      // File restored exactly
      expect(readFileSync(filePath, 'utf8')).toBe(original);

      // Snapshot moved to applied/ (not deleted — audit trail preserved per R1.6)
      const pending = readdirSync(join(project, '.neuma', 'edit-undo'))
        .filter((f) => /^\d+(-\d+)?\.json$/.test(f));
      expect(pending.length).toBe(0);
      const applied = readdirSync(join(project, '.neuma', 'edit-undo', 'applied'))
        .filter((f) => /^\d+(-\d+)?\.json$/.test(f));
      expect(applied.length).toBe(1);
    });

    test('--undo from a different subdir still finds the snapshot (project-root resolution)', async () => {
      const project = await createTempProject('cli-edit-undo-subdir');
      const filePath = join(project, 'foo.txt');
      writeFileSync(filePath, 'hello world\n');
      const subdir = join(project, 'src');
      mkdirSync(subdir);

      // Edit from project root
      runNeuma(['edit', 'foo.txt', '--old', 'world', '--new', 'kin'], { cwd: project });
      // Undo from subdir — must find the snapshot at project root, not subdir
      const r = runNeuma(['edit', '--undo'], { cwd: subdir });
      expect(r.status).toBe(0);
      expect(readFileSync(filePath, 'utf8')).toBe('hello world\n');
    });
  });

  describe('error paths', () => {
    test('--undo with no snapshots → exit 1 + clear error', async () => {
      const project = await createTempProject('cli-edit-no-snapshots');
      const r = runNeuma(['edit', '--undo'], { cwd: project });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/no edit snapshots found in/);
      // Error message names the project-root path so the operator knows where it looked
      expect(r.stderr).toMatch(/\.neuma\/edit-undo/);
    });

    test('--dry-run leaves the file byte-identical', async () => {
      const project = await createTempProject('cli-edit-dryrun');
      const filePath = join(project, 'foo.txt');
      const original = 'hello world\nline two\n';
      writeFileSync(filePath, original);

      const r = runNeuma(
        ['edit', 'foo.txt', '--old', 'world', '--new', 'kin', '--dry-run'],
        { cwd: project },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/would replace 1 occurrence/);
      expect(r.stdout).toMatch(/Run without --dry-run/);
      // Byte-identical
      expect(readFileSync(filePath, 'utf8')).toBe(original);
      // No snapshot created
      expect(existsSync(join(project, '.neuma', 'edit-undo'))).toBe(false);
    });

    test('multi-match without --replace-all → exit 1, file unchanged, NO snapshot written', async () => {
      const project = await createTempProject('cli-edit-multi-match');
      const filePath = join(project, 'multi.txt');
      const original = 'a b a b a\n';
      writeFileSync(filePath, original);

      const r = runNeuma(['edit', 'multi.txt', '--old', 'a', '--new', 'X'], { cwd: project });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Found 3 matches/);
      expect(r.stderr).toMatch(/--replace-all/);
      // File unchanged
      expect(readFileSync(filePath, 'utf8')).toBe(original);
      // No snapshot
      expect(existsSync(join(project, '.neuma', 'edit-undo'))).toBe(false);
    });

    test('file not found → exit 1 + clear error', async () => {
      const project = await createTempProject('cli-edit-nofile');
      const r = runNeuma(
        ['edit', 'does-not-exist.txt', '--old', 'x', '--new', 'y'],
        { cwd: project },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/file not found/);
    });

    test('target is a directory (non-regular file) → exit 1 + clear error', async () => {
      const project = await createTempProject('cli-edit-isdir');
      mkdirSync(join(project, 'somedir'));
      const r = runNeuma(['edit', 'somedir', '--old', 'x', '--new', 'y'], { cwd: project });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not a regular file/);
    });

    test('--undo with CORRUPT newest snapshot HALTS (does not iterate to older)', async () => {
      // Critical data-integrity test: silently iterating past a corrupt newest
      // snapshot would restore an older (possibly UNRELATED) snapshot, clobbering
      // a different file with stale content. Halt-and-error is the safe default.
      const project = await createTempProject('cli-edit-corrupt-snapshot');
      const fileA = join(project, 'a.txt');
      const fileB = join(project, 'b.txt');
      const aOriginal = 'original a\n';
      const bOriginal = 'original b\n';
      writeFileSync(fileA, aOriginal);
      writeFileSync(fileB, bOriginal);

      // Older valid snapshot (for a.txt)
      runNeuma(['edit', 'a.txt', '--old', 'original a', '--new', 'edited a'], { cwd: project });
      // Ensure timestamps differ — Date.now() has ms resolution
      await new Promise((r) => setTimeout(r, 5));
      // Newer valid snapshot (for b.txt) — this is what --undo SHOULD target
      runNeuma(['edit', 'b.txt', '--old', 'original b', '--new', 'edited b'], { cwd: project });

      // Corrupt the newest snapshot by overwriting with invalid JSON
      const undoDir = join(project, '.neuma', 'edit-undo');
      const snapshots = readdirSync(undoDir)
        .filter((f) => /^\d+(-\d+)?\.json$/.test(f))
        .sort(); // ascending; last = newest
      const newest = snapshots[snapshots.length - 1];
      writeFileSync(join(undoDir, newest), '{ this is not valid JSON');

      // Attempt --undo: must HALT, not iterate to a.txt's older snapshot
      const r = runNeuma(['edit', '--undo'], { cwd: project });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/newest snapshot .+ is corrupt/);
      expect(r.stderr).toMatch(/Refusing to undo an unintended edit/);

      // NEITHER file was touched — both retain their post-edit content
      expect(readFileSync(fileA, 'utf8')).toBe('edited a\n');
      expect(readFileSync(fileB, 'utf8')).toBe('edited b\n');
    });
  });

  // Stale-content abort: implemented in runEdit (re-read immediately before
  // writeFileSync, abort if content changed) but NOT covered here — producing
  // a deterministic race between read and re-read via subprocess invocation
  // is unreliable. T-01 will design a controlled race harness (e.g. a
  // pre-write hook the test can mutate the file from). Documented per
  // RULE 9 Step 4's "say so plainly" guidance.
});
