/**
 * The PostToolUse hook, EXECUTED — not imported, not simulated.
 *
 * This exists because of a failure that actually happened while building it: a
 * duplicate `const` declaration made the hook die with a SyntaxError on every
 * edit. It was designed to fail silently (a scanner crash must never break the
 * operator's write), so a BROKEN hook and a CLEAN repo produced the exact same
 * output: nothing. Several edits went by read as "clean" while the hook had not
 * run at all.
 *
 * Fail-silent is right for the operator and blind for the maintainer. The only
 * cure is a test that runs the real binary against a real repo on disk and
 * insists it speaks when it should — so silence caused by a crash becomes red
 * here instead of invisible there.
 *
 * A real temp repo, the real CLI, the real hook process, no mocks (RULE 0).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/mapview');
const HOOK = path.join(TOOLS, 'post-edit-hook.mjs');
const CLI = path.join(TOOLS, 'cli.mjs');

let root;

const write = async (rel, text) => {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
};

/** Run a command, resolving {code, stdout, stderr} — never throwing. */
const run = (args, cwd) => new Promise((resolve) => {
  execFile(process.execPath, args, { cwd }, (err, stdout, stderr) => {
    resolve({ code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || '' });
  });
});

/** Feed the hook a PostToolUse event exactly as the harness does — JSON on stdin. */
const fireHook = (filePath) => new Promise((resolve) => {
  const child = execFile(process.execPath, [HOOK], { cwd: root }, (err, stdout, stderr) => {
    resolve({ code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || '' });
  });
  child.stdin.end(JSON.stringify({ cwd: root, tool_input: { file_path: filePath } }));
});

beforeAll(async () => {
  root = await createTempDir('mapview-hook');
  await write('package.json', JSON.stringify({ name: 'hooked', scripts: { start: 'node entry.js' } }));
  await write('entry.js', "import { used } from './lib/used.js';\nused();\n");
  await write('lib/used.js', 'export const used = () => 1;\n');
  // Accept this state as the baseline, so anything after it is genuinely NEW.
  await run([CLI, 'baseline', '--root', root], root);
}, 60000);

describe('the hook process itself', () => {
  it('LOADS — a syntax error here would make every edit silently unchecked', async () => {
    const r = await fireHook(path.join(root, 'entry.js'));
    expect(r.stderr).not.toMatch(/SyntaxError|Cannot find module/);
    expect(r.code).toBe(0);
  });

  it('never fails the operator’s edit, whatever happens', async () => {
    const r = await fireHook(path.join(root, 'entry.js'));
    expect(r.code).toBe(0);
  });

  it('survives malformed input without crashing', async () => {
    const r = await new Promise((resolve) => {
      const child = execFile(process.execPath, [HOOK], { cwd: root }, (err, stdout, stderr) => {
        resolve({ code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || '' });
      });
      child.stdin.end('this is not json');
    });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
});

describe('what the hook says', () => {
  it('is SILENT on an edit that introduces nothing', async () => {
    const r = await fireHook(path.join(root, 'entry.js'));
    expect(r.stdout.trim()).toBe('');
  });

  it('SPEAKS when an edit disconnects a module, and reaches the model', async () => {
    await write('lib/stranded.js', 'export const stranded = () => 1;\n');
    const r = await fireHook(path.join(root, 'lib/stranded.js'));
    expect(r.stdout.trim()).not.toBe('');
    const payload = JSON.parse(r.stdout);
    // additionalContext is the channel the MODEL receives. Bare stderr on an
    // exit-0 hook goes to the transcript only — the warning would be invisible
    // to the thing that just made the mistake.
    expect(payload.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(payload.hookSpecificOutput.additionalContext).toContain('lib/stranded.js');
    expect(payload.hookSpecificOutput.additionalContext).toMatch(/module-unreachable|dead-export/);
  });

  it('ignores a file type it does not map', async () => {
    await write('notes.md', '# not code\n');
    const r = await fireHook(path.join(root, 'notes.md'));
    expect(r.stdout.trim()).toBe('');
  });

  it('ignores an edit outside the repo it was invoked for', async () => {
    const r = await fireHook('/etc/hostname');
    expect(r.stdout.trim()).toBe('');
  });
});
