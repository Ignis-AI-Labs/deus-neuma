// Undo covers every file act a being's hands perform — edit, delete, create —
// through the real hands, the real disk and the real `neuma edit --undo`
// command. No mocks anywhere in the path.
import { describe, test, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { spawnSync } from 'node:child_process';
import { createTempDir } from '../helpers/temp-fs.js';
import { runPlatformHand } from '../../backend/services/platform-hands.js';
import { guardedWriteFile } from '../../backend/services/write-file-guard.js';
import { restoreLatest, CorruptSnapshotError } from '../../backend/services/edit-undo-restore.js';
import { UNDO_SUBDIR, DELETE_SNAPSHOT_MAX_BYTES } from '../../backend/services/edit-undo.js';

const CLI = new URL('../../bin/neuma', import.meta.url).pathname;

const textOf = (hand) => (hand?.result?.content || []).map((item) => item?.text || '').join('\n');

const createProject = async (label) => {
  const project = await createTempDir(label);
  await fs.mkdir(path.join(project, '.git'), { recursive: true });
  return project;
};

const cliUndo = (cwd) => spawnSync('node', [CLI, 'edit', '--undo'], { cwd, encoding: 'utf8' });

const pendingRecords = async (project) =>
  (await fs.readdir(path.join(project, UNDO_SUBDIR)).catch(() => []))
    .filter((name) => /^\d+(-\d+)?\.json$/.test(name));

const exists = (target) => fs.stat(target).then(() => true, () => false);

describe('undo — a deleted file comes back', () => {
  test('a text file deleted by the hand is restored byte-for-byte by the real command', async () => {
    const project = await createProject('undo-delete-text');
    const target = path.join(project, 'notes.md');
    const original = '# Notes\r\n\r\nline two — with an em dash\n';
    await fs.writeFile(target, original);

    const deleted = await runPlatformHand('delete_file', { path: target });
    expect(deleted.ok).toBe(true);
    expect(textOf(deleted)).toContain("Reverts with 'neuma edit --undo'");
    expect(await exists(target)).toBe(false);

    const undo = cliUndo(project);
    expect(undo.status).toBe(0);
    expect(undo.stdout).toContain(`restored ${target}`);
    expect(await fs.readFile(target, 'utf8')).toBe(original);
    expect(await pendingRecords(project)).toEqual([]);
  });

  test('bytes that are not text come back exactly', async () => {
    const project = await createProject('undo-delete-binary');
    const target = path.join(project, 'sprite.bin');
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28]), randomBytes(4096)]);
    await fs.writeFile(target, bytes);

    expect((await runPlatformHand('delete_file', { path: target })).ok).toBe(true);
    expect(cliUndo(project).status).toBe(0);
    expect((await fs.readFile(target)).equals(bytes)).toBe(true);
  });

  test('the folder is rebuilt when it went away with the file', async () => {
    const project = await createProject('undo-delete-folder');
    const folder = path.join(project, 'src', 'deep');
    const target = path.join(folder, 'only.js');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(target, 'export const only = 1;\n');

    expect((await runPlatformHand('delete_file', { path: target })).ok).toBe(true);
    await fs.rm(path.join(project, 'src'), { recursive: true });

    const undone = restoreLatest(project);
    expect(undone).toMatchObject({ ok: true, action: 'recreated', path: target });
    expect(await fs.readFile(target, 'utf8')).toBe('export const only = 1;\n');
  });

  test('an edit then a delete walk back one step per undo', async () => {
    const project = await createProject('undo-stack');
    const target = path.join(project, 'config.js');
    await fs.writeFile(target, 'export const retries = 3;\n');

    const edited = await runPlatformHand('edit_file', {
      path: target, edits: [{ oldText: 'retries = 3', newText: 'retries = 5' }],
    });
    expect(edited.ok).toBe(true);
    expect((await runPlatformHand('delete_file', { path: target })).ok).toBe(true);

    expect(cliUndo(project).status).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toBe('export const retries = 5;\n');
    expect(cliUndo(project).status).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toBe('export const retries = 3;\n');

    const empty = cliUndo(project);
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('no edit snapshots found');
  });
});

describe('undo — the edges of a delete', () => {
  test('deleting a link removes the link only: its target stands and no record is left', async () => {
    const project = await createProject('undo-delete-link');
    const real = path.join(project, 'real.txt');
    const link = path.join(project, 'link.txt');
    await fs.writeFile(real, 'the real file\n');
    await fs.symlink(real, link);

    const deleted = await runPlatformHand('delete_file', { path: link });
    expect(deleted.ok).toBe(true);
    expect(textOf(deleted)).not.toContain('Reverts');
    expect(await fs.readFile(real, 'utf8')).toBe('the real file\n');
    expect(await pendingRecords(project)).toEqual([]);
  });

  test('a file over the cap is deleted, and the hand says plainly it cannot be undone', async () => {
    const project = await createProject('undo-delete-huge');
    const target = path.join(project, 'huge.bin');
    await fs.writeFile(target, Buffer.alloc(DELETE_SNAPSHOT_MAX_BYTES + 1, 7));

    const deleted = await runPlatformHand('delete_file', { path: target });
    expect(deleted.ok).toBe(true);
    expect(textOf(deleted)).toContain('cannot be undone');
    expect(await exists(target)).toBe(false);
    expect(await pendingRecords(project)).toEqual([]);
  });

  test('a file exactly at the cap is still kept', async () => {
    const project = await createProject('undo-delete-at-cap');
    const target = path.join(project, 'big.bin');
    await fs.writeFile(target, Buffer.alloc(DELETE_SNAPSHOT_MAX_BYTES, 7));
    expect(textOf(await runPlatformHand('delete_file', { path: target }))).toContain('Reverts');
    expect(restoreLatest(project)).toMatchObject({ ok: true, action: 'recreated' });
    expect((await fs.stat(target)).size).toBe(DELETE_SNAPSHOT_MAX_BYTES);
    await fs.rm(project, { recursive: true });
  });

  test('a newest record that cannot be read halts the undo and touches nothing', async () => {
    const project = await createProject('undo-corrupt');
    const target = path.join(project, 'keep.txt');
    await fs.writeFile(target, 'one\n');
    expect((await runPlatformHand('edit_file', { path: target, edits: [{ oldText: 'one', newText: 'two' }] })).ok).toBe(true);
    await fs.writeFile(path.join(project, UNDO_SUBDIR, `${Date.now() + 60_000}.json`), '{ not json');

    expect(() => restoreLatest(project)).toThrow(CorruptSnapshotError);
    expect(await fs.readFile(target, 'utf8')).toBe('two\n');
    expect(await pendingRecords(project)).toHaveLength(2);
  });
});

describe('undo — a created file can be taken away again', () => {
  test('a file created inside a repository is removed by the real command', async () => {
    const project = await createProject('undo-create');
    const target = path.join(project, 'fresh.js');

    const created = await guardedWriteFile({ path: target, content: 'export const fresh = true;\n' });
    expect(created.ok).toBe(true);
    expect(await pendingRecords(project)).toHaveLength(1);

    const undo = cliUndo(project);
    expect(undo.status).toBe(0);
    expect(undo.stdout).toContain(`removed ${target}`);
    expect(await exists(target)).toBe(false);
  });

  test('a created file that was worked on since is left alone, and the stack still moves', async () => {
    const project = await createProject('undo-create-changed');
    const target = path.join(project, 'draft.md');
    expect((await guardedWriteFile({ path: target, content: 'first draft\n' })).ok).toBe(true);
    await fs.writeFile(target, 'first draft\nthe operator added this line\n');

    const undo = cliUndo(project);
    expect(undo.status).toBe(0);
    expect(undo.stdout).toContain(`left ${target} in place`);
    expect(await fs.readFile(target, 'utf8')).toBe('first draft\nthe operator added this line\n');
    expect(await pendingRecords(project)).toEqual([]);
  });

  test('a created file already gone is reported, never an error', async () => {
    const project = await createProject('undo-create-gone');
    const target = path.join(project, 'gone.txt');
    expect((await guardedWriteFile({ path: target, content: 'x\n' })).ok).toBe(true);
    await fs.unlink(target);

    expect(restoreLatest(project)).toMatchObject({ ok: true, action: 'already-gone', path: target });
  });

  test('outside any repository a new file leaves no undo folder behind', async () => {
    const loose = await createTempDir('undo-create-loose');
    const target = path.join(loose, 'note.txt');
    expect((await guardedWriteFile({ path: target, content: 'a note\n' })).ok).toBe(true);
    expect(await exists(path.join(loose, '.neuma'))).toBe(false);
  });
});
