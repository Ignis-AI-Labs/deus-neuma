import { describe, it, test, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import {
  checkPathAccess, checkWriteBudget, recordWrite, isWriteOperation,
  collectPathArgs, findUngrantedReadPaths, resolveGrantDir,
  findUngrantedWritePaths, isWithinRoots,
} from '../../backend/services/tool-sandbox.js';
import { writePayloadBytes, checkWorkspaceBudget } from '../../backend/services/write-metering.js';

// NOTE: createSandboxedCallTool is NOT unit-tested here with a fake mcpService.
// Mocking the execution boundary (mcpService.callTool) is forbidden (AGENTS.md
// RULE 0) — a fake that returns 'ok' is exactly what let a broken write pass as
// "verified". The full sandbox is proven against the REAL MCP filesystem server
// on real disk in test/integration/sandbox-lane-boundary.test.js. Only the pure
// functions below (no mock anywhere on the path) are unit-tested here.

describe('checkPathAccess', () => {
  it('blocks .env files', () => {
    expect(checkPathAccess('/project/.env').allowed).toBe(false);
    expect(checkPathAccess('.env').allowed).toBe(false);
  });

  it('blocks vault directory', () => {
    expect(checkPathAccess('vault/dna/active.json').allowed).toBe(false);
  });

  it('blocks .git directory', () => {
    expect(checkPathAccess('/project/.git/config').allowed).toBe(false);
  });

  it('blocks node_modules', () => {
    expect(checkPathAccess('node_modules/package/index.js').allowed).toBe(false);
  });

  it('blocks .ssh directory', () => {
    expect(checkPathAccess('/home/user/.ssh/id_rsa').allowed).toBe(false);
  });

  it('blocks .pem files', () => {
    expect(checkPathAccess('/keys/server.pem').allowed).toBe(false);
  });

  it('allows normal paths', () => {
    expect(checkPathAccess('/project/src/index.js').allowed).toBe(true);
    expect(checkPathAccess('data/readme.md').allowed).toBe(true);
  });

  it('returns false for invalid paths', () => {
    expect(checkPathAccess(null).allowed).toBe(false);
    expect(checkPathAccess('').allowed).toBe(false);
  });

  it('enforces allowed roots when specified', () => {
    const result = checkPathAccess('/etc/passwd', ['/project']);
    expect(result.allowed).toBe(false);
  });

  it('fails closed for a write with no confined root (never unconfined)', () => {
    // requireRoot models a write operation: an empty root list must DENY, so a
    // birth-time write before any workspace exists can never reach the project.
    expect(checkPathAccess('data/temp/x.txt', [], { requireRoot: true }).allowed).toBe(false);
    // A read (requireRoot false) with no root still passes (denied-paths apply).
    expect(checkPathAccess('src/index.js', [], { requireRoot: false }).allowed).toBe(true);
  });

  it('contains within a root, with a separator boundary', () => {
    expect(checkPathAccess('/x/data/file.txt', ['/x/data']).allowed).toBe(true);
    expect(checkPathAccess('/x/data', ['/x/data']).allowed).toBe(true);
    // A sibling dir that merely shares a prefix is NOT inside the root.
    expect(checkPathAccess('/x/database/secret', ['/x/data']).allowed).toBe(false);
  });

  it('marks ONLY an out-of-root READ as grantable', () => {
    // The one denial a witness may lift: a read outside the confined roots.
    expect(checkPathAccess('/proc/cpuinfo', ['/house/lane']).grantable).toBe(true);
    // A write outside its root is NEVER grantable.
    expect(checkPathAccess('/proc/x', ['/house/lane'], { requireRoot: true }).grantable).not.toBe(true);
    // A hard-denied path is NEVER grantable, roots or not.
    expect(checkPathAccess('/somewhere/.env', ['/house/lane']).grantable).not.toBe(true);
    expect(checkPathAccess('/keys/server.pem', ['/house/lane']).grantable).not.toBe(true);
  });
});

describe('collectPathArgs', () => {
  it('collects the single-path arg names', () => {
    expect(collectPathArgs({ path: '/a', destination: '/b' })).toEqual(['/a', '/b']);
  });

  it('collects read_multiple_files paths arrays — no read escapes unchecked', () => {
    expect(collectPathArgs({ paths: ['/a', '/b'] })).toEqual(['/a', '/b']);
    expect(collectPathArgs({ paths: 'not-an-array' })).toEqual([]);
  });
});

describe('findUngrantedReadPaths', () => {
  it('returns the out-of-root-but-grantable paths', () => {
    expect(findUngrantedReadPaths({ path: '/proc/cpuinfo' }, ['/house/lane'])).toEqual(['/proc/cpuinfo']);
  });

  it('returns nothing for in-scope reads', () => {
    expect(findUngrantedReadPaths({ path: '/house/lane/notes.md' }, ['/house/lane'])).toEqual([]);
  });

  it('a hard-denied path is NOT a gap — it must fail, never prompt', () => {
    expect(findUngrantedReadPaths({ path: '/etc/secrets/.env' }, ['/house/lane'])).toEqual([]);
  });

  it('unconfined reads (no roots bound) have nothing to grant', () => {
    expect(findUngrantedReadPaths({ path: '/proc/cpuinfo' }, [])).toEqual([]);
  });

  it('an already-granted root closes the gap', () => {
    expect(findUngrantedReadPaths({ path: '/proc/cpuinfo' }, ['/house/lane', '/proc'])).toEqual([]);
  });
});

describe('resolveGrantDir (real fs)', () => {
  it('a file path grants its parent directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grant-dir-'));
    const file = path.join(dir, 'info.txt');
    await fs.writeFile(file, 'x');
    try {
      expect(await resolveGrantDir('read_text_file', file)).toBe(dir);
      // A directory path grants itself.
      expect(await resolveGrantDir('read_text_file', dir)).toBe(dir);
      // Dir-shaped tools always grant the named path.
      expect(await resolveGrantDir('list_directory', dir)).toBe(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('a path that cannot be stat-ed falls back to its parent', async () => {
    expect(await resolveGrantDir('read_text_file', '/no/such/place/file.txt')).toBe('/no/such/place');
  });
});

describe('checkWriteBudget', () => {
  it('allows writes under the limit', () => {
    const conn = { _writeOps: 0 };
    expect(checkWriteBudget(conn).allowed).toBe(true);
  });

  it('blocks writes at the limit', () => {
    const conn = { _writeOps: 10 };
    expect(checkWriteBudget(conn).allowed).toBe(false);
    expect(checkWriteBudget(conn).remaining).toBe(0);
  });

  it('tracks remaining budget', () => {
    const conn = { _writeOps: 7 };
    expect(checkWriteBudget(conn).remaining).toBe(3);
  });
});

describe('recordWrite', () => {
  it('increments write counter', () => {
    const conn = { _writeOps: 0 };
    recordWrite(conn);
    expect(conn._writeOps).toBe(1);
    recordWrite(conn);
    expect(conn._writeOps).toBe(2);
  });

  it('initializes counter if missing', () => {
    const conn = {};
    recordWrite(conn);
    expect(conn._writeOps).toBe(1);
  });
});

describe('isWriteOperation', () => {
  it('identifies write tools', () => {
    expect(isWriteOperation('write_file')).toBe(true);
    expect(isWriteOperation('edit_file')).toBe(true);
    expect(isWriteOperation('create_file')).toBe(true);
    expect(isWriteOperation('delete_file')).toBe(true);
  });

  it('does not flag read tools', () => {
    expect(isWriteOperation('read_file')).toBe(false);
    expect(isWriteOperation('list_directory')).toBe(false);
    expect(isWriteOperation('search_files')).toBe(false);
  });
});

describe('isWithinRoots', () => {
  it('contains a path inside a root, with a separator boundary', () => {
    expect(isWithinRoots('/a/proj/backend/x.js', ['/a/proj'])).toBe(true);
    expect(isWithinRoots('/a/proj', ['/a/proj'])).toBe(true); // the root itself
    expect(isWithinRoots('/a/project-x/x.js', ['/a/proj'])).toBe(false); // sibling, not nested
  });
  it('is false for empty roots or a missing path', () => {
    expect(isWithinRoots('/a/b', [])).toBe(false);
    expect(isWithinRoots('', ['/a'])).toBe(false);
  });
});

describe('findUngrantedWritePaths — grantable out-of-lane write gaps', () => {
  const lane = '/house/neuma-a';
  it('returns a project-folder write that falls outside the lane', () => {
    expect(findUngrantedWritePaths({ path: '/repos/proj/foo.js' }, [lane]))
      .toEqual(['/repos/proj/foo.js']);
  });
  it('returns nothing when the write is already inside the lane', () => {
    expect(findUngrantedWritePaths({ path: '/house/neuma-a/dna/x.json' }, [lane])).toEqual([]);
  });
  it('never offers a denied path (denylist stays hard-denied, not grantable)', () => {
    expect(findUngrantedWritePaths({ path: '/repos/proj/.git/config' }, [lane])).toEqual([]);
    expect(findUngrantedWritePaths({ path: '/repos/proj/.env' }, [lane])).toEqual([]);
  });
  it('checks source AND destination (move/rename carry both)', () => {
    const gaps = findUngrantedWritePaths({ source: '/house/neuma-a/x', destination: '/repos/proj/x' }, [lane]);
    expect(gaps).toEqual(['/repos/proj/x']);
  });
});

// --- Team workspace space budget (#171) — the byte meter, pure ---

describe('writePayloadBytes', () => {
  it('counts write_file content in utf8 bytes', () => {
    expect(writePayloadBytes({ path: '/x/a.txt', content: 'hello' })).toBe(5);
    expect(writePayloadBytes({ path: '/x/a.txt', content: 'héllo' })).toBe(6); // é is 2 bytes
  });
  it('sums every edit_file newText', () => {
    expect(writePayloadBytes({ path: '/x/a.txt', edits: [{ oldText: 'a', newText: 'abc' }, { oldText: 'b', newText: 'de' }] })).toBe(5);
  });
  it('meters structure-only ops at zero', () => {
    expect(writePayloadBytes({ path: '/x/dir' })).toBe(0);
    expect(writePayloadBytes({ source: '/x/a', destination: '/x/b' })).toBe(0);
    expect(writePayloadBytes(null)).toBe(0);
  });
});

describe('checkWorkspaceBudget', () => {
  it('allows writes under the budget and reports the honest numbers', () => {
    const v = checkWorkspaceBudget({ budgetBytes: 100, usedBytes: 40 }, 60);
    expect(v.allowed).toBe(true);
    expect(v.used).toBe(40);
    expect(v.budget).toBe(100);
  });
  it('refuses past the ceiling with used/budget/needed in the reason', () => {
    const v = checkWorkspaceBudget({ budgetBytes: 100, usedBytes: 90 }, 11);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/90/);
    expect(v.reason).toMatch(/100/);
    expect(v.reason).toMatch(/11/);
  });
  it('treats missing usedBytes as zero', () => {
    expect(checkWorkspaceBudget({ budgetBytes: 10 }, 10).allowed).toBe(true);
    expect(checkWorkspaceBudget({ budgetBytes: 10 }, 11).allowed).toBe(false);
  });
});

// normalizeToolArgs — meeting the model where its training is strongest,
// applied to ARGUMENTS (live 2026-07-23: three search_files calls refused by
// the MCP zod wall — […]).
import { normalizeToolArgs } from '../../backend/services/tool-sandbox.js';

describe('normalizeToolArgs', () => {
  test('a pattern-only search gains the standing root as its ground', () => {
    expect(normalizeToolArgs('search_files', { pattern: 'Map of Essence' }, '/house'))
      .toEqual({ pattern: 'Map of Essence', path: '/house' });
  });

  test('alias names fill the canonical key — directory, query, file, contents', () => {
    expect(normalizeToolArgs('search_files', { directory: '/repo', query: 'roles' }, '/house'))
      .toEqual({ directory: '/repo', query: 'roles', path: '/repo', pattern: 'roles' });
    expect(normalizeToolArgs('read_text_file', { file: '/a/b.md' }, null))
      .toEqual({ file: '/a/b.md', path: '/a/b.md' });
    expect(normalizeToolArgs('write_file', { filepath: '/a/b.md', text: 'x' }, null))
      .toEqual({ filepath: '/a/b.md', text: 'x', path: '/a/b.md', content: 'x' });
    expect(normalizeToolArgs('move_file', { from: '/a', to: '/b' }, null))
      .toEqual({ from: '/a', to: '/b', source: '/a', destination: '/b' });
  });

  test('an explicit value is never overwritten by an alias', () => {
    expect(normalizeToolArgs('search_files', { path: '/explicit', directory: '/other', pattern: 'x' }, '/house'))
      .toEqual({ path: '/explicit', directory: '/other', pattern: 'x' });
  });

  test('a WRITE path is never invented — the fail-closed law stands', () => {
    // write_file with no path arg at all: no default root fills it (the
    // sandbox refuses it right after, as before).
    expect(normalizeToolArgs('write_file', { content: 'x' }, null)).toEqual({ content: 'x' });
  });

  test('unknown tools and shapeless args pass through untouched', () => {
    const args = { anything: 1 };
    expect(normalizeToolArgs('no_such_tool', args, '/house')).toBe(args);
    expect(normalizeToolArgs('search_files', null, '/house')).toBeNull();
  });
});
