/**
 * THE NATIVE FILESYSTEM ORGAN — end-to-end proof (RULE 0: real filesystem,
 * real dispatch through mcpService, no mock anywhere in the claimed path).
 *
 * The organ replaced the spawned @modelcontextprotocol/server-filesystem
 * child on 2026-08-15 after a power-loss reboot left the child dead and
 * every file tool answering "Not connected". These tests prove the same
 * tool surface, the same allowed-roots wall (the package's own lib.js), and
 * the property the child could never have: roots re-declare in-process with
 * no transport to lose.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';

const SERVER = 'filesystem';
const textOf = (result) => result.content?.find((c) => c.type === 'text')?.text;

describe('Native filesystem organ', () => {
  let root;
  let outside;

  beforeAll(async () => {
    root = await createTempDir('native-fs-root');
    outside = await createTempDir('native-fs-outside');
    // No trailing newline: tailFile counts a trailing empty line as the last
    // line (upstream lib.js semantics, identical under the child).
    await fs.writeFile(path.join(root, 'hello.txt'), 'line one\nline two\nline three');
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    await fs.writeFile(path.join(root, 'sub', 'nested.txt'), 'nested content');
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside the wall');

    await setNativeFilesystemRoots([root]);
    mcpService.registerNativeServer(SERVER, nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect(SERVER);
  });

  describe('Registration — the organ wears the filesystem name', () => {
    test('clients map holds the organ under the platform-managed name', () => {
      expect(mcpService.clients.has(SERVER)).toBe(true);
    });

    test('all 16 tools advertise through getToolsContext with descriptions and schemas', () => {
      const advertised = mcpService.getToolsContext().available_tools
        .filter((t) => t.server === SERVER);
      expect(advertised.map((t) => t.name).sort()).toEqual([
        'copy_file', 'create_directory', 'directory_tree', 'edit_file', 'get_file_info',
        'list_allowed_directories', 'list_directory', 'list_directory_with_sizes',
        'move_file', 'read_file', 'read_media_file', 'read_multiple_files',
        'read_text_file', 'search_content', 'search_files', 'write_file',
      ]);
      for (const t of advertised) {
        expect(t.description).toBeTruthy();
        expect(t.inputSchema?.type).toBe('object');
      }
    });

  });

  describe('Read operations', () => {
    test('read_text_file returns real content', async () => {
      const result = await mcpService.callTool(SERVER, 'read_text_file', {
        path: path.join(root, 'hello.txt'),
      });
      expect(textOf(result)).toContain('line two');
    });

    test('read_text_file head and tail slice the file', async () => {
      const head = await mcpService.callTool(SERVER, 'read_text_file', {
        path: path.join(root, 'hello.txt'), head: 1,
      });
      expect(textOf(head).trim()).toBe('line one');
      const tail = await mcpService.callTool(SERVER, 'read_text_file', {
        path: path.join(root, 'hello.txt'), tail: 1,
      });
      expect(textOf(tail).trim()).toBe('line three');
    });

    test('read_file (deprecated alias) still answers', async () => {
      const result = await mcpService.callTool(SERVER, 'read_file', {
        path: path.join(root, 'sub', 'nested.txt'),
      });
      expect(textOf(result)).toBe('nested content');
    });

    test('read_multiple_files carries per-file errors without failing the batch', async () => {
      const result = await mcpService.callTool(SERVER, 'read_multiple_files', {
        paths: [path.join(root, 'hello.txt'), path.join(root, 'missing.txt')],
      });
      const text = textOf(result);
      expect(text).toContain('line one');
      expect(text).toContain('missing.txt: Error -');
      expect(result.isError).toBeUndefined();
    });

    test('read_media_file returns a base64 image block', async () => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await fs.writeFile(path.join(root, 'dot.png'), bytes);
      const result = await mcpService.callTool(SERVER, 'read_media_file', {
        path: path.join(root, 'dot.png'),
      });
      const block = result.content[0];
      expect(block.type).toBe('image');
      expect(block.mimeType).toBe('image/png');
      expect(Buffer.from(block.data, 'base64').equals(bytes)).toBe(true);
    });

    test('read of a missing file is an isError result, never a throw', async () => {
      const result = await mcpService.callTool(SERVER, 'read_text_file', {
        path: path.join(root, 'does-not-exist.txt'),
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('Write operations — the Galen proof, on disk', () => {
    test('write_file lands real bytes on the real disk', async () => {
      const target = path.join(root, 'authored.txt');
      const result = await mcpService.callTool(SERVER, 'write_file', {
        path: target, content: 'I choose this name',
      });
      expect(result.isError).toBeUndefined();
      expect(await fs.readFile(target, 'utf-8')).toBe('I choose this name');
    });

    test('write_file replaces atomically only with explicit intent and the current stamp', async () => {
      const target = path.join(root, 'authored.txt');
      const expectedMtimeMs = (await fs.stat(target)).mtimeMs;
      const result = await mcpService.callTool(SERVER, 'write_file', {
        path: target, content: 'revised', overwrite: true, expectedMtimeMs,
      });
      expect(result.isError).toBeUndefined();
      expect(await fs.readFile(target, 'utf-8')).toBe('revised');
    });

    test('edit_file applies an anchored edit and reports a diff (direct-caller parity)', async () => {
      const target = path.join(root, 'editable.txt');
      await fs.writeFile(target, 'alpha\nbeta\ngamma\n');
      const result = await mcpService.callTool(SERVER, 'edit_file', {
        path: target, edits: [{ oldText: 'beta', newText: 'delta' }],
      });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('-beta');
      expect(await fs.readFile(target, 'utf-8')).toBe('alpha\ndelta\ngamma\n');
    });

    test('create_directory then move_file relocate for real', async () => {
      const made = await mcpService.callTool(SERVER, 'create_directory', { path: path.join(root, 'made') });
      expect(made.isError).toBeUndefined();
      const deep = await mcpService.callTool(SERVER, 'create_directory', { path: path.join(root, 'made', 'deep') });
      expect(deep.isError).toBeUndefined();
      await mcpService.callTool(SERVER, 'move_file', {
        source: path.join(root, 'editable.txt'),
        destination: path.join(root, 'made', 'deep', 'moved.txt'),
      });
      expect(await fs.readFile(path.join(root, 'made', 'deep', 'moved.txt'), 'utf-8')).toContain('delta');
    });

    test('copy_file keeps the source and refuses an occupied destination', async () => {
      const src = path.join(root, 'hello.txt');
      const dest = path.join(root, 'sub', 'hello-copy.txt');
      const copied = await mcpService.callTool(SERVER, 'copy_file', { source: src, destination: dest });
      expect(copied.isError).toBeUndefined();
      expect(await fs.readFile(dest, 'utf-8')).toBe(await fs.readFile(src, 'utf-8'));
      const clash = await mcpService.callTool(SERVER, 'copy_file', { source: src, destination: dest });
      expect(clash.isError).toBe(true);
    });

  });

  describe('Listing and inspection', () => {
    test('list_directory marks files and directories', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'list_directory', { path: root }));
      expect(text).toContain('[FILE] hello.txt');
      expect(text).toContain('[DIR] sub');
    });

    test('an empty directory says it is empty, not refused', async () => {
      const empty = path.join(root, 'void');
      await fs.mkdir(empty);
      const text = textOf(await mcpService.callTool(SERVER, 'list_directory', { path: empty }));
      expect(text).toContain('empty directory');
      expect(text).toContain('not a refusal');
    });


    test('list_directory_with_sizes carries sizes and a summary', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'list_directory_with_sizes', { path: root }));
      expect(text).toContain('hello.txt');
      expect(text).toMatch(/Total: \d+ files, \d+ directories/);
    });

    test('directory_tree — the tool that died for Cael — returns real JSON with excludes', async () => {
      const result = await mcpService.callTool(SERVER, 'directory_tree', {
        path: root, excludePatterns: ['made'],
      });
      const tree = JSON.parse(textOf(result));
      const names = tree.map((e) => e.name);
      expect(names).toContain('sub');
      expect(names).not.toContain('made');
      const sub = tree.find((e) => e.name === 'sub');
      expect(sub.type).toBe('directory');
      expect(sub.children.map((c) => c.name)).toContain('nested.txt');
    });

    test('search_files finds by glob', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'search_files', {
        path: root, pattern: '**/*.txt',
      }));
      expect(text).toContain('nested.txt');
    });

    test('search_files finds a nested name from *.ext or a fragment', async () => {
      const byExt = textOf(await mcpService.callTool(SERVER, 'search_files', {
        path: root, pattern: '*.txt',
      }));
      expect(byExt).toContain('nested.txt');
      const byName = textOf(await mcpService.callTool(SERVER, 'search_files', {
        path: root, pattern: 'nested',
      }));
      expect(byName).toContain('nested.txt');
    });



    test('get_file_info reports real stats', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'get_file_info', {
        path: path.join(root, 'hello.txt'),
      }));
      expect(text).toContain('isFile: true');
      expect(text).toMatch(/size: \d+/);
    });

    test('list_allowed_directories names the standing roots', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'list_allowed_directories', {}));
      expect(text).toContain('Allowed directories:');
      expect(text).toContain(path.basename(root));
    });
  });

  describe('search_content — grep inside the wall', () => {
    let base;

    beforeAll(async () => {
      base = path.join(root, 'grepland');
      await fs.mkdir(path.join(base, 'src'), { recursive: true });
      await fs.mkdir(path.join(base, 'node_modules', 'dep'), { recursive: true });
      await fs.writeFile(path.join(base, 'src', 'engine.js'), 'const ignite = () => {\n  return runBenchmark();\n};\n');
      await fs.writeFile(path.join(base, 'notes.md'), 'runbenchmark is described here\nplain line\n');
      await fs.writeFile(path.join(base, 'node_modules', 'dep', 'index.js'), 'module.exports = runBenchmark;\n');
      // NUL byte in the head marks a binary; the needle bytes follow it.
      await fs.writeFile(path.join(base, 'blob.bin'), Buffer.concat([Buffer.of(0), Buffer.from('runBenchmark')]));
      await fs.writeFile(path.join(outside, 'leak.js'), 'runBenchmark leaks\n');
      await fs.symlink(outside, path.join(base, 'sneaky-dir'));
    });

    test('a literal needle comes back as path:line: text', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'search_content', {
        path: base, pattern: 'runBenchmark',
      }));
      expect(text).toContain(`${path.join(base, 'src', 'engine.js')}:2:`);
      expect(text).toContain('return runBenchmark();');
    });

    test('name search: node_modules hides by default, the wall holds, the result cut is reported', async () => {
      const defaults = textOf(await mcpService.callTool(SERVER, 'search_files', { path: base, pattern: '*.js' }));
      expect(defaults).toContain(path.join(base, 'src', 'engine.js'));
      expect(defaults).not.toContain(path.join('node_modules', 'dep'));
      expect(defaults).not.toContain('leak.js');
      expect(defaults).toContain('excluded from this walk: node_modules');
      const explicit = textOf(await mcpService.callTool(SERVER, 'search_files', {
        path: base, pattern: '*.js', excludePatterns: [],
      }));
      expect(explicit).toContain(path.join('node_modules', 'dep', 'index.js'));
      const many = path.join(base, 'many');
      await fs.mkdir(many);
      await Promise.all(Array.from({ length: 205 }, (_, i) => fs.writeFile(path.join(many, `m${i}.log`), '')));
      const capped = textOf(await mcpService.callTool(SERVER, 'search_files', { path: many, pattern: '*.log' }));
      expect(capped.split('\n').filter((l) => l.endsWith('.log'))).toHaveLength(200);
      expect(capped).toContain('[stopped at 200 matches');
    });

    test('node_modules hides by default, opens with explicit excludePatterns', async () => {
      const defaults = textOf(await mcpService.callTool(SERVER, 'search_content', {
        path: base, pattern: 'runBenchmark',
      }));
      expect(defaults).not.toContain(path.join('node_modules', 'dep'));
      expect(defaults).toContain('excluded from this walk: node_modules');
      const explicit = textOf(await mcpService.callTool(SERVER, 'search_content', {
        path: base, pattern: 'runBenchmark', excludePatterns: [],
      }));
      expect(explicit).toContain(path.join('node_modules', 'dep', 'index.js'));
    });


    test('regex and ignoreCase widen the match', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'search_content', {
        path: base, pattern: '^RUNBENCHMARK', regex: true, ignoreCase: true,
      }));
      expect(text).toContain(`${path.join(base, 'notes.md')}:1:`);
    });

    test('an invalid regex is an isError result, never a throw', async () => {
      const result = await mcpService.callTool(SERVER, 'search_content', {
        path: base, pattern: '(', regex: true,
      });
      expect(result.isError).toBe(true);
    });

    test('filePattern narrows the scanned set', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'search_content', {
        path: base, pattern: 'runbenchmark', ignoreCase: true, filePattern: '*.md',
      }));
      expect(text).toContain('notes.md');
      expect(text).not.toContain('engine.js');
    });

    test('binary files never match; a symlink out of the wall never leaks', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'search_content', {
        path: base, pattern: 'runBenchmark', excludePatterns: [],
      }));
      expect(text).not.toContain('blob.bin');
      expect(text).not.toContain('leak.js');
    });

    test('maxResults truncates with an honest note', async () => {
      const text = textOf(await mcpService.callTool(SERVER, 'search_content', {
        path: base, pattern: 'runbenchmark', ignoreCase: true, excludePatterns: [], maxResults: 2,
      }));
      expect(text.split('\n').filter((l) => l.includes(`${base}${path.sep}`)).length).toBe(2);
      expect(text).toContain('[stopped at 2 matching lines');
    });

    test('a search rooted outside the wall is refused', async () => {
      const result = await mcpService.callTool(SERVER, 'search_content', {
        path: outside, pattern: 'anything',
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Access denied');
    });
  });

  describe('The wall — lib.js validation runs in-process, unchanged', () => {
    test('read outside allowed roots is refused', async () => {
      const result = await mcpService.callTool(SERVER, 'read_text_file', {
        path: path.join(outside, 'secret.txt'),
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Access denied');
      expect(textOf(result)).toContain('grant wall');
    });


    test('a missing path names absence, not a policy deny', async () => {
      const result = await mcpService.callTool(SERVER, 'read_text_file', {
        path: path.join(root, 'never-was.txt'),
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/ENOENT|no such file/i);
      expect(textOf(result)).toContain('does not exist');
      expect(textOf(result)).not.toContain('grant wall');
    });


    test('write outside allowed roots is refused, nothing lands', async () => {
      const escape = path.join(outside, 'escape.txt');
      const result = await mcpService.callTool(SERVER, 'write_file', {
        path: escape, content: 'should never land',
      });
      expect(result.isError).toBe(true);
      await expect(fs.access(escape)).rejects.toThrow();
    });

    test('a symlink pointing outside the wall is refused', async () => {
      const link = path.join(root, 'sneaky-link.txt');
      await fs.symlink(path.join(outside, 'secret.txt'), link);
      const result = await mcpService.callTool(SERVER, 'read_text_file', { path: link });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Access denied');
    });

    test('an unknown tool name is an isError result', async () => {
      const result = await mcpService.callTool(SERVER, 'summon_root_shell', {});
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Unknown filesystem tool');
    });
  });

  describe('Roots re-declare in-process — the property the child never had', () => {
    test('widening the wall admits a formerly refused root, no reconnect anywhere', async () => {
      await setNativeFilesystemRoots([root, outside]);
      const result = await mcpService.callTool(SERVER, 'read_text_file', {
        path: path.join(outside, 'secret.txt'),
      });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toBe('outside the wall');
    });

    test('a missing directory offered as a root is skipped, not fatal', async () => {
      const roots = await setNativeFilesystemRoots([root, path.join(outside, 'never-made')]);
      expect(roots.some((r) => r.endsWith('never-made'))).toBe(false);
      expect(roots.length).toBeGreaterThan(0);
    });
  });
});
