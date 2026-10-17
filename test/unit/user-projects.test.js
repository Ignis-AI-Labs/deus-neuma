/**
 * Tests for user-projects — the per-wallet project store. Real filesystem
 * (temp realm root, like user-realm.test.js): create/activate/delete/pin all
 * round-trip through actual JSON files, and per-wallet isolation + the
 * inherited walletDir traversal guard are exercised for real, not mocked.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { setRealmRoot, walletDir } from '../../backend/services/user-realm.js';
import {
  readProjectStore, createProject, deleteProject, setActiveProject,
  getActiveProject, pinChat, unpinChat, addSharedFile, removeSharedFile,
  addFolder, removeFolder, setWorkingFolder, reconnectFolder, findProjectByFolder,
} from '../../backend/services/user-projects.js';
import { normalizeSpace } from '../../core/memory/space.js';

const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';

describe('user-projects — per-wallet realm store, real fs', () => {
  let folder;
  beforeEach(async () => {
    setRealmRoot(await createTempDir('user-projects'));
    folder = await createTempDir('proj-folder');
  });

  test('a wallet with no projects has an empty store', async () => {
    expect(await readProjectStore(W1)).toEqual({ activeProjectId: null, projects: [] });
  });

  test('the first project a wallet creates becomes active and persists', async () => {
    const p = await createProject(W1, { name: 'Core', folder });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('Core');
    expect(p.folder).toBe(folder);
    expect(p.pinnedChats).toEqual([]);
    const store = await readProjectStore(W1);
    expect(store.activeProjectId).toBe(p.id);
    expect(store.projects).toHaveLength(1);
  });

  test('create validates name and an absolute folder', async () => {
    await expect(createProject(W1, { name: '  ', folder })).rejects.toThrow(/name required/);
    await expect(createProject(W1, { name: 'x', folder: 'relative/path' })).rejects.toThrow(/absolute/);
  });

  test('projects are isolated per wallet', async () => {
    await createProject(W1, { name: 'A', folder });
    expect((await readProjectStore(W2)).projects).toHaveLength(0);
  });

  test('active project follows switches and falls back on delete', async () => {
    const a = await createProject(W1, { name: 'A', folder });
    // Distinct folder — single-ownership forbids two projects sharing one folder.
    const b = await createProject(W1, { name: 'B', folder: await createTempDir('proj-folder-b') });
    expect((await getActiveProject(W1)).id).toBe(a.id); // first stays active

    await setActiveProject(W1, b.id);
    expect((await getActiveProject(W1)).id).toBe(b.id);

    await deleteProject(W1, b.id); // active falls back to the remaining one
    expect((await getActiveProject(W1)).id).toBe(a.id);

    await deleteProject(W1, a.id); // none left → no active
    expect(await getActiveProject(W1)).toBeNull();
  });

  test('activating an unknown project is rejected', async () => {
    await expect(setActiveProject(W1, 'nope')).rejects.toThrow(/Unknown project/);
  });

  test('chats pin and unpin, deduped by neuma + session', async () => {
    const p = await createProject(W1, { name: 'A', folder });
    const chat = { neumaId: 'n1', companionName: 'Keir', sessionId: 'session-1', label: 'first' };
    await pinChat(W1, p.id, chat);
    await pinChat(W1, p.id, chat); // duplicate — ignored
    let proj = (await readProjectStore(W1)).projects[0];
    expect(proj.pinnedChats).toHaveLength(1);
    expect(proj.pinnedChats[0]).toMatchObject({ neumaId: 'n1', sessionId: 'session-1', label: 'first' });

    await unpinChat(W1, p.id, 'session-1', 'n1');
    proj = (await readProjectStore(W1)).projects[0];
    expect(proj.pinnedChats).toHaveLength(0);
  });

  test('pin requires a neumaId and sessionId', async () => {
    const p = await createProject(W1, { name: 'A', folder });
    await expect(pinChat(W1, p.id, { sessionId: 's' })).rejects.toThrow(/neumaId and sessionId/);
  });

  test('a malformed wallet is rejected by the inherited traversal guard', async () => {
    await expect(readProjectStore('not-a-wallet')).rejects.toThrow(/Invalid wallet/);
  });

  // A project IS an episodic space (kind: 'project'); the turn carries the
  // project id as the space id, and the backend pins the new chat back using
  // that space id (portal-stream _pinSessionToProject). That round-trip is only
  // sound if normalizeSpace leaves a real project id byte-identical. This locks
  // the invariant so a future project-id scheme can't silently break pinning.
  test('a project id survives normalizeSpace unchanged (space id === project id)', async () => {
    for (let i = 0; i < 25; i++) {
      const p = await createProject(W1, { name: `P${i}`, folder });
      expect(normalizeSpace({ id: p.id, kind: 'project', label: p.name }).id).toBe(p.id);
      await deleteProject(W1, p.id);
    }
  });

  describe('shared files (real fs, inside the project folder)', () => {
    test('a real file in the folder is added with its absolute path, deduped', async () => {
      const p = await createProject(W1, { name: 'A', folder });
      await fs.writeFile(path.join(folder, 'spec.md'), '# spec');
      await addSharedFile(W1, p.id, 'spec.md');       // relative to folder
      await addSharedFile(W1, p.id, path.join(folder, 'spec.md')); // absolute — dedup
      const stored = (await readProjectStore(W1)).projects[0];
      expect(stored.sharedFiles).toHaveLength(1);
      expect(stored.sharedFiles[0].path).toBe(path.join(folder, 'spec.md'));
      expect(stored.sharedFiles[0].addedAt).toBeTruthy();
    });

    test('a file outside the project folder is refused (traversal guard)', async () => {
      const p = await createProject(W1, { name: 'A', folder });
      const outside = await createTempDir('outside');
      await fs.writeFile(path.join(outside, 'secret.txt'), 'nope');
      await expect(addSharedFile(W1, p.id, path.join(outside, 'secret.txt')))
        .rejects.toThrow(/inside the project folder/);
      await expect(addSharedFile(W1, p.id, '../../etc/passwd'))
        .rejects.toThrow(/inside the project folder/);
    });

    test('a symlink inside the folder pointing OUTSIDE is refused (realpath guard)', async () => {
      const p = await createProject(W1, { name: 'A', folder });
      const outside = await createTempDir('outside-real');
      await fs.writeFile(path.join(outside, 'secret.txt'), 'exfil');
      // A link that is lexically inside the project folder but resolves outside.
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(folder, 'link.txt'));
      await expect(addSharedFile(W1, p.id, 'link.txt')).rejects.toThrow(/inside the project folder/);
      expect((await readProjectStore(W1)).projects[0].sharedFiles).toHaveLength(0);
    });

    test('a symlink inside the folder pointing to a file INSIDE it is allowed', async () => {
      const p = await createProject(W1, { name: 'A', folder });
      await fs.writeFile(path.join(folder, 'real.md'), '# real');
      await fs.symlink(path.join(folder, 'real.md'), path.join(folder, 'alias.md'));
      await addSharedFile(W1, p.id, 'alias.md');
      expect((await readProjectStore(W1)).projects[0].sharedFiles).toHaveLength(1);
    });

    test('a path inside the folder that does not exist is refused', async () => {
      const p = await createProject(W1, { name: 'A', folder });
      await expect(addSharedFile(W1, p.id, 'ghost.md')).rejects.toThrow(/not found/);
    });

    test('a directory is refused (only files are shareable)', async () => {
      const p = await createProject(W1, { name: 'A', folder });
      await fs.mkdir(path.join(folder, 'sub'));
      await expect(addSharedFile(W1, p.id, 'sub')).rejects.toThrow(/not found/);
    });

    test('remove drops the file; a file deleted from disk is still unlistable', async () => {
      const p = await createProject(W1, { name: 'A', folder });
      await fs.writeFile(path.join(folder, 'a.txt'), 'a');
      await fs.writeFile(path.join(folder, 'b.txt'), 'b');
      await addSharedFile(W1, p.id, 'a.txt');
      await addSharedFile(W1, p.id, 'b.txt');
      await fs.rm(path.join(folder, 'a.txt')); // gone from disk
      await removeSharedFile(W1, p.id, path.join(folder, 'a.txt')); // still removable
      const stored = (await readProjectStore(W1)).projects[0];
      expect(stored.sharedFiles.map((f) => path.basename(f.path))).toEqual(['b.txt']);
    });

    test('adding to an unknown project is rejected', async () => {
      await expect(addSharedFile(W1, 'nope', 'x')).rejects.toThrow(/Unknown project/);
    });
  });

  describe('multiple folders / repositories per project (real fs)', () => {
    test('a new project seeds folders[] from its one folder, which is the cwd', async () => {
      const p = await createProject(W1, { name: 'Core', folder });
      expect(p.folders).toEqual([{ path: folder, addedAt: p.createdAt }]);
      expect(p.folder).toBe(folder); // working folder
    });

    test('a legacy project (only `folder`) is migrated to folders[] on read', async () => {
      // Write a pre-multi-folder store by hand, then read it back.
      const legacy = {
        activeProjectId: 'leg1',
        projects: [{ id: 'leg1', name: 'Old', folder, createdAt: '2026-01-01T00:00:00Z', pinnedChats: [] }],
      };
      await fs.mkdir(walletDir(W1), { recursive: true });
      await fs.writeFile(path.join(walletDir(W1), 'projects.json'), JSON.stringify(legacy));
      const stored = (await readProjectStore(W1)).projects[0];
      expect(stored.folders).toEqual([{ path: folder, addedAt: '2026-01-01T00:00:00Z' }]);
      expect(stored.folder).toBe(folder);
    });

    test('addFolder attaches more folders, deduped, without moving the cwd', async () => {
      const p = await createProject(W1, { name: 'Core', folder });
      const second = await createTempDir('second');
      await addFolder(W1, p.id, second);
      await addFolder(W1, p.id, second); // dedup
      const stored = (await readProjectStore(W1)).projects[0];
      expect(stored.folders.map((f) => f.path)).toEqual([folder, second]);
      expect(stored.folder).toBe(folder); // cwd unchanged by attach
    });

    test('addFolder rejects a relative path and an unknown project', async () => {
      const p = await createProject(W1, { name: 'Core', folder });
      await expect(addFolder(W1, p.id, 'rel/path')).rejects.toThrow(/absolute/);
      await expect(addFolder(W1, 'nope', folder)).rejects.toThrow(/Unknown project/);
    });

    test('createProject refuses a folder already owned by another project', async () => {
      const a = await createProject(W1, { name: 'A', folder });
      await expect(createProject(W1, { name: 'B', folder }))
        .rejects.toMatchObject({ message: /another project/, conflict: a.id });
    });

    test('addFolder refuses a folder owned by another project, carrying its id', async () => {
      const a = await createProject(W1, { name: 'A', folder });
      const other = await createTempDir('owned');
      const b = await createProject(W1, { name: 'B', folder: other });
      await expect(addFolder(W1, a.id, other)).rejects.toMatchObject({
        message: /another project/, conflict: b.id,
      });
    });

    test('setWorkingFolder moves the cwd among attached folders only', async () => {
      const p = await createProject(W1, { name: 'Core', folder });
      const second = await createTempDir('second');
      await addFolder(W1, p.id, second);
      await setWorkingFolder(W1, p.id, second);
      expect((await readProjectStore(W1)).projects[0].folder).toBe(second);
      const stranger = await createTempDir('stranger');
      await expect(setWorkingFolder(W1, p.id, stranger)).rejects.toThrow(/not attached/);
    });

    test('removeFolder detaches, keeps at least one, and resets the cwd if needed', async () => {
      const p = await createProject(W1, { name: 'Core', folder });
      const second = await createTempDir('second');
      await addFolder(W1, p.id, second);
      await setWorkingFolder(W1, p.id, second); // cwd = second
      await removeFolder(W1, p.id, second);     // removing the cwd
      const stored = (await readProjectStore(W1)).projects[0];
      expect(stored.folders.map((f) => f.path)).toEqual([folder]);
      expect(stored.folder).toBe(folder); // cwd fell back
      await expect(removeFolder(W1, p.id, folder)).rejects.toThrow(/at least one folder/);
    });

    test('reconnectFolder moves a folder between projects and makes it the cwd', async () => {
      const a = await createProject(W1, { name: 'A', folder });
      const shared = await createTempDir('shared');
      await addFolder(W1, a.id, shared);          // a: [folder, shared]
      const b = await createProject(W1, { name: 'B', folder: await createTempDir('b-root') });
      await reconnectFolder(W1, b.id, shared);    // move shared → b
      const store = await readProjectStore(W1);
      const pa = store.projects.find((p) => p.id === a.id);
      const pb = store.projects.find((p) => p.id === b.id);
      expect(pa.folders.map((f) => f.path)).toEqual([folder]);
      expect(pb.folders.map((f) => f.path)).toContain(shared);
      expect(pb.folder).toBe(shared); // reconnect adopts it as the working folder
    });

    test('reconnectFolder refuses to empty another project', async () => {
      const a = await createProject(W1, { name: 'A', folder }); // folder is a's ONLY folder
      const b = await createProject(W1, { name: 'B', folder: await createTempDir('b-root') });
      await expect(reconnectFolder(W1, b.id, folder)).rejects.toThrow(/only folder/);
    });

    test('findProjectByFolder reports the owning project and whether it is active', async () => {
      const a = await createProject(W1, { name: 'A', folder });     // active (first)
      const other = await createTempDir('owned');
      const b = await createProject(W1, { name: 'B', folder: other });
      expect(await findProjectByFolder(W1, folder)).toMatchObject({ id: a.id, isActive: true });
      expect(await findProjectByFolder(W1, other)).toMatchObject({ id: b.id, isActive: false });
      expect(await findProjectByFolder(W1, await createTempDir('unbound'))).toBeNull();
    });
  });
  describe('concurrent mutations — the store must never tear or lose updates', () => {
    test('parallel creates all land and the store stays parseable', async () => {
      const dirs = [];
      for (let i = 0; i < 8; i += 1) dirs.push(await createTempDir(`race-c${i}`));
      const made = await Promise.all(dirs.map((d, i) => createProject(W1, { name: `race-${i}`, folder: d })));
      expect(new Set(made.map((p) => p.id)).size).toBe(8);
      const store = await readProjectStore(W1); // a torn file would throw here
      expect(store.projects).toHaveLength(8);
    });

    test('parallel deletes leave an empty, valid store — the exact shape that tore the live one', async () => {
      const made = [];
      for (let i = 0; i < 8; i += 1) {
        made.push(await createProject(W1, { name: `race-d${i}`, folder: await createTempDir(`race-d${i}`) }));
      }
      // Fired all at once: unserialized read-modify-write here corrupted a real
      // witness store in production (valid JSON + a torn trailing brace).
      await Promise.all(made.map((p) => deleteProject(W1, p.id)));
      const store = await readProjectStore(W1);
      expect(store.projects).toEqual([]);
      expect(store.activeProjectId).toBeNull();
    });
  });
});
