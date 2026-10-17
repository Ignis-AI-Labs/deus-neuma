/**
 * A project's shared files become always-on turn context — proven on real
 * files on disk. buildProjectFilesSection reads actual files from a temp
 * project folder, sniffs binary content for real (NUL byte), and enforces the
 * three bounds (per-file, total budget, file count). No mocks.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildProjectFilesSection } from '../../backend/services/project-files.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { createProject, addSharedFile } from '../../backend/services/user-projects.js';
import { normalizeSpace } from '../../core/memory/space.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { _projectFilesSection } = __test;
const NUL = String.fromCharCode(0);
const WALLET = '0x1111111111111111111111111111111111111111';

describe('buildProjectFilesSection — real files, bounded', () => {
  let folder;
  const project = (files) => ({ folder, name: 'Voice Layer', sharedFiles: files.map((p) => ({ path: p })) });

  beforeEach(async () => {
    folder = await createTempDir('project-files');
  });

  test('text files become one section, fenced, with folder-relative headings', async () => {
    await fs.writeFile(path.join(folder, 'spec.md'), '# Spec\nlip-sync from amplitude');
    await fs.mkdir(path.join(folder, 'src'));
    await fs.writeFile(path.join(folder, 'src', 'vad.js'), 'export const vad = () => 1;');

    const { section, included, skipped } = await buildProjectFilesSection(
      project([path.join(folder, 'spec.md'), path.join(folder, 'src', 'vad.js')]),
    );
    expect(skipped).toHaveLength(0);
    expect(included).toHaveLength(2);
    expect(section.label).toBe('PROJECT FILES');
    expect(section.text).toContain('### spec.md');
    expect(section.text).toContain(path.join('src', 'vad.js')); // relative heading
    expect(section.text).toContain('lip-sync from amplitude');
    expect(section.text).toContain('export const vad');
  });

  test('a binary file (NUL byte) is skipped with a reason, never injected', async () => {
    await fs.writeFile(path.join(folder, 'good.txt'), 'readable');
    await fs.writeFile(path.join(folder, 'blob.bin'), Buffer.from([0x89, 0x00, 0x01, 0x02, 0x00]));
    const { section, included, skipped } = await buildProjectFilesSection(
      project([path.join(folder, 'good.txt'), path.join(folder, 'blob.bin')]),
    );
    expect(included.map((f) => path.basename(f.path))).toEqual(['good.txt']);
    expect(skipped).toEqual([{ path: path.join(folder, 'blob.bin'), reason: 'not text (binary)' }]);
    expect(section.text).not.toContain(NUL);
  });

  test('a file over the hard byte ceiling is skipped as too large', async () => {
    await fs.writeFile(path.join(folder, 'huge.log'), 'x'.repeat(600 * 1024)); // > 512KB
    const { section, skipped } = await buildProjectFilesSection(project([path.join(folder, 'huge.log')]));
    expect(section).toBeNull();
    expect(skipped[0].reason).toMatch(/too large/);
  });

  test('per-file char cap truncates and marks the heading', async () => {
    await fs.writeFile(path.join(folder, 'big.md'), 'y'.repeat(5000));
    const { section, included } = await buildProjectFilesSection(
      project([path.join(folder, 'big.md')]), { perFileChars: 1000 },
    );
    expect(included[0].truncated).toBe(true);
    expect(included[0].chars).toBe(1000);
    expect(section.text).toContain('### big.md (truncated)');
  });

  test('the total budget stops inclusion and reports the rest as skipped', async () => {
    for (const n of ['a', 'b', 'c']) await fs.writeFile(path.join(folder, `${n}.txt`), 'z'.repeat(800));
    const { included, skipped } = await buildProjectFilesSection(
      project([path.join(folder, 'a.txt'), path.join(folder, 'b.txt'), path.join(folder, 'c.txt')]),
      { totalChars: 1000 },
    );
    // a.txt (800) fits; b.txt gets the remaining 200 (truncated); c.txt is over budget.
    expect(included.map((f) => path.basename(f.path))).toEqual(['a.txt', 'b.txt']);
    expect(included[1].truncated).toBe(true);
    expect(skipped).toEqual([{ path: path.join(folder, 'c.txt'), reason: 'over the total context budget' }]);
  });

  test('the file-count cap skips the overflow', async () => {
    const paths = [];
    for (const n of ['1', '2', '3']) {
      const p = path.join(folder, `f${n}.txt`);
      await fs.writeFile(p, 'small');
      paths.push(p);
    }
    const { included, skipped } = await buildProjectFilesSection(project(paths), { maxFiles: 2 });
    expect(included).toHaveLength(2);
    expect(skipped[0].reason).toMatch(/2-file limit/);
  });

  test('a missing file is skipped, not fatal', async () => {
    await fs.writeFile(path.join(folder, 'here.txt'), 'present');
    const { included, skipped } = await buildProjectFilesSection(
      project([path.join(folder, 'gone.txt'), path.join(folder, 'here.txt')]),
    );
    expect(included.map((f) => path.basename(f.path))).toEqual(['here.txt']);
    expect(skipped[0]).toMatchObject({ reason: 'missing' });
  });

  test('no shared files → no section (nothing injected)', async () => {
    const { section, included, skipped } = await buildProjectFilesSection(project([]));
    expect(section).toBeNull();
    expect(included).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  test('a body containing a triple-backtick fence cannot break out of its block', async () => {
    await fs.writeFile(path.join(folder, 'readme.md'), 'before\n```\nfenced\n```\nafter');
    const { section } = await buildProjectFilesSection(project([path.join(folder, 'readme.md')]));
    // The outer fence must be longer than any run inside, so the body stays enclosed.
    expect(section.text).toContain('````'); // 4-backtick outer fence
  });
});

// The injection path exactly as streamConsciousness calls it: a connection
// carrying a project space + wallet, resolved against the REAL project store on
// a temp realm. Proves the section rides a project turn and only a project turn.
describe('_projectFilesSection — the turn injection path (real store + files)', () => {
  let folder;
  beforeEach(async () => {
    setRealmRoot(await createTempDir('proj-files-inject-realm'));
    folder = await createTempDir('proj-files-inject-folder');
  });

  test('a project chat with shared files gets the PROJECT FILES section', async () => {
    const p = await createProject(WALLET, { name: 'Voice Layer', folder });
    await fs.writeFile(path.join(folder, 'notes.md'), 'amplitude drives the mouth');
    await addSharedFile(WALLET, p.id, 'notes.md');

    const conn = { walletAddress: WALLET, space: normalizeSpace({ id: p.id, kind: 'project', label: p.name }) };
    const section = await _projectFilesSection(conn);
    expect(section.label).toBe('PROJECT FILES');
    expect(section.text).toContain('amplitude drives the mouth');
  });

  test('a project with no shared files injects nothing', async () => {
    const p = await createProject(WALLET, { name: 'Empty', folder });
    const conn = { walletAddress: WALLET, space: normalizeSpace({ id: p.id, kind: 'project', label: p.name }) };
    expect(await _projectFilesSection(conn)).toBeNull();
  });

  test('a general (non-project) chat injects nothing', async () => {
    const conn = { walletAddress: WALLET, space: normalizeSpace(null) };
    expect(await _projectFilesSection(conn)).toBeNull();
  });

  test('a deleted/unknown project id is a safe null (turn proceeds)', async () => {
    const conn = { walletAddress: WALLET, space: normalizeSpace({ id: 'deadbeefdeadbeef', kind: 'project', label: 'Gone' }) };
    expect(await _projectFilesSection(conn)).toBeNull();
  });

  test('no wallet → nothing (channel-bridge / unauthenticated connection)', async () => {
    const conn = { walletAddress: null, space: normalizeSpace({ id: 'x', kind: 'project', label: 'X' }) };
    expect(await _projectFilesSection(conn)).toBeNull();
  });
});
