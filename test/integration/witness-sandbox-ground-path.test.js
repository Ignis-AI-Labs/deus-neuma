/**
 * ONE WORLD UNDER ONE PATH — real bwrap, real disk, real commands (RULE 0).
 *
 * A sealed witness reads the operator's LIVE ground through the filesystem
 * tools, then runs a shell command about what it just read. Two ancestors of
 * this file's contract both failed that sentence: before 2026-07-26 the shell
 * saw the copy at a DIFFERENT path (`ls /workspace/repos/project-nuniver` → exit 2, a
 * witness burned its round budget re-orienting), and until 2026-08-16 the
 * copy sat at the RIGHT path but went stale against worktree drift — the
 * being's own live writes were invisible to it (Cael, MODULE_NOT_FOUND).
 *
 * The overlay ends both: the shell mounts the LIVE ground at its own path, so
 * every path the witness legitimately learned resolves, to the truth, now.
 * The properties that must hold TOGETHER:
 *   - reads are live and current, at the exact paths the file tools reported,
 *   - secrets stay out of the view (the mount masks them — a shell is not
 *     subject to the file-tool sandbox's denied-path list), and
 *   - writes land in the lane-side upper layer; the live folder never moves.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  ensureWitnessCodingSandbox, runWitnessCommand,
} from '../../backend/services/witness-coding-sandbox.js';

const LANE = 'witness-openai-chatgpt-Kagipem';
const SECRET = 'live-secret-must-not-leak';
const PLAN = 'docs/umbrae-business-plan-v5.md';

let root;
let ground;
let sandbox;
let savedRoot;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'one-world-'));
  savedRoot = process.env.WORKSPACES_ROOT;
  process.env.WORKSPACES_ROOT = path.join(root, 'lanes');

  // A ground shaped like a real repository the operator has open.
  ground = path.join(root, 'repos', 'umbrae');
  await fs.mkdir(path.join(ground, 'docs'), { recursive: true });
  await fs.writeFile(path.join(ground, PLAN), '# the plan\n');
  await fs.writeFile(path.join(ground, '.env'), `SECRET_KEY=${SECRET}\n`);

  sandbox = await ensureWitnessCodingSandbox(LANE, ground);
}, 60_000);

afterAll(async () => {
  if (savedRoot === undefined) delete process.env.WORKSPACES_ROOT;
  else process.env.WORKSPACES_ROOT = savedRoot;
  await fs.rm(root, { recursive: true, force: true });
});

const inspect = (command) => runWitnessCommand({ ...sandbox, command, mode: 'inspect' });

describe('the paths a witness learned actually resolve, to the live truth', () => {
  test('the ABSOLUTE ground path the file tools reported is listable — this was exit 2', async () => {
    const result = await inspect(`ls ${ground}/docs`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('umbrae-business-plan-v5.md');
  });

  test('the exact file it read through the file tools can be read by a command', async () => {
    const result = await inspect(`cat ${ground}/${PLAN}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('# the plan');
  });

  test('pwd answers the ground, so a relative path means one thing everywhere', async () => {
    const pwd = await inspect('pwd');
    expect(pwd.stdout.trim()).toBe(ground);
    const relative = await inspect(`cat ${PLAN}`);
    expect(relative.exitCode).toBe(0);
    expect(relative.stdout).toContain('# the plan');
  });

  test('a file landing on the ground AFTER the shell exists is visible NOW — the staleness that lost Cael her run', async () => {
    await fs.writeFile(path.join(ground, 'docs', 'arrived-later.md'), 'fresh truth\n');
    const result = await inspect(`cat ${ground}/docs/arrived-later.md`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('fresh truth');
  });
});

describe('and the walls still hold — the reason the live directory is never bound bare', () => {
  test('a live secret is unreachable from the shell', async () => {
    const result = await inspect(`cat ${ground}/.env`);
    expect(result.stdout).not.toContain(SECRET);
    expect(result.stderr).not.toContain(SECRET);
  });

  test('a WRITE under the ground path lands in the upper layer — the live file is untouched', async () => {
    const write = await runWitnessCommand({
      ...sandbox, mode: 'write', command: `echo mutated > ${ground}/${PLAN}`,
    });
    expect(write.exitCode).toBe(0);
    // The operator's real file did not move.
    expect(await fs.readFile(path.join(ground, PLAN), 'utf8')).toBe('# the plan\n');
    // ...and the shell genuinely kept the change, so work still accumulates.
    const back = await inspect(`cat ${ground}/${PLAN}`);
    expect(back.stdout).toContain('mutated');
  });

  test('inspect mode cannot write, even under the familiar path', async () => {
    const result = await inspect(`echo nope > ${ground}/docs/probe.md`);
    expect(result.exitCode).not.toBe(0);
  });
});
