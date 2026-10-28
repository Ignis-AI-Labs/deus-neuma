/**
 * THE OPEN FOLDER on AUTO (RULE 0): real ground, real bubblewrap, no mocked
 * execution boundary. Design note, 2026-10-28: […] —
 * ruling: on AUTO in the operator's open folder the shell works on the folder
 * FOR REAL; `.git` and every secret stay masked, so history is the safety net.
 * The overlay walls (ASK, any other ground) stay proven in
 * witness-coding-sandbox.test.js; these prove the live ones TOGETHER.
 */
import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, { setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import { isLiveShell } from '../../backend/services/open-folder-autonomy.js';

const LANE_ID = 'witness-test-OpenFolder';
let root;
let ground;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-folder-'));
  ground = path.join(root, 'repo');
  await fs.mkdir(path.join(ground, 'docs'), { recursive: true });
  await fs.mkdir(path.join(ground, '.git'), { recursive: true });
  await fs.writeFile(path.join(ground, 'docs', 'old.md'), '# old\n');
  await fs.writeFile(path.join(ground, '.env'), 'PRODUCTION_SECRET=never-cross\n');
  await fs.writeFile(path.join(ground, '.git', 'config'), '[remote "origin"] url = https://token@example\n');
  await fs.writeFile(path.join(ground, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  setWitnessesRoot(path.join(root, 'witnesses'));
  await neumaWorkspace.create(LANE_ID);
});

afterEach(async () => {
  setWitnessesRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

// The same decision both seats make before running (witness-coding-tools.js,
// being-tool-surface.js): AUTO, and the shell's ground IS the open folder.
const liveFor = (sandbox) => isLiveShell({ mode: 'auto', sourceRoot: sandbox.sourceRoot, ground });

describe('the shell in the open folder on AUTO', () => {
  test('only AUTO with the shell standing in the open folder is live', () => {
    expect(isLiveShell({ mode: 'auto', sourceRoot: ground, ground })).toBe(true);
    expect(isLiveShell({ mode: 'ask', sourceRoot: ground, ground })).toBe(false);
    expect(isLiveShell({ mode: 'observe', sourceRoot: ground, ground })).toBe(false);
    expect(isLiveShell({ mode: 'auto', sourceRoot: path.join(root, 'house-workspace'), ground })).toBe(false);
    expect(isLiveShell({ mode: 'auto', sourceRoot: ground, ground: null })).toBe(false);
  });

  test('writes — text and binary — and deletes land in the folder itself, never in the overlay layer', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, ground);
    const run = await runWitnessCommand({
      ...sandbox, mode: 'write', live: liveFor(sandbox),
      command: 'mkdir -p docs/pdf && printf "%%PDF-1.7\\x00\\xff\\x10binary" > docs/pdf/NOTICE.pdf && printf "new\\n" > docs/new.md && rm docs/old.md',
    });
    expect(run.exitCode).toBe(0);
    expect(run.live).toBe(true);
    const pdf = await fs.readFile(path.join(ground, 'docs', 'pdf', 'NOTICE.pdf'));
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7');
    expect([...pdf.subarray(8, 10)]).toEqual([0x00, 0xff]);
    expect(await fs.readFile(path.join(ground, 'docs', 'new.md'), 'utf8')).toBe('new\n');
    await expect(fs.stat(path.join(ground, 'docs', 'old.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(sandbox.workspace, 'docs', 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  test('.git and secrets stay masked: unreadable, unwritable, untouched — history is the safety net', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, ground);
    const probe = await runWitnessCommand({
      ...sandbox, mode: 'write', live: liveFor(sandbox),
      command: 'cat .env; cat .git/config; git rev-parse HEAD; printf x > .git/HEAD; printf leaked > .env; rm -f .env; rm -rf .git; true',
    });
    expect(probe.stdout + probe.stderr).not.toContain('never-cross');
    expect(probe.stdout + probe.stderr).not.toContain('token@example');
    expect(await fs.readFile(path.join(ground, '.env'), 'utf8')).toBe('PRODUCTION_SECRET=never-cross\n');
    expect(await fs.readFile(path.join(ground, '.git', 'config'), 'utf8')).toContain('token@example');
    expect(await fs.readFile(path.join(ground, '.git', 'HEAD'), 'utf8')).toBe('ref: refs/heads/main\n');
    const git = await runWitnessCommand({ ...sandbox, mode: 'write', live: liveFor(sandbox), command: 'git status' });
    expect(git.exitCode).not.toBe(0);
  }, 60_000);

  test('inspect stays read-only on the live folder', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, ground);
    const blocked = await runWitnessCommand({
      ...sandbox, mode: 'inspect', live: liveFor(sandbox), command: 'cat docs/old.md && printf nope > blocked.txt',
    });
    expect(blocked.stdout).toContain('# old');
    expect(blocked.exitCode).not.toBe(0);
    await expect(fs.stat(path.join(ground, 'blocked.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  // The press and every page render need a browser: the machine's Playwright
  // browsers are bound read-only where the shell's HOME looks for them.
  const playwright = path.join(os.homedir(), '.cache', 'ms-playwright');
  // the newest build first, as the press's own finder takes it (chromium-press.js)
  const build = existsSync(playwright) && readdirSync(playwright).filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((n) => [n, ['chrome-linux64', 'chrome-linux'].find((d) => existsSync(path.join(playwright, n, d, 'chrome')))])
    .find(([, dir]) => dir);
  // (A --dump-dom browser lingers after printing — its updaters find no
  // network — so it is bounded here; the press drives the browser over CDP
  // and closes it itself.)
  test.skipIf(!build)('a real headless browser renders inside the shell', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, ground);
    const chrome = `/home/witness/.cache/ms-playwright/${build[0]}/${build[1]}/chrome`;
    const page = await runWitnessCommand({
      ...sandbox, mode: 'write', live: liveFor(sandbox), timeoutMs: 60_000,
      command: `timeout 25 ${chrome} --headless=new --disable-gpu --no-first-run --disable-component-update --dump-dom 'data:text/html,<p>rendered-in-the-shell</p>' 2>/dev/null; true`,
    });
    expect(page.timedOut).toBe(false);
    expect(page.stdout).toContain('<p>rendered-in-the-shell</p>');
  }, 90_000);
});
