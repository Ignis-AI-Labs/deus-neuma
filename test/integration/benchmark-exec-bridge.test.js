// THE BENCHMARK EXEC BRIDGE (#531) — proven against a REAL container.
// Rule 0: every claim below runs the real podman runtime (local
// debian:bullseye-slim, already in the store); the pure laws run on real
// inputs with no doubles anywhere.

import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  benchmarkBridgeConfig,
  containerPathFor,
  runBridgedCommand,
  mirrorGroundPaths,
  withBenchmarkGroundMirror,
  runSeatCommand,
} from '../../backend/services/benchmark-exec-bridge.js';
import { resolveBenchmarkExecBridge } from '../../cli/lib/benchmark-scope.js';

const exec = promisify(execFile);
const CLI = 'podman';
const IMAGE = 'debian:bullseye-slim';
const RUNTIME_PRESENT = await exec(CLI, ['images', '-q', IMAGE])
  .then(({ stdout }) => stdout.trim().length > 0)
  .catch(() => false);

const containerIds = [];
const startContainer = async () => {
  // The real tbench task container carries /app (the extracted ground);
  // recreate that shape rather than testing a weaker layout.
  const { stdout } = await exec(CLI, ['run', '-d', '--rm', IMAGE, '/bin/sh', '-lc', 'mkdir -p /app && sleep 120']);
  const id = stdout.trim();
  containerIds.push(id);
  return id;
};

describe('bridge configuration (pure)', () => {
  it('is null for every undeclared seat', () => {
    expect(benchmarkBridgeConfig({})).toBeNull();
    expect(benchmarkBridgeConfig({ _benchmarkExecBridge: null })).toBeNull();
  });

  it('freezes the declared shape and refuses a malformed one', () => {
    const config = benchmarkBridgeConfig({
      _benchmarkExecBridge: { cli: 'docker', containerId: 'abc123', workdir: '/app', ground: '/tmp/g' },
    });
    expect(config).toEqual({ cli: 'docker', containerId: 'abc123', workdir: '/app', ground: '/tmp/g' });
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => benchmarkBridgeConfig({ _benchmarkExecBridge: { cli: 'ftp', containerId: 'x', workdir: '/', ground: '/' } }))
      .toThrow(/invalid/);
  });

  it('maps host paths under the ground only, and never the ground root itself', () => {
    const config = { cli: 'docker', containerId: 'x', workdir: '/app', ground: '/tmp/g' };
    expect(containerPathFor(config, '/tmp/g/src/main.py')).toBe('/app/src/main.py');
    expect(containerPathFor(config, '/tmp/g/a b/c.txt')).toBe('/app/a b/c.txt');
    expect(containerPathFor(config, '/tmp/g')).toBeNull();
    expect(containerPathFor(config, '/tmp/other/secret')).toBeNull();
    expect(containerPathFor(config, '')).toBeNull();
  });

  it('resolveBenchmarkExecBridge is declared-only and demands its container id', () => {
    expect(resolveBenchmarkExecBridge({}, {}).bridge).toBeNull();
    expect(resolveBenchmarkExecBridge({ benchmarkExecBridge: 'podman' }, {}).error)
      .toMatch(/must be "docker"/);
    expect(resolveBenchmarkExecBridge({ benchmarkExecBridge: 'docker' }, {}).error)
      .toMatch(/--benchmark-base-weights/);
    expect(resolveBenchmarkExecBridge({ benchmarkExecBridge: 'docker', benchmarkBaseWeights: true }, {}).error)
      .toMatch(/NEUMA_TBENCH_CONTAINER_ID/);
    const { bridge } = resolveBenchmarkExecBridge({
      benchmarkExecBridge: 'docker', benchmarkBaseWeights: true,
    }, { NEUMA_TBENCH_CONTAINER_ID: 'trial-7', NEUMA_TBENCH_CONTAINER_WORKDIR: '/work' });
    expect(bridge).toEqual({ cli: 'docker', containerId: 'trial-7', workdir: '/work' });
  });
});

describe.runIf(RUNTIME_PRESENT)('the bridge against a real container', () => {
  let config;
  let ground;

  afterAll(async () => {
    await Promise.all(containerIds.map((id) => exec(CLI, ['stop', '-t', '0', id]).catch(() => {})));
    if (ground) await fs.rm(ground, { recursive: true, force: true }).catch(() => {});
  });

  const containerOutput = async (command) => {
    const { stdout } = await exec(CLI, ['exec', config.containerId, '/bin/sh', '-lc', command]);
    return stdout;
  };

  it('runs commands in the live container and reports their real outcomes', async () => {
    const id = await startContainer();
    ground = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-ground-'));
    config = { cli: CLI, containerId: id, workdir: '/app', ground };
    const ok = await runBridgedCommand({ config, command: 'printf hello-from-container && pwd' });
    expect(ok.exitCode).toBe(0);
    expect(ok.timedOut).toBe(false);
    expect(ok.stdout).toContain('hello-from-container');
    expect(ok.stdout.trim().endsWith('/app')).toBe(true);
    const failing = await runBridgedCommand({ config, command: 'exit 3' });
    expect(failing.exitCode).toBe(3);
    const merged = await runBridgedCommand({ config, command: 'echo out; echo err 1>&2' });
    expect(merged.stdout).toContain('out');
    expect(merged.stderr).toContain('err');
  }, 60_000);

  it('inspect reads the graded container, not the host photocopy (2026-10-07)', async () => {
    await containerOutput('echo container-only > /app/live-state.txt');
    const seen = await runSeatCommand({ connection: { _benchmarkExecBridge: config }, command: 'cat /app/live-state.txt', mode: 'inspect' });
    expect(seen.exitCode).toBe(0);
    expect(seen.stdout).toContain('container-only');
    expect(seen.mode).toBe('inspect');
  }, 60_000);

  it('bounds a runaway command by its timeout', async () => {
    const result = await runBridgedCommand({ config, command: 'sleep 30', timeoutMs: 1_500 });
    expect(result.timedOut).toBe(true);
  }, 30_000);

  it('mirrors ground writes into the container the grader sees', async () => {
    const hostPath = path.join(ground, 'src');
    await fs.mkdir(hostPath, { recursive: true });
    const file = path.join(hostPath, 'landing.txt');
    await fs.writeFile(file, 'written by the being\n');
    const notes = await mirrorGroundPaths(config, [file]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('/app/src/landing.txt');
    const seen = await containerOutput('cat /app/src/landing.txt');
    expect(seen).toBe('written by the being\n');
    // A space in the relative path is exactly where a container-side mkdir
    // breaks if the bridge stops quoting; a directory must land as CONTENTS.
    const spaced = path.join(ground, 'weird dir', 'result file.txt');
    await fs.mkdir(path.dirname(spaced), { recursive: true });
    await fs.writeFile(spaced, 'spaced\n');
    const spacedNotes = await mirrorGroundPaths(config, [spaced]);
    expect(spacedNotes).toHaveLength(1);
    const seenSpaced = await containerOutput('cat "/app/weird dir/result file.txt"');
    expect(seenSpaced).toBe('spaced\n');
    const dir = path.join(ground, 'pkg', 'nested');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'module.py'), 'VALUE = 1\n');
    const dirNotes = await mirrorGroundPaths(config, [dir]);
    expect(dirNotes).toHaveLength(1);
    const seenDir = await containerOutput('cat /app/pkg/nested/module.py');
    expect(seenDir).toBe('VALUE = 1\n');
    // A rewrite keeps the mode the being set in the container (2026-10-07).
    await containerOutput('chmod 755 /app/src/landing.txt');
    await fs.writeFile(file, 'rewritten\n');
    await fs.chmod(file, 0o644);
    await mirrorGroundPaths(config, [file]);
    expect((await containerOutput('cat /app/src/landing.txt'))).toBe('rewritten\n');
    expect((await containerOutput('stat -c %a /app/src/landing.txt')).trim()).toBe('755');
    const outside = await mirrorGroundPaths(config, ['/etc/hostname']);
    expect(outside).toHaveLength(0);
  }, 60_000);

  it('the fs wrapper mirrors writes and surfaces the container tests, untouched when not engaged', async () => {
    const connection = { _benchmarkExecBridge: config };
    const callTool = async (serverName, toolName, args = {}) => {
      if (serverName === 'fs' && toolName === 'write') {
        await fs.writeFile(path.resolve(args.path), args.content);
      }
      if (serverName === 'fs' && toolName === 'list') {
        return { content: [{ type: 'text', text: 'GROUND LISTING' }] };
      }
      return { content: [] };
    };
    const wrapped = withBenchmarkGroundMirror(callTool, connection);
    await wrapped('fs', 'write', { path: path.join(ground, 'mirrored.txt'), content: 'mirror me' });
    const seen = await containerOutput('cat /app/mirrored.txt');
    expect(seen).toBe('mirror me');
    await exec(CLI, ['exec', config.containerId, '/bin/sh', '-lc', 'mkdir -p /tests && touch /tests/run-tests.sh']);
    const listed = await wrapped('fs', 'list', { path: ground });
    const text = listed.content.map(({ text }) => text).join('\n');
    expect(text).toContain('GROUND LISTING');
    expect(text).toContain('/tests/run-tests.sh');
    const nested = await wrapped('fs', 'list', { path: path.join(ground, 'src') });
    expect(nested.content.map(({ text }) => text).join('\n')).not.toContain('/tests/run-tests.sh');
    // A delete or a rename on the ground reaches the graded container too (2026-10-07).
    const renaming = async (serverName, toolName, args = {}) => {
      if (args.delete) await fs.rm(path.resolve(args.path), { force: true });
      else if (args.destination) await fs.rename(path.resolve(args.path), path.resolve(args.destination));
      return { content: [] };
    };
    const editing = withBenchmarkGroundMirror(renaming, connection);
    await wrapped('fs', 'write', { path: path.join(ground, 'old-name.txt'), content: 'moved' });
    await editing('fs', 'edit', { path: path.join(ground, 'old-name.txt'), destination: path.join(ground, 'new-name.txt') });
    expect(await containerOutput('cat /app/new-name.txt')).toBe('moved');
    expect(await containerOutput('test -e /app/old-name.txt && echo still || echo gone')).toContain('gone');
    await editing('fs', 'edit', { path: path.join(ground, 'mirrored.txt'), delete: true });
    expect(await containerOutput('test -e /app/mirrored.txt && echo still || echo gone')).toContain('gone');
    const unengaged = withBenchmarkGroundMirror(callTool, {});
    const plain = await unengaged('fs', 'list', { path: ground });
    expect(plain.content).toHaveLength(1);
  }, 60_000);
});
