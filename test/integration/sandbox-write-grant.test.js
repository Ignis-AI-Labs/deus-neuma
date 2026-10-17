/**
 * Sandbox write-scope grant — REAL MCP filesystem server, REAL disk, NO mock
 * (AGENTS.md RULE 0).
 *
 * Gnosis for Unit 2: a witness can grant a neuma WRITE access into a project
 * folder (outside its own sovereign lane), and that grant is honored on real
 * disk — while every safety wall still holds INSIDE the granted folder:
 *   - a write into the granted folder lands (real bytes),
 *   - a write outside both the lane and the grant is denied,
 *   - .git / .env inside the granted folder stay hard-denied (denylist first),
 *   - the grant also confers read (write implies read),
 *   - delete_file is still hard-denied,
 *   - granted-folder writes do NOT consume the per-session write budget, while
 *     the neuma's own-lane writes still do.
 *
 * Nothing here mocks the execution boundary. The real @modelcontextprotocol/
 * server-filesystem is rooted at a parent holding BOTH the workspaces house and
 * the project folder, so the server CAN physically reach both — the sandbox
 * (createSandboxedCallTool) is the only thing that decides what a neuma may do.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const SERVER = 'write-grant-fs';

describe('sandbox write-scope grant — granted project folder, walls still hold (gnosis, no mock)', () => {
  let base, house, project, lane, origRoot;

  beforeAll(async () => {
    base = await createTempDir('sandbox-write-grant');
    house = path.join(base, 'workspaces');
    project = path.join(base, 'project');
    await fs.mkdir(house, { recursive: true });
    await fs.mkdir(path.join(project, '.git'), { recursive: true });
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create('neuma-a');
    lane = path.resolve(house, 'neuma-a');
    // The server is rooted at the parent so it can reach the lane AND the
    // project; the sandbox is what confines.
    await mcpService.connectToServer(SERVER, 'npx', ['-y', '@modelcontextprotocol/server-filesystem', base], {});
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect(SERVER);
  });

  // A sandboxed caller with an explicit write grant on the project folder.
  const granted = () => {
    const connection = { companion: { neumaId: 'neuma-a' }, _writeOps: 0, _grantedWriteRoots: [project] };
    return createSandboxedCallTool(mcpService, connection, workspace);
  };
  // A caller with NO grant — behaves exactly as a pre-Unit-2 neuma.
  const ungranted = () => {
    const connection = { companion: { neumaId: 'neuma-a' }, _writeOps: 0 };
    return createSandboxedCallTool(mcpService, connection, workspace);
  };

  test('a granted WRITE into the project folder lands on real disk', async () => {
    const target = path.join(project, 'app.js');
    await granted()(SERVER, 'write_file', { path: target, content: 'export const x = 1;\n' });
    expect(await fs.readFile(target, 'utf8')).toContain('export const x = 1;');
  });

  test('WITHOUT the grant, that same write is denied — nothing lands', async () => {
    const target = path.join(project, 'nope.js');
    await expect(ungranted()(SERVER, 'write_file', { path: target, content: 'x' })).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });

  test('a write outside BOTH the lane and the grant is denied', async () => {
    const outside = path.join(base, 'outside.txt');
    await expect(granted()(SERVER, 'write_file', { path: outside, content: 'x' })).rejects.toThrow();
    expect(existsSync(outside)).toBe(false);
  });

  test('the denylist still fires INSIDE a granted folder — .git and .env stay hard-denied', async () => {
    await expect(granted()(SERVER, 'write_file', { path: path.join(project, '.git', 'config'), content: 'x' })).rejects.toThrow();
    await expect(granted()(SERVER, 'write_file', { path: path.join(project, '.env'), content: 'SECRET=1' })).rejects.toThrow();
    expect(existsSync(path.join(project, '.env'))).toBe(false);
  });

  test('a write grant confers READ too (write implies read)', async () => {
    const f = path.join(project, 'readme.md');
    await fs.writeFile(f, '# hello'); // seed directly on disk
    const res = await granted()(SERVER, 'read_file', { path: f });
    const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
    expect(text).toContain('# hello');
  });

  test('delete_file EXECUTES inside a granted folder — and the walls still hold', async () => {
    // The old outright denial made a being fake deletions by overwriting
    // files (Design note, 2026-07-23 — delete_file is now a real platform tool. At
    // THIS layer (the sandbox) a granted folder confines it like any write;
    // the witness's per-delete approval card lives a layer above (portal /
    // council gates — tool-approval-flow proves that seam).
    const f = path.join(project, 'gone.js');
    await fs.writeFile(f, 'gone');
    const res = await granted()(SERVER, 'delete_file', { path: f });
    expect(res.content?.find((c) => c.type === 'text')?.text).toContain('Deleted');
    expect(existsSync(f)).toBe(false);
    // Outside the grant and the lane: still a wall.
    const outside = path.join(base, 'keep-out.js');
    await fs.writeFile(outside, 'keep');
    await expect(granted()(SERVER, 'delete_file', { path: outside })).rejects.toThrow();
    expect(existsSync(outside)).toBe(true);
    // The denylist still fires INSIDE the grant — .env is never deletable.
    await fs.writeFile(path.join(project, '.env'), 'SECRET=1');
    await expect(granted()(SERVER, 'delete_file', { path: path.join(project, '.env') })).rejects.toThrow();
    expect(existsSync(path.join(project, '.env'))).toBe(true);
  });

  test('granted-folder writes do NOT consume the per-session budget (12 > the 10 cap)', async () => {
    const call = granted(); // one connection, one budget
    for (let i = 0; i < 12; i++) {
      await call(SERVER, 'write_file', { path: path.join(project, `w${i}.js`), content: `// ${i}` });
    }
    expect(await fs.readFile(path.join(project, 'w11.js'), 'utf8')).toBe('// 11'); // the 12th still landed
  });

  test('a granted ANCESTOR of the lane does NOT exempt own-lane writes from the budget', async () => {
    // The witness grants a folder (base) that CONTAINS the lane — own-lane
    // writes must still meter, or the 10-cap silently evaporates.
    const connection = { companion: { neumaId: 'neuma-a' }, _writeOps: 0, _grantedWriteRoots: [base] };
    const call = createSandboxedCallTool(mcpService, connection, workspace);
    for (let i = 0; i < 10; i++) {
      await call(SERVER, 'write_file', { path: path.join(lane, 'sessions', `anc${i}.txt`), content: `${i}` });
    }
    await expect(call(SERVER, 'write_file', { path: path.join(lane, 'sessions', 'anc10.txt'), content: '10' }))
      .rejects.toThrow(/limit reached/);
  });

  test('own-lane writes STILL meter against the 10-cap — the 11th is refused', async () => {
    const call = granted(); // grant is irrelevant to lane writes
    for (let i = 0; i < 10; i++) {
      await call(SERVER, 'write_file', { path: path.join(lane, 'sessions', `s${i}.txt`), content: `${i}` });
    }
    await expect(call(SERVER, 'write_file', { path: path.join(lane, 'sessions', 's10.txt'), content: '10' }))
      .rejects.toThrow(/limit reached/);
  });

  test('move INTO the granted folder from the lane is allowed (both ends in a write root)', async () => {
    const src = path.join(lane, 'sessions', 'move-src.txt');
    await fs.writeFile(src, 'moved');
    const dest = path.join(project, 'moved.txt');
    await granted()(SERVER, 'move_file', { source: src, destination: dest });
    expect(await fs.readFile(dest, 'utf8')).toBe('moved');
  });

  // SEC-032 (#148) — the lexical checks are defeated by a symlink planted
  // inside a granted folder; the realpath re-check must catch what the string
  // check cannot. Real links on real disk, real MCP server.
  describe('symlink escape (SEC-032)', () => {
    test('a write THROUGH a symlink pointing outside the grant is denied — nothing lands at the target', async () => {
      const escapeTarget = path.join(base, 'escape-target');
      await fs.mkdir(escapeTarget, { recursive: true });
      await fs.symlink(escapeTarget, path.join(project, 'innocent-dir'));
      const through = path.join(project, 'innocent-dir', 'pwned.txt');
      await expect(granted()(SERVER, 'write_file', { path: through, content: 'escaped' }))
        .rejects.toThrow(/Symlink escape/);
      expect(existsSync(path.join(escapeTarget, 'pwned.txt'))).toBe(false);
    });

    test('a symlink into denied sovereign state (data/dna/) is denied post-realpath', async () => {
      const dnaDir = path.join(base, 'data', 'dna');
      await fs.mkdir(dnaDir, { recursive: true });
      await fs.symlink(dnaDir, path.join(project, 'notes'));
      await expect(granted()(SERVER, 'write_file', { path: path.join(project, 'notes', 'x.txt'), content: 'x' }))
        .rejects.toThrow(/Symlink escape/);
      expect(existsSync(path.join(dnaDir, 'x.txt'))).toBe(false);
    });

    test('a legitimate symlink pointing INSIDE the granted folder still works', async () => {
      const realDir = path.join(project, 'real-dir');
      await fs.mkdir(realDir, { recursive: true });
      await fs.symlink(realDir, path.join(project, 'alias-dir'));
      const through = path.join(project, 'alias-dir', 'fine.txt');
      await granted()(SERVER, 'write_file', { path: through, content: 'inside is fine' });
      expect(await fs.readFile(path.join(realDir, 'fine.txt'), 'utf8')).toBe('inside is fine');
    });

    test('a READ through an in-grant symlink to an outside file is denied', async () => {
      const secret = path.join(base, 'secret.txt');
      await fs.writeFile(secret, 'hush');
      await fs.symlink(secret, path.join(project, 'peek.txt'));
      await expect(granted()(SERVER, 'read_file', { path: path.join(project, 'peek.txt') }))
        .rejects.toThrow(/Symlink escape/);
    });
  });
});
