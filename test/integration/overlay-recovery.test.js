// Real refused overlay -> signed approval -> fresh bwrap build, both tool seats.
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { fixtureGit } from '../helpers/harness-git-kit.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import { beingCodingToolsFor, stashBeingTurnCatalog, discloseTurnTools, TOOL_SEARCH_TOOL } from '../../backend/services/being-tool-surface.js';
import { toolsForWitness } from '../../backend/services/witness-tools.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { processWitnessToolBatch } from '../../backend/services/witness-tool-batch.js';
import { createTurnToolEpochs } from '../../backend/services/portal-tool-epochs.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';
import workspace from '../../core/workspace/neuma-workspace.js';

let kit, old, runtime;
const exec = promisify(execFile);
const call = (name, args = {}) => ({ server: 'coding', toolName: name, tool: `coding/${name}`, args });
const pointer = () => path.join(old.anchor, 'active.json');
const populate = async (seat) => {
  if (seat === 'witness') runtime = await toolsForWitness(kit.connection, kit.ground, { nativeTools: true });
  else {
    // The fs primitives ride every being turn's catalog (portal-stream advertises them).
    const tools = await beingCodingToolsFor(kit.connection);
    await stashBeingTurnCatalog(kit.connection, [TOOL_SEARCH_TOOL, ...withFsPrimitives(mcpService.getToolsContext().available_tools), ...tools], []);
  }
};
const batch = (seat, calls, turn = createTurnToolEpochs()) => seat === 'witness'
  ? processWitnessToolBatch({ ws: kit.ws, connection: kit.connection, calls, runtime, turn })
  : processToolCalls(kit.ws, '', kit.connection, calls, turn);
const nextCard = (after) => untilHarness(() => kit.frames.slice(after)
  .find((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/sandbox_recover'));

describe.each(['portal', 'witness'])('%s recoverable coding shell', (seat) => {
  beforeEach(async () => {
    kit = await createHarnessTurnKit(seat === 'witness' ? 'witness-test-HarnessFixture' : 'neuma-turn-fixture');
    kit.connection.toolWorkspace = kit.ground;
    await connectFilesystemServer();
    await fs.writeFile(path.join(kit.ground, 'check.cjs'),
      'const fs = require("node:fs"); if(fs.existsSync("old-shell-only.txt")) process.exit(2); fs.mkdirSync("dist",{recursive:true}); fs.writeFileSync("dist/result.txt","fresh build"); process.stdout.write("BUILD_OK");\n');
    await fixtureGit(kit.ground, ['init', '--quiet', '--initial-branch=main']);
    await fixtureGit(kit.ground, ['add', 'check.cjs']);
    await fixtureGit(kit.ground, ['commit', '--quiet', '-m', 'fixture']);
    old = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
    const wrote = await runWitnessCommand({ ...old, mode: 'write', command: 'echo preserved > old-shell-only.txt' });
    expect(wrote.exitCode, wrote.stderr).toBe(0);
    // A real source/mask transition, not an invented error or mocked factory.
    await fs.mkdir(path.join(kit.ground, 'keys'));
    await fs.writeFile(path.join(kit.ground, 'keys', 'secret.txt'), 'SECRET_MUST_STAY_MASKED');
    await expect(ensureWitnessCodingSandbox(kit.laneId, kit.ground)).rejects.toMatchObject({ code: 'OVERLAY_CONFLICT' });
    await populate(seat);
    kit.client.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'tool:approval_request' && frame.tool !== 'coding/sandbox_recover') {
        kit.decide(frame, frame.tool === 'coding/shell_network' ? 'deny' : 'allow');
      }
    });
  });
  afterEach(async () => { await mcpService.disconnect('filesystem'); await kit?.close(); });

  test('ordinary file writes cannot forge shell control state or move its ancestors; preserved upper stays readable', async () => {
    const forged = '00000000-0000-4000-8000-000000000000';
    const targets = [
      { server: 'fs', toolName: 'write', args: { path: pointer(), content: JSON.stringify({ version: 1, generation: forged }) } },
      { server: 'fs', toolName: 'write', args: { path: path.join(old.anchor, 'generations', forged), directory: true } },
      { server: 'fs', toolName: 'write', args: { path: path.join(old.anchor, 'generations', forged, 'upper', 'nested'), directory: true } },
      { server: 'fs', toolName: 'edit', args: { path: path.dirname(old.anchor), destination: path.join(kit.ground, 'stolen-controls') } },
      { server: 'fs', toolName: 'edit', args: { path: old.workspace, destination: path.join(kit.ground, 'stolen-upper') } },
    ];
    for (const attempt of targets) {
      const result = await batch(seat, [attempt]);
      expect(result[0].status).not.toBe('ok');
      expect(result[0].error).toContain('platform-managed');
    }
    const baseline = path.join(old.anchor, 'lower-baseline.json');
    const before = await fs.readFile(baseline, 'utf8');
    const alias = path.join(old.workspace, 'innocent.json');
    await fs.symlink(baseline, alias);
    const aliasWrite = await batch(seat, [{ server: 'fs', toolName: 'write', args: { path: alias, content: '{}' } }]);
    expect(aliasWrite[0].status).not.toBe('ok');
    expect(await fs.readFile(baseline, 'utf8')).toBe(before);
    const artifact = await batch(seat, [{ server: 'fs', toolName: 'read', args: { path: path.join(old.workspace, 'old-shell-only.txt') } }]);
    expect(artifact[0].status).toBe('ok');
    expect(artifact[0].content).toContain('preserved');
    await expect(fs.stat(pointer())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('conflict exposes recovery and independent Git; approval restores same-turn execution without losing old work', async () => {
    const initial = kit.connection._turnCatalog.filter((tool) => tool.server === 'coding').map((tool) => tool.name);
    // Load on demand: both seats prepare the shell at the first act, so the
    // conflict is learned there — answered with the reason — not before the message.
    expect(initial).toContain('execute');
    const blocked = await batch(seat, [call('execute', { command: 'node check.cjs' })]);
    expect(blocked[0].status, JSON.stringify(blocked)).toBe('unavailable');
    expect(blocked[0].error).toContain('The coding shell is unavailable this turn');
    expect(kit.connection._turnSandbox).toBeNull();
    const found = discloseTurnTools(kit.connection, { query: 'reconcile harvest' });
    expect(JSON.parse(found.content).tools.map((tool) => tool.id)).toContain('coding/sandbox_recover');
    const git = await batch(seat, [call('ground_git')]);
    expect(git[0].status, JSON.stringify(git)).toBe('ok');
    expect(git[0].content).toContain('branch:   main');
    const before = kit.frames.length;
    const running = batch(seat, [call('sandbox_recover'), call('execute', { command: 'node check.cjs' })]);
    const card = await nextCard(before);
    expect(JSON.stringify(card)).toContain(old.workspace);
    await expect(fs.stat(pointer())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(old.workspace, 'old-shell-only.txt'), 'utf8')).toBe('preserved\n');
    kit.decide(card, 'allow');
    const results = await running;
    expect(results.map((result) => result.status), JSON.stringify(results)).toEqual(['ok', 'ok']);
    const receipt = JSON.parse(results[0].content);
    expect(receipt).toMatchObject({ preservedUpper: old.workspace, projectChanged: false, gitChanged: false });
    expect(results[1].content).toContain('BUILD_OK');
    const fresh = kit.connection._turnSandbox;
    expect(fresh.workspace).not.toBe(old.workspace);
    expect(await fs.readFile(path.join(fresh.workspace, 'dist', 'result.txt'), 'utf8')).toBe('fresh build');
    expect(await fs.readFile(path.join(old.workspace, 'old-shell-only.txt'), 'utf8')).toBe('preserved\n');
    await expect(fs.stat(path.join(kit.ground, 'dist'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fixtureGit(kit.ground, ['branch', '--show-current'])).toBe('main');
    expect((await ensureWitnessCodingSandbox(kit.laneId, kit.ground)).workspace).toBe(fresh.workspace);
    const workspaceModule = new URL('../../core/workspace/neuma-workspace.js', import.meta.url).href;
    const shellModule = new URL('../../backend/services/witness-coding-sandbox.js', import.meta.url).href;
    const electron = fileURLToPath(new URL('../../node_modules/electron/dist/electron', import.meta.url));
    const script = `
      import assert from 'node:assert/strict';
      import { setWorkspacesRoot, setWitnessesRoot } from ${JSON.stringify(workspaceModule)};
      import { ensureWitnessCodingSandbox, runWitnessCommand } from ${JSON.stringify(shellModule)};
      setWorkspacesRoot(${JSON.stringify(path.join(kit.root, 'lanes'))});
      setWitnessesRoot(${JSON.stringify(path.join(kit.root, 'witnesses'))});
      const shell = await ensureWitnessCodingSandbox(${JSON.stringify(kit.laneId)}, ${JSON.stringify(kit.ground)});
      assert.equal(shell.workspace, ${JSON.stringify(fresh.workspace)});
      const result = await runWitnessCommand({ ...shell, mode: 'inspect', command: 'echo recovered' });
      assert.equal(result.exitCode, 0, result.stderr);
      process.stdout.write(result.stdout);
    `;
    const reopened = await exec(electron, ['--experimental-detect-module', '--input-type=module', '-e', script], {
      timeout: 10000, env: { PATH: process.env.PATH, HOME: kit.root, NEUMA_DATA_ROOT: path.join(kit.root, 'data'), ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(reopened.stdout).toBe('recovered\n');
    await expect(runWitnessCommand({ ...old, mode: 'write', command: 'touch MUST_NOT_RUN' })).rejects.toMatchObject({ code: 'OVERLAY_CONFLICT' });
    await expect(fs.stat(path.join(old.workspace, 'MUST_NOT_RUN'))).rejects.toMatchObject({ code: 'ENOENT' });
    const secret = await batch(seat, [call('inspect', { command: 'cat keys/secret.txt' })]);
    expect(secret[0].status).toBe('error');
    expect(JSON.stringify(secret)).not.toContain('SECRET_MUST_STAY_MASKED');
  }, 30000);

  test('the recovered shell runs a real TypeScript build using live credential source modules', async () => {
    await fs.mkdir(path.join(kit.ground, 'src'), { recursive: true });
    await fs.writeFile(path.join(kit.ground, 'src', 'credentials.ts'), 'export const answer: number = 42;\n');
    await fs.writeFile(path.join(kit.ground, 'src', 'main.ts'), 'import { answer } from "./credentials"; console.log(answer);\n');
    await fs.writeFile(path.join(kit.ground, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'CommonJS', types: [], skipLibCheck: true, outDir: 'dist',
    }, include: ['src'] }));
    await fs.cp(fileURLToPath(new URL('../../node_modules/typescript', import.meta.url)),
      path.join(kit.ground, 'node_modules', 'typescript'), { recursive: true });
    const before = kit.frames.length;
    const running = batch(seat, [call('sandbox_recover'), call('execute', {
      command: 'node node_modules/typescript/bin/tsc -p tsconfig.json && node dist/main.js',
    })]);
    kit.decide(await nextCard(before), 'allow');
    const results = await running;
    expect(results.map((result) => result.status), JSON.stringify(results)).toEqual(['ok', 'ok']);
    expect(results[1].content).toContain('42');
    expect(await fs.readFile(path.join(kit.connection._turnSandbox.workspace, 'dist', 'credentials.js'), 'utf8')).toContain('exports.answer');
    expect(await fs.readFile(path.join(old.workspace, 'old-shell-only.txt'), 'utf8')).toBe('preserved\n');
    await expect(fs.stat(path.join(kit.ground, 'dist'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30000);

  test.each(['deny', 'interrupt', 'rebind'])('%s before publication preserves original work and does not switch generations', async (decision) => {
    const before = kit.frames.length;
    const running = batch(seat, [call('sandbox_recover')]);
    const card = await nextCard(before);
    if (decision === 'deny') kit.decide(card, 'deny');
    else if (decision === 'interrupt') kit.connection.activeTurn.abort();
    else kit.connection.sessionId = 'different-session';
    const result = await running;
    expect(result[0].status).not.toBe('ok');
    await expect(fs.stat(pointer())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(old.workspace, 'old-shell-only.txt'), 'utf8')).toBe('preserved\n');
    expect(kit.connection._pendingApprovals.size).toBe(0);
    await expect(fs.stat(path.join(old.anchor, 'generations'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('AUTO still asks, observe holds, malformed args and active locks never create a replacement', async () => {
    kit.connection.toolMode = 'observe';
    expect((await batch(seat, [call('sandbox_recover')]))[0].status).toBe('denied');
    expect(kit.frames.filter((frame) => frame.type === 'tool:approval_request')).toHaveLength(0);
    kit.connection.toolMode = 'auto';
    // sandbox_recover takes no fields: the one argument check refuses before the handler (tool-args-check.js)
    expect((await batch(seat, [call('sandbox_recover', { discard: true })]))[0].status).toBe('invalid');
    await populate(seat);
    const before = kit.frames.length;
    const running = batch(seat, [call('sandbox_recover')]);
    const card = await nextCard(before);
    kit.decide(card, 'deny');
    expect((await running)[0].status).toBe('denied');
    await fs.writeFile(path.join(old.anchor, 'command.lock'), 'unknown owner; must not be stolen');
    const locked = await batch(seat, [call('sandbox_recover')]);
    expect(locked[0].status).toBe('error');
    expect(await fs.readFile(path.join(old.anchor, 'command.lock'), 'utf8')).toContain('unknown owner');
    await fs.unlink(path.join(old.anchor, 'command.lock')); // fixture's own deliberately held lock
    await expect(fs.stat(pointer())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('interruption after real generation preparation begins leaves old state usable for a later recovery', async () => {
    const before = kit.frames.length;
    const running = batch(seat, [call('sandbox_recover')]);
    const card = await nextCard(before);
    let prepared = false;
    const watcher = watch(old.anchor, (_event, name) => {
      if (name === 'generations') { prepared = true; kit.connection.activeTurn.abort(); }
    });
    try {
      kit.decide(card, 'allow');
      expect((await running)[0].status).toBe('interrupted');
      expect(prepared).toBe(true);
      await expect(fs.stat(pointer())).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(path.join(old.workspace, 'old-shell-only.txt'), 'utf8')).toBe('preserved\n');
    } finally { watcher.close(); }
    kit.connection.activeTurn = new AbortController();
    await populate(seat);
    const next = kit.frames.length;
    const retry = batch(seat, [call('sandbox_recover')]);
    kit.decide(await nextCard(next), 'allow');
    expect((await retry)[0].status).toBe('ok');
    expect((await workspace.readToolPolicy(kit.laneId))?.coding?.allowed || []).not.toContain('sandbox_recover');
  });

  test('an interrupt at the real temporary-pointer write stops publication before its rename', async () => {
    const before = kit.frames.length;
    const running = batch(seat, [call('sandbox_recover')]);
    const card = await nextCard(before);
    let reachedPublication = false;
    const watcher = watch(old.anchor, (_event, name) => {
      if (name?.startsWith('active.json.tmp-')) {
        reachedPublication = true;
        kit.connection.activeTurn.abort();
      }
    });
    try {
      kit.decide(card, 'allow');
      expect((await running)[0].status).toBe('interrupted');
      expect(reachedPublication).toBe(true);
      await expect(fs.stat(pointer())).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(path.join(old.workspace, 'old-shell-only.txt'), 'utf8')).toBe('preserved\n');
    } finally { watcher.close(); }
  });
});
