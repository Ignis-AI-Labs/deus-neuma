// Real shell/compiler, filesystem guard, task settlement and Git metadata.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace from '../../core/workspace/neuma-workspace.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { createHarnessGitKit, fixtureGit } from '../helpers/harness-git-kit.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import { readGroundGit } from '../../backend/services/ground-git.js';
import { clearLaneBinding, clearSessionRuntime } from '../../backend/routes/portal-connections.js';
import { prepareOverlayFreshness } from '../../backend/services/overlay-freshness.js';

let kit;
let git;
let priorRoots = null;
beforeEach(async () => {
  kit = await createHarnessTurnKit();
  kit.connection.toolWorkspace = kit.ground;
  // The ground stands OPEN in the Explorer, as a focused desk has it: since
  // SEC-038 (fd1498261) a focus ground reaches the filesystem organ only as
  // an opened root, never merely by being named (#566).
  priorRoots = getRoots();
  setRoots([...priorRoots, kit.ground]);
  kit.client.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.type === 'tool:approval_request') kit.decide(frame, 'allow');
  });
});
afterEach(async () => {
  await mcpService.disconnect('filesystem');
  await git?.close(); git = null;
  await kit?.close();
  if (priorRoots) setRoots(priorRoots);
  priorRoots = null;
});
const call = (toolName, args) => ({ server: 'fs', toolName, tool: `fs/${toolName}`, args });
const runCalls = (calls) => processToolCalls(kit.ws, '', kit.connection, calls);

describe('operator feedback regressions', () => {
  test('masked secret directories stay unreadable even with source-shaped credential children', async () => {
    for (const directory of ['.env', 'keys']) {
      await fs.mkdir(path.join(kit.ground, directory));
      await fs.writeFile(path.join(kit.ground, directory, 'credentials.ts'), 'PRIVATE_DIRECTORY_MARKER');
    }
    const sandbox = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
    for (const directory of ['.env', 'keys']) {
      expect(sandbox.masks.dirs).toContain(path.join(kit.ground, directory));
      const result = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: `cat ${directory}/credentials.ts` });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain('PRIVATE_DIRECTORY_MARKER');
    }
  });

  test('an older source mask upgrades without losing unrelated upper build artifacts', async () => {
    await fs.mkdir(path.join(kit.ground, 'src'));
    const source = path.join(kit.ground, 'src', 'credentials.ts');
    await fs.writeFile(source, 'export const current = true;');
    const directory = path.join(kit.root, 'old-shell');
    for (const name of ['upper', 'work', 'empty-dir']) await fs.mkdir(path.join(directory, name), { recursive: true });
    await fs.writeFile(path.join(directory, 'empty'), '');
    const previous = { workspace: path.join(directory, 'upper'), sourceRoot: kit.ground, masks: { dirs: [], files: [source] } };
    await prepareOverlayFreshness(previous);
    const built = await runWitnessCommand({ ...previous, mode: 'write', command: 'mkdir dist; echo kept > dist/result.txt' });
    expect(built.exitCode, built.stderr).toBe(0);
    const current = { ...previous, masks: { dirs: [], files: [] } };
    await prepareOverlayFreshness(current);
    const read = await runWitnessCommand({ ...current, mode: 'inspect', command: 'cat src/credentials.ts; cat dist/result.txt' });
    expect(read.exitCode, read.stderr).toBe(0);
    expect(read.stdout).toContain('export const current = true;');
    expect(read.stdout).toContain('kept');
  });

  test('real inspect and execute run commands, not bwrap usage; inspect cannot emit files', async () => {
    const sandbox = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
    const inspect = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'echo alive' });
    expect(inspect.exitCode, inspect.stderr).toBe(0);
    expect(inspect.stdout).toBe('alive\n');
    const refusal = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'echo no > inspect-output.txt' });
    expect(refusal.exitCode).not.toBe(0);
    const execute = await runWitnessCommand({ ...sandbox, mode: 'write', command: 'echo yes > execute-output.txt' });
    expect(execute.exitCode, execute.stderr).toBe(0);
    expect(await fs.readFile(path.join(sandbox.workspace, 'execute-output.txt'), 'utf8')).toBe('yes\n');
    await expect(fs.stat(path.join(kit.ground, 'execute-output.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('real tsc reads both credentials.ts modules and emits/runs dist in execute', async () => {
    const source = path.join(kit.ground, 'src');
    await fs.mkdir(path.join(source, 'ai'), { recursive: true });
    await fs.mkdir(path.join(source, 'cex-api'), { recursive: true });
    await fs.writeFile(path.join(source, 'ai', 'credentials.ts'), 'export const ai = 1;\n');
    await fs.writeFile(path.join(source, 'cex-api', 'credentials.ts'), 'export const cex = 2;\n');
    await fs.writeFile(path.join(source, 'main.ts'), 'import { ai } from "./ai/credentials"; import { cex } from "./cex-api/credentials"; console.log(ai + cex);\n');
    await fs.writeFile(path.join(kit.ground, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'CommonJS', types: [], skipLibCheck: true, outDir: 'dist' }, include: ['src'],
    }));
    const compiler = fileURLToPath(new URL('../../node_modules/typescript', import.meta.url));
    await fs.cp(compiler, path.join(kit.ground, 'node_modules', 'typescript'), { recursive: true });
    const sandbox = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
    expect(sandbox.masks.files.some((name) => name.endsWith('credentials.ts'))).toBe(false);
    const check = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit' });
    expect(check.exitCode, check.stdout + check.stderr).toBe(0);
    const build = await runWitnessCommand({ ...sandbox, mode: 'write', command: 'node node_modules/typescript/bin/tsc -p tsconfig.json && node dist/main.js' });
    expect(build.exitCode, build.stdout + build.stderr).toBe(0);
    expect(build.stdout.trim()).toBe('3');
    expect(await fs.readFile(path.join(sandbox.workspace, 'dist', 'ai', 'credentials.js'), 'utf8')).toContain('exports.ai');
    await expect(fs.stat(path.join(kit.ground, 'dist'))).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.writeFile(path.join(source, 'ai', 'credentials.ts'), 'export const ai: number = "not a number";\n');
    const broken = await runWitnessCommand({ ...sandbox, mode: 'inspect', command: 'node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit' });
    expect(broken.exitCode).not.toBe(0);
    expect(broken.stdout).toContain('TS2322');
  }, 30000);

  test('real file reads and task intents accept source paths in prose while secret bytes remain sealed', async () => {
    await fs.mkdir(path.join(kit.ground, 'src'), { recursive: true });
    const code = path.join(kit.ground, 'src', 'credentials.ts');
    const secret = path.join(kit.ground, 'credentials.json');
    const dotenv = path.join(kit.ground, '.env');
    await fs.writeFile(code, 'export const configured = false;\n');
    await fs.writeFile(secret, '{"token":"REVIEW_ONLY_SECRET_MARKER"}');
    await fs.writeFile(dotenv, 'TOKEN=REVIEW_ONLY_SECRET_MARKER');
    const alias = path.join(kit.ground, 'credentials.ts');
    await fs.symlink(secret, alias);
    await connectFilesystemServer();
    const read = await runCalls([call('read', { path: code })]);
    expect(read[0].status, JSON.stringify(read)).toBe('ok');
    expect(read[0].content).toContain('export const configured');
    for (const target of [secret, dotenv, alias]) {
      const refused = await runCalls([call('read', { path: target })]);
      expect(refused[0].status).not.toBe('ok');
      expect(JSON.stringify(refused)).not.toContain('REVIEW_ONLY_SECRET_MARKER');
    }
    const target = path.join(workspace.pathFor(kit.laneId), 'intents', 'build-followup.json');
    const folder = await runCalls([call('write', { path: path.dirname(target), directory: true })]);
    expect(folder[0].status, JSON.stringify(folder)).toBe('ok');
    const title = 'Investigate src/ai/credentials.ts, cex-api/credentials.ts and .env masking; do not edit config/tool-policy.json';
    const content = JSON.stringify({ type: 'tasks/add', title });
    const written = await runCalls([call('write', { path: target, content })]);
    expect(written[0].status, JSON.stringify(written)).toBe('ok');
    expect(await fs.readFile(target, 'utf8')).toBe(content);
    expect(written.some((receipt) => receipt.tool === 'intents/tasks.add' && receipt.status === 'ok')).toBe(true);
    expect((await workspace.readTaskLedger(kit.laneId)).tasks.some((task) => task.title === title)).toBe(true);
  });

  test('local metadata read accepts editor/LFS preferences and SSH remote without any transport access', async () => {
    git = await createHarnessGitKit();
    for (const [key, value] of [
      ['branch.main.vscode-merge-base', 'deadbeef'], ['lfs.repositoryformatversion', '0'],
      ['lfs.https://github.com/example/project.git/info/lfs.access', 'basic'],
      ['user.signingkey', 'PUBLIC-FIXTURE-ID'], ['commit.gpgsign', 'true'], ['pull.rebase', 'true'],
    ]) await fixtureGit(git.ground, ['config', key, value]);
    await fixtureGit(git.ground, ['remote', 'set-url', 'origin', 'git@github.com:example/project.git']);
    expect(await readGroundGit(git.ground)).toMatchObject({ isRepository: true, branch: 'main', upstream: 'origin/main' });
    expect(git.requests).toHaveLength(0);
    await fixtureGit(git.ground, ['config', 'filter.fixture.process', 'echo MUST_NOT_EXECUTE']);
    await expect(readGroundGit(git.ground)).rejects.toMatchObject({ code: 'unsafe_config', category: 'filter' });
    try { await readGroundGit(git.ground); } catch (error) {
      expect(error.message).toContain('No remote transport was tested');
      expect(error.message).not.toContain('MUST_NOT_EXECUTE');
    }
  });

  test.each([['lane rebinding', clearLaneBinding], ['session reset', clearSessionRuntime]])('session-only Git allowances never survive %s', (_name, reset) => {
    kit.connection._sessionToolPolicy = { coding: { allowed: ['ground_git', 'ground_sync'] } };
    reset(kit.connection);
    expect(kit.connection._sessionToolPolicy).toBeNull();
  });
});
