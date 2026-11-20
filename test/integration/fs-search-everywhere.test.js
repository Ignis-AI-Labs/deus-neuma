/**
 * A neuma finds the exact file it needs across every drive it was given, in one search (Founder,
 * 2026-11-14: […]).
 *
 * REAL native filesystem organ, REAL disk, the being-facing path production composes (withFsRouting
 * over createSandboxedCallTool), NO mock (RULE 0). Two folders stand in for two mounted drives the
 * operator granted, beside the being's own workspace. A search with no folder used to look in the
 * workspace alone.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const BEING = 'searcher';
let top; let driveA; let driveB; let outside; let priorRoot;
const text = (result) => result.content.map((c) => c.text).join('\n');
const being = () => withFsRouting(createSandboxedCallTool(mcpService, {
  companion: { neumaId: BEING }, _writeOps: 0, _grantedReadRoots: [driveA, driveB], _grantedWriteRoots: [],
}, workspace));
const put = async (file, body = 'x') => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); };

beforeAll(async () => {
  top = await createTempDir('fs-search-everywhere');
  priorRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(top, 'workspaces'));
  await workspace.create(BEING);
  driveA = path.join(top, 'mnt', 'projects');
  driveB = path.join(top, 'mnt', 'archive');
  outside = path.join(top, 'elsewhere');
  // the one being looked for, deep on the second drive, among near names
  await put(path.join(driveB, '2024', 'finance', 'q3', 'Budget-2026.xlsx'));
  await put(path.join(driveA, 'old', 'budget-2026-draft-v1.xlsx'));
  await put(path.join(driveA, 'notes', 'about the budget-2026 plan.md'));
  // noise: a dependency folder, a hidden folder, and a link out of the drive
  await put(path.join(driveA, 'app', 'node_modules', 'x', 'Budget-2026.xlsx'));
  await put(path.join(driveA, '.cache', 'Budget-2026.xlsx'));
  await put(path.join(outside, 'Budget-2026.xlsx'));
  await fs.symlink(outside, path.join(driveA, 'link-out'));
  // a secret named like it is never listed
  await put(path.join(driveB, 'keys', 'budget-2026.pem'));
  await setNativeFilesystemRoots([path.join(top, 'workspaces'), driveA, driveB]);
  mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
});

afterAll(async () => {
  setWorkspacesRoot(priorRoot);
  await fs.rm(top, { recursive: true, force: true });
});

describe('one search, every drive', () => {
  test('no folder named: every drive the being may read is searched, and the exact name comes first', async () => {
    const out = text(await being()('fs', 'search', { pattern: 'budget-2026.xlsx' }));
    const lines = out.split('\n');
    expect(lines[0]).toBe(path.join(driveB, '2024', 'finance', 'q3', 'Budget-2026.xlsx'));
    expect(out).toMatch(/\[searched 3 folders \(.*projects.*archive.*\): \d+ entries in [\d.]+s, best match first\]/);
    // not inside dependencies, not inside a dot folder, never out through a link, never a secret
    expect(out).not.toContain(path.join('app', 'node_modules'));
    expect(out).not.toContain(path.join(driveA, '.cache'));
    expect(out).not.toContain(outside);
    expect(out).not.toContain('.pem');
    expect(out).toContain('folder(s) whose names start with a dot were not searched');
  });

  test('a plain word finds every name holding it, the closest first; "everywhere" means every drive', async () => {
    const out = text(await being()('fs', 'search', { pattern: 'budget-2026', path: 'everywhere' }));
    const found = out.split('\n').filter((l) => l.startsWith(top));
    expect(found).toEqual([
      path.join(driveB, '2024', 'finance', 'q3', 'Budget-2026.xlsx'),
      path.join(driveA, 'old', 'budget-2026-draft-v1.xlsx'),
      path.join(driveA, 'notes', 'about the budget-2026 plan.md'),
    ]);
  });

  test('one folder named: only that folder; hidden folders open on request', async () => {
    const one = text(await being()('fs', 'search', { pattern: 'Budget-2026.xlsx', path: driveA }));
    expect(one).not.toContain(driveB);
    expect(one).toContain(`[searched ${driveA}:`);
    const hidden = text(await being()('fs', 'search', { pattern: 'Budget-2026.xlsx', path: driveA, hidden: true }));
    expect(hidden).toContain(path.join(driveA, '.cache', 'Budget-2026.xlsx'));
  });

  test('a name on no drive says so, and says how to reach a drive it was not given', async () => {
    const out = text(await being()('fs', 'search', { pattern: 'no-such-file-anywhere.pdf' }));
    expect(out).toContain('No file or folder named like "no-such-file-anywhere.pdf"');
    expect(out).toContain('ask your operator for it with request_file_access');
  });
});
