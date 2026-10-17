// Real compiler, WASM allocations and kernel masks; no execution substitutes.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import workspace, { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import { prepareOverlayFreshness } from '../../backend/services/overlay-freshness.js';

const LANE = 'witness-test-BuildWasm';
let root;
let ground;
let priorWitnesses;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-build-wasm-'));
  ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  priorWitnesses = getWitnessesRoot();
  setWitnessesRoot(path.join(root, 'witnesses'));
  await workspace.create(LANE);
});
afterEach(async () => {
  setWitnessesRoot(priorWitnesses);
  await fs.rm(root, { recursive: true, force: true });
});

test('tsc rebuilds existing credential declarations and maps while the lower stays unchanged', async () => {
  const artifacts = [];
  for (const family of ['ai', 'cex-api']) {
    await fs.mkdir(path.join(ground, 'src', family), { recursive: true });
    await fs.mkdir(path.join(ground, 'dist', family), { recursive: true });
    await fs.writeFile(path.join(ground, 'src', family, 'credentials.ts'), 'export const value = 3;\n');
    for (const suffix of ['js', 'd.ts', 'js.map', 'd.ts.map']) {
      const relative = `dist/${family}/credentials.${suffix}`;
      artifacts.push(relative);
      await fs.writeFile(path.join(ground, relative), '');
    }
  }
  await fs.writeFile(path.join(ground, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'CommonJS', types: [], skipLibCheck: true,
      outDir: 'dist', declaration: true, sourceMap: true, declarationMap: true }, include: ['src'],
  }));
  await fs.cp(fileURLToPath(new URL('../../node_modules/typescript', import.meta.url)),
    path.join(ground, 'node_modules', 'typescript'), { recursive: true });
  const sandbox = await ensureWitnessCodingSandbox(LANE, ground);
  const command = 'node node_modules/typescript/bin/tsc -p tsconfig.json';
  for (let build = 0; build < 2; build += 1) {
    const result = await runWitnessCommand({ ...sandbox, mode: 'write', command });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  }
  const execute = await runWitnessCommand({ ...sandbox, mode: 'inspect',
    command: 'node -e "if (require(\'./dist/ai/credentials.js\').value !== 3) process.exit(1)"' });
  expect(execute.exitCode, execute.stderr).toBe(0);
  for (const relative of artifacts) {
    expect((await fs.stat(path.join(sandbox.workspace, relative))).size).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(ground, relative), 'utf8')).toBe('');
  }
}, 30000);

test('small real WASM memories coexist within the bounded production shell', async () => {
  await fs.writeFile(path.join(ground, 'wasm.cjs'),
    'const memories = Array.from({length:4}, () => new WebAssembly.Memory({initial:1, maximum:2}));\n'
    + 'for (const memory of memories) new Uint8Array(memory.buffer)[0] = 42;\n'
    + 'require("node:fs").writeFileSync("wasm-result.json", JSON.stringify(memories.map(m => new Uint8Array(m.buffer)[0])));\n');
  const sandbox = await ensureWitnessCodingSandbox(LANE, ground);
  const result = await runWitnessCommand({ ...sandbox, mode: 'write', command: 'node wasm.cjs' });
  expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(await fs.readFile(path.join(sandbox.workspace, 'wasm-result.json'), 'utf8'))).toEqual([42, 42, 42, 42]);
  const limits = await runWitnessCommand({ ...sandbox, mode: 'inspect',
    command: 'test "$(ulimit -v)" = 67108864 && test "$(ulimit -t)" = 120 && test "$(ulimit -u)" = 4096 && test "$(ulimit -n)" = 4096' });
  expect(limits.exitCode, limits.stderr).toBe(0);
});

test('build directories retain real secret masks, including secret parents of code maps', async () => {
  for (const directory of ['dist', 'build', 'out', 'release']) {
    await fs.mkdir(path.join(ground, directory, 'keys'), { recursive: true });
    for (const name of ['.env', 'credentials.json', 'client.pem', 'keys/credentials.js.map']) {
      await fs.writeFile(path.join(ground, directory, name), 'PRIVATE_BUILD_MARKER');
    }
  }
  const sandbox = await ensureWitnessCodingSandbox(LANE, ground);
  const result = await runWitnessCommand({ ...sandbox, mode: 'inspect',
    command: 'for d in dist build out release; do cat "$d/.env" "$d/credentials.json" "$d/client.pem"; test ! -e "$d/keys/credentials.js.map" || exit 9; done' });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).not.toContain('PRIVATE_BUILD_MARKER');
});

test('an old source-map mask over existing upper output refuses migration without losing work', async () => {
  await fs.mkdir(path.join(ground, 'dist'));
  const map = path.join(ground, 'dist', 'credentials.js.map');
  await fs.writeFile(map, '');
  const sandbox = await ensureWitnessCodingSandbox(LANE, ground);
  await prepareOverlayFreshness({ ...sandbox, masks: { dirs: [], files: [map] } });
  const written = await runWitnessCommand({ ...sandbox, masks: { dirs: [], files: [map] },
    mode: 'write', command: 'echo preserved > dist/build.txt' });
  expect(written.exitCode, written.stderr).toBe(0);
  await expect(prepareOverlayFreshness({ ...sandbox, masks: { dirs: [], files: [] } }))
    .rejects.toMatchObject({ code: 'OVERLAY_CONFLICT' });
  expect(await fs.readFile(path.join(sandbox.workspace, 'dist', 'build.txt'), 'utf8')).toBe('preserved\n');
});
