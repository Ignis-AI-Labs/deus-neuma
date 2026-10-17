/**
 * THE EDIT HAND — REAL MCP server, REAL disk, REAL sandbox, NO mock
 * (AGENTS.md RULE 0). This is the gnosis for #299.
 *
 * The measured defect: a being's `edit_file` went to
 * @modelcontextprotocol/server-filesystem, whose applyFileEdits replaces the
 * FIRST occurrence of the anchor with a bare String.replace and reports
 * success. On 400 real commits of this repository, 4,855 hunks carried 218
 * anchors that appear more than once, and 149 of those would have landed on
 * the wrong site — 3.07% of all edits.
 *
 * Nothing here mocks the boundary. The proof that a refusal did not write is
 * that the bytes on disk are unchanged; the proof that an edit landed is that
 * the bytes are there, in the right function. And the CONTROL test calls the
 * real upstream server directly on an identical file, so […] is measured in this suite rather than quoted
 * from the issue.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import { UNDO_SUBDIR } from '../../backend/services/edit-undo.js';

const SERVER = 'edit-hand-fs';

// The d1a1dc58a1 shape from the evidence: one guard line, character-identical,
// in two functions. Aiming at the second one is the ordinary case that used to
// silently rewrite the first.
const FIXTURE = `export const formatLedgerSection = (tasks) => {
  if (!tasks || tasks.length === 0) return '';
  return tasks.map(renderTask).join('\\n');
};

export const addTask = (tasks, task) => {
  if (!tasks || tasks.length === 0) return '';
  return [...tasks, task];
};
`;

const AMBIGUOUS = "  if (!tasks || tasks.length === 0) return '';";

describe('edit_file — the platform hand refuses to guess (gnosis, no mock)', () => {
  let project, target, control, sandboxed, dataRoot, origDataRoot;

  beforeAll(async () => {
    project = await createTempDir('edit-hand');
    // A real .git marker so the undo stack resolves to the project root, which
    // is what makes `neuma edit --undo` find a being's snapshot.
    await fs.mkdir(path.join(project, '.git'), { recursive: true });
    dataRoot = await createTempDir('edit-hand-data');
    origDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = dataRoot;   // the operator act ledger writes here, not into repo data/
    target = path.join(project, 'ledger.js');
    control = path.join(project, 'ledger-control.js');
    await mcpService.connectToServer(
      SERVER, 'npx', ['-y', '@modelcontextprotocol/server-filesystem', project], {},
    );
  }, 60000); // npx may download the package on first run

  afterAll(async () => {
    vi.restoreAllMocks();
    if (origDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = origDataRoot;
    await mcpService.disconnect(SERVER);
  });

  beforeEach(async () => {
    await fs.writeFile(target, FIXTURE);
    await fs.writeFile(control, FIXTURE);
    // Fresh connection per test so the write budget never leaks between them.
    // No neumaId: this proves the FILE surface, not lane journaling, and the
    // operator's granted root is the confinement here.
    sandboxed = createSandboxedCallTool(mcpService, {
      companion: {},
      _grantedReadRoots: [project],
      _grantedWriteRoots: [project],
    }, null);
  });

  const edit = (file, edits, extra = {}) =>
    sandboxed(SERVER, 'edit_file', { path: file, edits, ...extra });

  describe('the ambiguous anchor — the 3.07%', () => {
    test('refuses, names the count, and writes nothing', async () => {
      await expect(edit(target, [{ oldText: AMBIGUOUS, newText: '  if (!tasks?.length) return [];' }]))
        .rejects.toThrow(/appears 2 times/);
      expect(await fs.readFile(target, 'utf-8')).toBe(FIXTURE);
    });

    test('the refusal teaches the fix, because the fix is a property of the anchor', async () => {
      const err = await edit(target, [{ oldText: AMBIGUOUS, newText: 'x' }]).catch((e) => e);
      expect(err.message).toMatch(/Widen the anchor/);
      expect(err.message).toMatch(/Four or more lines/);
      expect(err.message).toMatch(/Nothing was written/);
    });

    // THE CONTROL. Same anchor, same bytes, straight to the real upstream
    // server: it reports success and silently rewrites the FIRST function.
    // This is the defect, measured here rather than cited.
    test('CONTROL — the upstream server lands the same edit on the wrong function', async () => {
      const result = await mcpService.callTool(SERVER, 'edit_file', {
        path: control,
        edits: [{ oldText: AMBIGUOUS, newText: '  if (!tasks?.length) return [];' }],
      });
      expect(result?.isError).toBeFalsy();          // reported as success
      const after = await fs.readFile(control, 'utf-8');
      const [first, second] = after.split('export const addTask');
      expect(first).toContain('!tasks?.length');    // formatLedgerSection — never named
      expect(second).toContain("tasks.length === 0"); // addTask — the intended site, untouched
    });
  });

  describe('a unique anchor', () => {
    const UNIQUE = `export const addTask = (tasks, task) => {
  if (!tasks || tasks.length === 0) return '';`;

    test('lands in the function that was actually named', async () => {
      const result = await edit(target, [{
        oldText: UNIQUE,
        newText: 'export const addTask = (tasks, task) => {\n  if (!tasks?.length) return [task];',
      }]);
      const after = await fs.readFile(target, 'utf-8');
      const [before, addTask] = after.split('export const addTask');
      expect(addTask).toContain('!tasks?.length');
      expect(before).toContain("tasks.length === 0");   // formatLedgerSection untouched
      expect(result.content[0].text).toMatch(/Edited ledger\.js/);
    });

    test('the report names the line it landed on, not just that something happened', async () => {
      const result = await edit(target, [{
        oldText: UNIQUE,
        newText: 'export const addTask = (tasks, task) => {\n  if (!tasks?.length) return [task];',
      }]);
      // addTask's signature is line 6 of the fixture.
      expect(result.content[0].text).toMatch(/at line 6/);
    });

    test('dryRun changes nothing on disk and says so', async () => {
      const result = await edit(target, [{ oldText: UNIQUE, newText: 'export const addTask = (a, b) => {\n  return [];' }], { dryRun: true });
      expect(result.content[0].text).toMatch(/Dry run/);
      expect(await fs.readFile(target, 'utf-8')).toBe(FIXTURE);
    });
  });

  describe('undo — a landed edit is recoverable', () => {
    test('the snapshot restores the file byte-for-byte', async () => {
      await edit(target, [{
        oldText: `export const addTask = (tasks, task) => {
  if (!tasks || tasks.length === 0) return '';`,
        newText: 'export const addTask = (tasks, task) => {\n  if (!tasks?.length) return [task];',
      }]);
      expect(await fs.readFile(target, 'utf-8')).not.toBe(FIXTURE);

      const undoDir = path.join(project, UNDO_SUBDIR);
      const snaps = (await fs.readdir(undoDir)).filter((f) => f.endsWith('.json'));
      expect(snaps.length).toBeGreaterThan(0);
      const newest = snaps.sort().at(-1);
      const snap = JSON.parse(await fs.readFile(path.join(undoDir, newest), 'utf-8'));
      expect(snap.path).toBe(target);

      // The restore `neuma edit --undo` performs, on the record it wrote.
      await fs.writeFile(snap.path, snap.preEditContent);
      expect(await fs.readFile(target, 'utf-8')).toBe(FIXTURE);
    });
  });

  describe('the anchors that used to slip through', () => {
    test('zero match is loud, and the file is untouched', async () => {
      await expect(edit(target, [{ oldText: 'function neverWritten() {}', newText: 'x' }]))
        .rejects.toThrow(/No match/);
      expect(await fs.readFile(target, 'utf-8')).toBe(FIXTURE);
    });

    test('an empty oldText is refused instead of inserting at byte 0', async () => {
      await expect(edit(target, [{ oldText: '', newText: '// injected at the top\n' }]))
        .rejects.toThrow(/empty oldText/);
      expect(await fs.readFile(target, 'utf-8')).toBe(FIXTURE);
    });

    test('CONTROL — the upstream server puts an empty anchor at byte 0', async () => {
      await mcpService.callTool(SERVER, 'edit_file', {
        path: control,
        edits: [{ oldText: '', newText: '// injected at the top\n' }],
      });
      expect(await fs.readFile(control, 'utf-8')).toMatch(/^\/\/ injected at the top/);
    });

    test('a CRLF file keeps its line endings', async () => {
      const crlf = path.join(project, 'crlf.js');
      await fs.writeFile(crlf, FIXTURE.replace(/\n/g, '\r\n'));
      await edit(crlf, [{ oldText: 'return [...tasks, task];', newText: 'return tasks.concat(task);' }]);
      const after = await fs.readFile(crlf, 'utf-8');
      expect(after).toContain('tasks.concat(task)');
      expect(after).not.toMatch(/[^\r]\n/);         // every LF still preceded by CR
    });

    test('CONTROL — the upstream server flattens the same CRLF file to LF', async () => {
      const crlf = path.join(project, 'crlf-control.js');
      await fs.writeFile(crlf, FIXTURE.replace(/\n/g, '\r\n'));
      await mcpService.callTool(SERVER, 'edit_file', {
        path: crlf,
        edits: [{ oldText: 'return [...tasks, task];', newText: 'return tasks.concat(task);' }],
      });
      expect(await fs.readFile(crlf, 'utf-8')).not.toContain('\r\n');
    });
  });

  describe('a multi-edit call is whole or nothing', () => {
    test('an ambiguous second edit prevents the first from landing', async () => {
      await expect(edit(target, [
        { oldText: 'return [...tasks, task];', newText: 'return tasks.concat(task);' },
        { oldText: AMBIGUOUS, newText: 'x' },
      ])).rejects.toThrow(/appears 2 times/);
      expect(await fs.readFile(target, 'utf-8')).toBe(FIXTURE);
    });

    test('two unique edits both land', async () => {
      await edit(target, [
        { oldText: 'return [...tasks, task];', newText: 'return tasks.concat(task);' },
        { oldText: 'return tasks.map(renderTask).join', newText: 'return tasks.map(render).join' },
      ]);
      const after = await fs.readFile(target, 'utf-8');
      expect(after).toContain('tasks.concat(task)');
      expect(after).toContain('tasks.map(render).join');
    });
  });

  describe('the file must exist', () => {
    test('editing a missing file names the write hand instead of failing obscurely', async () => {
      await expect(edit(path.join(project, 'absent.js'), [{ oldText: 'a', newText: 'b' }]))
        .rejects.toThrow(/Write it first \(fs\/write\)/);
    });
  });
});
