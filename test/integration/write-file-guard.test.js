// Whole-file overwrite cannot impersonate a small edit — real router, sandbox,
// native organ and disk. No mocks anywhere in the execution path.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { UNDO_SUBDIR } from '../../backend/services/edit-undo.js';

const FULL_SOURCE = `export const phases = Object.freeze({
  idle: { armor: 4, speed: 0 },
  windup: { armor: 8, speed: 0 },
  slam: { armor: 8, speed: 0 },
  recover: { armor: 4, speed: 1 },
});

export const lastPhase = (enemy) => {
  const phases = enemy.phases;
  return phases[phases.length - 1];
};

export const advancePhase = (enemy) => {
  const next = enemy.phaseIndex + 1;
  return { ...enemy, phaseIndex: next, phase: enemy.phases[next] };
};

export const takeDamage = (enemy, amount) => ({
  ...enemy,
  health: Math.max(0, enemy.health - amount),
});
`;

const textOf = (result) => (result?.content || []).map((item) => item?.text || '').join('\n');

describe('write_file guard — create, surgical edit, deliberate replacement', () => {
  let root;
  let call;

  beforeAll(async () => {
    root = await createTempDir('write-file-guard');
    await setNativeFilesystemRoots([root]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
    const sandboxed = createSandboxedCallTool(mcpService, {
      companion: {}, _grantedReadRoots: [root], _grantedWriteRoots: [root],
    }, null);
    call = withFsRouting(sandboxed);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
  });

  test('the four-line overwrite reproduction refuses and every original byte survives', async () => {
    const target = path.join(root, 'ragdoll.ts');
    await fs.writeFile(target, FULL_SOURCE);

    await expect(call('fs', 'write', { path: target, content: 'export const lastPhase = () => null;\n' }))
      .rejects.toThrow(/already exists[\s\S]*Nothing was written[\s\S]*fs\/edit/i);
    expect(await fs.readFile(target, 'utf8')).toBe(FULL_SOURCE);

    await expect(call('filesystem', 'write_file', { path: target, content: '// four lines\n' }))
      .rejects.toThrow(/already exists/);
    expect(await fs.readFile(target, 'utf8')).toBe(FULL_SOURCE);
  });

  test('the intended small edit then lands at its exact anchor, nowhere else', async () => {
    const target = path.join(root, 'ragdoll.ts');
    const result = await call('fs', 'edit', {
      path: target,
      edits: [{
        oldText: '  return phases[phases.length - 1];',
        newText: '  return phases.at(-1) ?? null;',
      }],
    });
    expect(result.isError).toBeFalsy();
    const after = await fs.readFile(target, 'utf8');
    expect(after).toBe(FULL_SOURCE.replace('phases[phases.length - 1]', 'phases.at(-1) ?? null'));
    expect(after).toContain('export const takeDamage');
    expect(after).toContain('export const advancePhase');
  });

  test('whole-file replacement needs both explicit intent and the current stamp', async () => {
    const target = path.join(root, 'replacement.ts');
    await fs.writeFile(target, FULL_SOURCE);

    await expect(call('fs', 'write', { path: target, content: 'replacement', overwrite: true }))
      .rejects.toThrow(/expectedMtimeMs/);
    expect(await fs.readFile(target, 'utf8')).toBe(FULL_SOURCE);

    const stale = (await fs.stat(target)).mtimeMs - 1000;
    await expect(call('fs', 'write', {
      path: target, content: 'replacement', overwrite: true, expectedMtimeMs: stale,
    })).rejects.toThrow(/changed on disk|Nothing was written/i);
    expect(await fs.readFile(target, 'utf8')).toBe(FULL_SOURCE);
  });

  test('file info exposes the stamp; a stamped whole replacement lands atomically with undo', async () => {
    const target = path.join(root, 'replacement.ts');
    const info = await mcpService.callTool('filesystem', 'get_file_info', { path: target });
    const expectedMtimeMs = Number(textOf(info).match(/^mtimeMs: (.+)$/m)?.[1]);
    expect(Number.isFinite(expectedMtimeMs)).toBe(true);
    expect(expectedMtimeMs).toBe((await fs.stat(target)).mtimeMs);

    const replacement = 'export const intentionallyReplaced = true;\n';
    const result = await call('fs', 'write', {
      path: target, content: replacement, overwrite: true, expectedMtimeMs,
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('WHOLE file');
    expect(await fs.readFile(target, 'utf8')).toBe(replacement);

    const snapshots = (await fs.readdir(path.join(root, UNDO_SUBDIR))).filter((name) => name.endsWith('.json'));
    const records = await Promise.all(snapshots.map(async (name) =>
      JSON.parse(await fs.readFile(path.join(root, UNDO_SUBDIR, name), 'utf8'))));
    const snapshot = records.find((record) => record.path === target);
    expect(snapshot?.preEditContent).toBe(FULL_SOURCE);
  });

  test('a fresh file creates normally; a second create cannot clobber it', async () => {
    const target = path.join(root, 'new-file.ts');
    const created = await call('fs', 'write', { path: target, content: 'export const fresh = true;\n' });
    expect(created.isError).toBeFalsy();
    expect(textOf(created)).toContain('Created new-file.ts');
    expect(await fs.readFile(target, 'utf8')).toBe('export const fresh = true;\n');

    await expect(call('fs', 'write', { path: target, content: 'destroyed' })).rejects.toThrow(/already exists/);
    expect(await fs.readFile(target, 'utf8')).toBe('export const fresh = true;\n');
  });

  test('the real neuma edit --undo command restores edits and whole replacements byte-for-byte', async () => {
    const project = path.join(root, 'undo-project');
    await fs.mkdir(path.join(project, '.git'), { recursive: true });
    const target = path.join(project, 'source.ts');
    await fs.writeFile(target, FULL_SOURCE);
    const cli = path.resolve('bin/neuma');
    const undo = () => {
      const result = spawnSync('node', [cli, 'edit', '--undo'], { cwd: project, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('archived to');
    };

    const edited = await call('fs', 'edit', {
      path: target,
      edits: [{ oldText: 'phases[phases.length - 1]', newText: 'phases.at(-1) ?? null' }],
    });
    expect(edited.isError).toBeFalsy();
    expect(await fs.readFile(target, 'utf8')).not.toBe(FULL_SOURCE);
    undo();
    expect(await fs.readFile(target, 'utf8')).toBe(FULL_SOURCE);

    const replaced = await call('fs', 'write', {
      path: target,
      content: 'export const intentionallyReplaced = true;\n',
      overwrite: true,
      expectedMtimeMs: (await fs.stat(target)).mtimeMs,
    });
    expect(replaced.isError).toBeFalsy();
    expect(await fs.readFile(target, 'utf8')).toBe('export const intentionallyReplaced = true;\n');
    undo();
    expect(await fs.readFile(target, 'utf8')).toBe(FULL_SOURCE);
  });
});
