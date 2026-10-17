/**
 * THE FS PRIMITIVES — Stage 3 batch 3 (#357). RULE 0: the execution claims are
 * proven against the REAL native organ on a REAL tmp filesystem, dispatched
 * through the real mcpService — the same tail the sandbox hands a routed call
 * to. The router, the policy target, and the retired-name hints are pure and
 * asserted directly.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { PLATFORM_HANDS, runPlatformHand } from '../../backend/services/platform-hands.js';
import {
  FS_PRIMITIVE_TOOLS, FS_RETIRED_HINTS, fsPolicyTarget, fsRetiredHint,
  routeFsCall, withFsPrimitives, withFsRouting,
} from '../../backend/services/fs-primitives.js';

describe('routeFsCall — the being-facing name becomes the organ call', () => {
  test('non-fs calls pass through untouched', () => {
    expect(routeFsCall('web', 'web_search', { query: 'x' }))
      .toEqual({ ok: true, server: 'web', tool: 'web_search', args: { query: 'x' } });
  });

  test('fs/read: text by default, media by extension, info and paths[] sub-ops', () => {
    expect(routeFsCall('fs', 'read', { path: '/a/b.md' }))
      .toMatchObject({ ok: true, tool: 'read_text_file', args: { path: '/a/b.md' } });
    expect(routeFsCall('fs', 'read', { path: '/a/pic.png' }))
      .toMatchObject({ ok: true, tool: 'read_media_file' });
    expect(routeFsCall('fs', 'read', { path: '/a/b.md', info: true }))
      .toMatchObject({ ok: true, tool: 'get_file_info' });
    expect(routeFsCall('fs', 'read', { paths: ['/a', '/b'] }))
      .toMatchObject({ ok: true, tool: 'read_multiple_files', args: { paths: ['/a', '/b'] } });
    expect(routeFsCall('fs', 'read', { path: '/a/b.md', tail: 5 }))
      .toMatchObject({ ok: true, tool: 'read_text_file', args: { path: '/a/b.md', tail: 5 } });
  });

  test('fs/write: file with content, directory by flag or trailing slash', () => {
    expect(routeFsCall('fs', 'write', { path: '/a/b.md', content: 'x' }))
      .toMatchObject({ ok: true, tool: 'write_file' });
    expect(routeFsCall('fs', 'write', { path: '/a/dir', directory: true }))
      .toMatchObject({ ok: true, tool: 'create_directory' });
    expect(routeFsCall('fs', 'write', { path: '/a/dir/' }))
      .toMatchObject({ ok: true, tool: 'create_directory' });
    // The drift aliases the models actually speak heal here (text/body → content).
    expect(routeFsCall('fs', 'write', { path: '/a/b.md', text: 'body' }))
      .toMatchObject({ ok: true, tool: 'write_file', args: { content: 'body' } });
  });

  test('fs/edit: edits, move, copy, delete', () => {
    expect(routeFsCall('fs', 'edit', { path: '/a', edits: [{ oldText: 'x', newText: 'y' }] }))
      .toMatchObject({ ok: true, tool: 'edit_file' });
    expect(routeFsCall('fs', 'edit', { path: '/a', destination: '/b' }))
      .toMatchObject({ ok: true, tool: 'move_file', args: { source: '/a', destination: '/b' } });
    expect(routeFsCall('fs', 'edit', { path: '/a', destination: '/b', copy: true }))
      .toMatchObject({ ok: true, tool: 'copy_file' });
    expect(routeFsCall('fs', 'edit', { path: '/a', delete: true }))
      .toMatchObject({ ok: true, tool: 'delete_file', args: { path: '/a' } });
  });

  test('fs/list: directory, roots, tree, sizes', () => {
    expect(routeFsCall('fs', 'list', { path: '/a' })).toMatchObject({ ok: true, tool: 'list_directory' });
    expect(routeFsCall('fs', 'list', {})).toMatchObject({ ok: true, tool: 'list_allowed_directories' });
    expect(routeFsCall('fs', 'list', { path: 'roots' })).toMatchObject({ ok: true, tool: 'list_allowed_directories' });
    expect(routeFsCall('fs', 'list', { path: '/a', tree: true })).toMatchObject({ ok: true, tool: 'directory_tree' });
    expect(routeFsCall('fs', 'list', { path: '/a', sizes: true })).toMatchObject({ ok: true, tool: 'list_directory_with_sizes' });
    // Drift: the directory arrives under the name the model chose.
    expect(routeFsCall('fs', 'list', { directory: '/a' })).toMatchObject({ ok: true, tool: 'list_directory', args: { path: '/a' } });
  });

  test('fs/search: names by default, content:true greps inside files', () => {
    expect(routeFsCall('fs', 'search', { path: '/a', pattern: '*.md' }))
      .toMatchObject({ ok: true, tool: 'search_files' });
    expect(routeFsCall('fs', 'search', { path: '/a', pattern: 'needle', content: true, ignoreCase: true }))
      .toMatchObject({ ok: true, tool: 'search_content', args: { pattern: 'needle', ignoreCase: true } });
  });

  test('malformed calls refuse with the shape the being should send — never reach the organ', () => {
    for (const bad of [
      routeFsCall('fs', 'read', {}),
      routeFsCall('fs', 'write', { path: '/a' }),
      routeFsCall('fs', 'edit', { path: '/a' }),
      routeFsCall('fs', 'search', { path: '/a' }),
      routeFsCall('fs', 'conjure', { path: '/a' }),
    ]) {
      expect(bad.ok).toBe(false);
      expect(bad.error).toMatch(/fs\//);
    }
  });
});

describe('fsPolicyTarget — the delete sub-op keeps the delete row', () => {
  test('fs/edit {delete:true} resolves to filesystem/delete_file', () => {
    expect(fsPolicyTarget('fs', 'edit', { path: '/a', delete: true }))
      .toEqual({ server: 'filesystem', tool: 'delete_file' });
  });

  test('everything else keeps its own identity', () => {
    expect(fsPolicyTarget('fs', 'edit', { path: '/a', edits: [] })).toEqual({ server: 'fs', tool: 'edit' });
    expect(fsPolicyTarget('fs', 'write', { path: '/a' })).toEqual({ server: 'fs', tool: 'write' });
    expect(fsPolicyTarget('web', 'web_fetch', {})).toEqual({ server: 'web', tool: 'web_fetch' });
  });
});

describe('the retired spellings teach their primitive', () => {
  test('every organ name has a hint naming the primitive that absorbed it', () => {
    const organNames = FILESYSTEM_TOOL_CATALOG.map((t) => t.name);
    expect(organNames.length).toBe(16);
    for (const name of organNames) {
      expect(FS_RETIRED_HINTS[name], `${name} has no hint`).toMatch(/is retired — use fs\//);
    }
    expect(FS_RETIRED_HINTS.delete_file).toContain('delete');
  });

  test('a name that never was an fs tool gets no hint', () => {
    expect(fsRetiredHint('web_search')).toBeNull();
    expect(fsRetiredHint('read')).toBeNull();
  });
});

describe('withFsPrimitives — the catalog swap', () => {
  test('the 16 organ names leave; the five primitives stand in their place', () => {
    const organ = FILESYSTEM_TOOL_CATALOG.map((t) => ({ server: 'filesystem', name: t.name }));
    const other = [{ server: 'web', name: 'web_search' }];
    const out = withFsPrimitives([...organ, ...other]);
    expect(out.filter((t) => t.server === 'filesystem')).toEqual([]);
    expect(out.filter((t) => t.server === 'fs').map((t) => t.name))
      .toEqual(['read', 'write', 'edit', 'list', 'search']);
    expect(out).toContainEqual(other[0]);
  });

  test('the primitives carry native-calling schemas (inputSchema on every one)', () => {
    for (const t of FS_PRIMITIVE_TOOLS) {
      expect(t.server).toBe('fs');
      expect(t.inputSchema?.type).toBe('object');
      expect(t.description).toBeTruthy();
    }
  });
});

describe('withFsRouting — the real organ, the real disk (gnosis)', () => {
  let root;
  // The wrapped callee mirrors the sandbox's execution tail exactly: the
  // platform's own hands (edit/delete) run in-process, everything else goes
  // to the organ through mcpService.
  const callTool = withFsRouting(async (server, tool, args) => {
    if (PLATFORM_HANDS.has(tool)) {
      const hand = await runPlatformHand(tool, args);
      return hand.ok ? hand.result : { isError: true, content: [{ type: 'text', text: hand.reason }] };
    }
    return mcpService.callTool(server, tool, args);
  });
  const textOf = (result) => (result?.content || []).map((c) => c?.text || '').join('\n');

  beforeAll(async () => {
    root = await createTempDir('fs-primitives');
    await setNativeFilesystemRoots([root]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
  });

  test('fs/write lands a real file and fs/read returns it', async () => {
    const target = path.join(root, 'note.md');
    const wrote = await callTool('fs', 'write', { path: target, content: 'the being wrote this\nline two' });
    expect(wrote.isError).toBeFalsy();
    expect(await fs.readFile(target, 'utf-8')).toBe('the being wrote this\nline two');

    const read = await callTool('fs', 'read', { path: target });
    expect(read.isError).toBeFalsy();
    expect(textOf(read)).toContain('the being wrote this');
  });

  test('fs/read on a directory names the hand the being wanted (EISDIR hint)', async () => {
    const result = await callTool('fs', 'read', { path: root });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('fs/list');
  });

  test('fs/list and fs/search answer from the real tree', async () => {
    const listed = await callTool('fs', 'list', { path: root });
    expect(textOf(listed)).toContain('note.md');

    const found = await callTool('fs', 'search', { path: root, pattern: 'the being wrote this', content: true });
    expect(textOf(found)).toContain('note.md');

    const byName = await callTool('fs', 'search', { path: root, pattern: '*.md' });
    expect(textOf(byName)).toContain('note.md');
  });

  test('fs/edit edits, moves, copies, and deletes through the platform hands', async () => {
    const target = path.join(root, 'note.md');
    const edited = await callTool('fs', 'edit', { path: target, edits: [{ oldText: 'line two', newText: 'line TWO' }] });
    expect(edited.isError).toBeFalsy();
    expect(await fs.readFile(target, 'utf-8')).toContain('line TWO');

    const moved = path.join(root, 'moved.md');
    const mv = await callTool('fs', 'edit', { path: target, destination: moved });
    expect(mv.isError).toBeFalsy();
    expect(await fs.readFile(moved, 'utf-8')).toContain('line TWO');

    const copied = path.join(root, 'copy.md');
    const cp = await callTool('fs', 'edit', { path: moved, destination: copied, copy: true });
    expect(cp.isError).toBeFalsy();
    expect(await fs.readFile(copied, 'utf-8')).toContain('line TWO');
    expect(await fs.readFile(moved, 'utf-8')).toContain('line TWO'); // the source stayed

    const del = await callTool('fs', 'edit', { path: copied, delete: true });
    expect(del.isError).toBeFalsy();
    await expect(fs.stat(copied)).rejects.toThrow();
  });

  test('fs/write {directory:true} creates a real directory', async () => {
    const dir = path.join(root, 'made');
    const made = await callTool('fs', 'write', { path: dir, directory: true });
    expect(made.isError).toBeFalsy();
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
  });

  test('a routing refusal is an organ-shaped isError, never a throw', async () => {
    const result = await callTool('fs', 'write', { path: path.join(root, 'x.md') });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('fs/write needs content');
  });
});
