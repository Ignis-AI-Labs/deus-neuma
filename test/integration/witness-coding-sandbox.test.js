/**
 * The overlay coding shell (RULE 0): real ground, real kernel overlay, real
 * bubblewrap subprocesses. No mocked execution boundary. The walls are proven
 * TOGETHER: reads are LIVE (the Cael shape — a file written to the ground
 * after the shell exists is immediately visible and runnable), writes land in
 * the lane-side upper layer and never on the ground, and secret-shaped paths
 * are masked from the shell's view.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, { setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  ensureWitnessCodingSandbox, enumerateSecretMasks, runWitnessCommand,
} from '../../backend/services/witness-coding-sandbox.js';

const LANE_ID = 'witness-test-Sandbox';
let root;
let source;
let witnessGround;
let previousSecret;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-coding-'));
  source = path.join(root, 'source');
  witnessGround = path.join(root, 'witnesses');
  await fs.mkdir(path.join(source, 'src'), { recursive: true });
  await fs.mkdir(path.join(source, 'ai-witnesses', 'hidden'), { recursive: true });
  await fs.mkdir(path.join(source, '.aws'), { recursive: true });
  await fs.mkdir(path.join(source, '.AWS'), { recursive: true });
  await fs.mkdir(path.join(source, '.git'), { recursive: true });
  await fs.mkdir(path.join(source, 'data', 'settings'), { recursive: true });
  await fs.mkdir(path.join(source, 'data', 'dna'), { recursive: true });
  await fs.mkdir(path.join(source, 'node_modules', 'dep'), { recursive: true });
  await fs.writeFile(path.join(source, 'src', 'value.js'), 'export const value = 1;\n');
  await fs.writeFile(path.join(source, 'README.md'), '# sandbox source\n');
  await fs.writeFile(path.join(source, '.env'), 'PRODUCTION_SECRET=never-cross\n');
  await fs.writeFile(path.join(source, 'env.operator'), 'PRIVATE_KEY=never-cross\n');
  await fs.writeFile(path.join(source, '.npmrc'), '//registry.example/:_authToken=never-cross\n');
  await fs.writeFile(path.join(source, 'credentials.json'), '{"token":"never-cross"}\n');
  await fs.writeFile(path.join(source, 'infra.tfstate'), '{"secret":"never-cross"}\n');
  await fs.writeFile(path.join(source, '.aws', 'credentials'), 'never-cross\n');
  await fs.writeFile(path.join(source, '.AWS', 'credentials'), 'never-cross\n');
  await fs.writeFile(path.join(source, '.git', 'config'), '[remote "origin"] url = https://token@example\n');
  await fs.writeFile(path.join(source, 'ai-witnesses', 'hidden', 'key.json'), '{"secret":true}\n');
  await fs.writeFile(path.join(source, 'data', 'settings', 'credential.json'), '{"secret":true}\n');
  await fs.writeFile(path.join(source, 'data', 'dna', 'soul.json'), '{"sovereign":true}\n');
  await fs.writeFile(path.join(source, 'node_modules', 'dep', '.env'), 'inside-dependency\n');
  setWitnessesRoot(witnessGround);
  await neumaWorkspace.create(LANE_ID);
  previousSecret = process.env.NEUMA_SANDBOX_HOST_SECRET;
  process.env.NEUMA_SANDBOX_HOST_SECRET = 'must-not-cross';
});

afterEach(async () => {
  if (previousSecret === undefined) delete process.env.NEUMA_SANDBOX_HOST_SECRET;
  else process.env.NEUMA_SANDBOX_HOST_SECRET = previousSecret;
  setWitnessesRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe('the overlay coding shell', () => {
  test('reads the LIVE ground — a file written after the shell exists runs immediately (the Cael shape)', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
    expect(sandbox.created).toBe(true);

    // The exact incident: the engine arrives on the ground AFTER the shell was
    // first opened. Under the copy design this answered MODULE_NOT_FOUND.
    await fs.writeFile(path.join(source, 'engine.mjs'), 'console.log("ENGINE-ALIVE");\n');
    const run = await runWitnessCommand({
      ...sandbox, mode: 'inspect', command: 'node engine.mjs',
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('ENGINE-ALIVE');

    // A live EDIT is seen too, not just a new file.
    await fs.writeFile(path.join(source, 'README.md'), '# sandbox source\nsecond-line\n');
    const read = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'cat README.md' });
    expect(read.stdout).toContain('second-line');
  }, 60_000);

  test('onChunk sees stdout while the command is still running', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
    const chunks = [];
    const run = await runWitnessCommand({
      ...sandbox,
      mode: 'inspect',
      command: 'printf "LINE-ONE\\n"; printf "LINE-TWO\\n"',
      onChunk: (c) => chunks.push(c.stdout),
    });
    expect(run.exitCode).toBe(0);
    expect(chunks.some((t) => t.includes('LINE-ONE'))).toBe(true);
    expect(chunks.at(-1)).toContain('LINE-TWO');
  }, 60_000);


  test('the shell is scrubbed and bounded: host env, /etc, ulimits, cwd', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
    const inspection = await runWitnessCommand({
      ...sandbox,
      mode: 'inspect',
      command: 'pwd && test ! -e /etc/passwd && test "$(ulimit -u)" = 4096 && printf "HOST_SECRET=%s\\n" "${NEUMA_SANDBOX_HOST_SECRET-unset}"',
    });
    expect(inspection.exitCode).toBe(0);
    expect(inspection.stdout).toContain(sandbox.sourceRoot);
    expect(inspection.stdout).toContain('HOST_SECRET=unset');
  }, 60_000);

  test('secret-shaped paths are masked from the shell view, in every shape', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
    const masks = sandbox.masks;
    expect(masks.files).toContain(path.join(source, '.env'));
    expect(masks.files).toContain(path.join(source, 'env.operator'));
    expect(masks.files).toContain(path.join(source, 'infra.tfstate'));
    expect(masks.dirs).toEqual(expect.arrayContaining([
      path.join(source, '.aws'), path.join(source, '.AWS'), path.join(source, '.git'),
      path.join(source, 'ai-witnesses'), path.join(source, 'data', 'settings'),
      path.join(source, 'data', 'dna'),
    ]));
    // node_modules is never walked — the same exposure the copy design had
    // when it ro-bound the real dependency tree into the shell.
    expect(masks.files).not.toContain(path.join(source, 'node_modules', 'dep', '.env'));

    const probe = await runWitnessCommand({
      ...sandbox,
      mode: 'inspect',
      command: 'cat .env; cat env.operator; cat .npmrc; cat credentials.json; cat infra.tfstate; '
        + 'cat .aws/credentials; cat .AWS/credentials; cat .git/config; '
        + 'ls ai-witnesses; ls data/settings; ls data/dna; git rev-parse HEAD; true',
    });
    expect(probe.stdout).not.toContain('never-cross');
    expect(probe.stderr).not.toContain('never-cross');
    expect(probe.stdout).not.toContain('token');
    expect(probe.stdout).not.toContain('key.json');
    expect(probe.stdout).not.toContain('soul.json');

    // In-shell git is dead by design: the internals are masked, so there is no
    // second git identity to misreport (2026-07-29's hazard, gone structurally).
    const git = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'git rev-parse HEAD' });
    expect(git.exitCode).not.toBe(0);
  }, 60_000);

  test('writes land in the upper layer, never on the ground, and persist across reopen', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
    const write = await runWitnessCommand({
      ...sandbox, mode: 'write', command: 'printf "verified\\n" > result.txt',
    });
    expect(write.exitCode).toBe(0);
    expect(await fs.readFile(path.join(sandbox.workspace, 'result.txt'), 'utf8')).toBe('verified\n');
    await expect(fs.stat(path.join(source, 'result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });

    const reopened = await ensureWitnessCodingSandbox(LANE_ID, source);
    expect(reopened.created).toBe(false);
    const readBack = await runWitnessCommand({ ...reopened, mode: 'inspect', command: 'cat result.txt' });
    expect(readBack.exitCode).toBe(0);
    expect(readBack.stdout).toContain('verified');
  }, 60_000);

  test('inspect mode cannot write, and a shell deletion is a whiteout the ground never feels', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
    const blocked = await runWitnessCommand({
      ...sandbox, mode: 'inspect', command: 'printf nope > blocked.txt',
    });
    expect(blocked.exitCode).not.toBe(0);
    await expect(fs.stat(path.join(sandbox.workspace, 'blocked.txt'))).rejects.toMatchObject({ code: 'ENOENT' });

    const removal = await runWitnessCommand({ ...sandbox, mode: 'write', command: 'rm README.md' });
    expect(removal.exitCode).toBe(0);
    expect(await fs.readFile(path.join(source, 'README.md'), 'utf8')).toBe('# sandbox source\n');
    const view = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'test -e README.md' });
    expect(view.exitCode).not.toBe(0);
  }, 60_000);

  test('a ground that is not a directory is refused with the reason', async () => {
    const filePath = path.join(root, 'not-a-folder.txt');
    await fs.writeFile(filePath, 'file\n');
    await expect(ensureWitnessCodingSandbox(LANE_ID, filePath))
      .rejects.toThrow(/not an existing directory/);
  });

  test('a shell cannot overlay its own lane', async () => {
    await expect(ensureWitnessCodingSandbox(LANE_ID, neumaWorkspace.pathFor(LANE_ID)))
      .rejects.toThrow(/cannot overlay its own lane/);
  });

  test('the mask sweep alone is callable and honest about node_modules', async () => {
    const masks = await enumerateSecretMasks(source);
    expect(masks.files).toContain(path.join(source, '.env'));
    expect(masks.files.every((p) => !p.includes(`${path.sep}node_modules${path.sep}`))).toBe(true);
  });

  test('an unadvertised network mode cannot reach a real host listener', async () => {
    let reached = false;
    const server = http.createServer((_req, res) => {
      reached = true;
      res.end('reachable');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const sandbox = await ensureWitnessCodingSandbox(LANE_ID, source);
      const port = server.address().port;
      const result = await runWitnessCommand({
        ...sandbox,
        mode: 'network',
        command: `node -e "fetch('http://127.0.0.1:${port}').then(() => process.exit(0)).catch(() => process.exit(7))"`,
      });
      expect(result.mode).toBe('inspect');
      expect(result.exitCode).toBe(7);
      expect(reached).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);
});
