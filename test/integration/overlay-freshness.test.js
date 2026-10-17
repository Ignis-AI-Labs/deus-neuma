// Real kernel overlays and disposable disk only. No mocked execution boundary.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, describe, test, expect } from 'vitest';
import { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { ensureWitnessCodingSandbox, runWitnessCommand, sandboxPathFor } from '../../backend/services/witness-coding-sandbox.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON_BIN = path.join(REPO, 'node_modules', 'electron', 'dist', 'electron');
const REAL_ASAR = path.join(REPO, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar');
const execFileAsync = promisify(execFile);

const LANE = 'witness-test-OverlayFreshness';
let root, source, previousRoot;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'overlay-freshness-'));
  source = path.join(root, 'ground');
  await fs.mkdir(source);
  previousRoot = getWitnessesRoot();
  setWitnessesRoot(path.join(root, 'lanes'));
  await fs.mkdir(path.join(root, 'lanes', LANE), { recursive: true });
});

afterEach(async () => {
  setWitnessesRoot(previousRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe('persistent overlay provenance', () => {
  test('preserves formatter work but refuses an atomic lower replacement before another process runs', async () => {
    await fs.writeFile(path.join(source, 'value.txt'), 'initial');
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    const written = await runWitnessCommand({ ...sandbox, mode: 'write', command: 'printf overlay > value.txt' });
    expect(written.exitCode).toBe(0);
    await fs.writeFile(path.join(source, 'replacement'), 'updated');
    await fs.rename(path.join(source, 'replacement'), path.join(source, 'value.txt'));
    await expect(ensureWitnessCodingSandbox(LANE, source)).rejects.toThrow(/freshness conflict.*value.txt/);
    await expect(runWitnessCommand({ ...sandbox, mode: 'write', command: 'touch should-not-run' }))
      .rejects.toThrow(/freshness conflict.*value.txt/);
    expect(await fs.readFile(path.join(sandbox.workspace, 'value.txt'), 'utf8')).toBe('overlay');
    expect(await fs.readFile(path.join(source, 'value.txt'), 'utf8')).toBe('updated');
    await expect(fs.stat(path.join(sandbox.workspace, 'should-not-run'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  test('whiteouts are shadows too, not permission to hide a newly replaced lower file', async () => {
    await fs.writeFile(path.join(source, 'gone.txt'), 'old');
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    expect((await runWitnessCommand({ ...sandbox, mode: 'write', command: 'rm gone.txt' })).exitCode).toBe(0);
    const whiteout = await fs.lstat(path.join(sandbox.workspace, 'gone.txt'));
    await fs.writeFile(path.join(source, 'gone.txt'), 'new');
    await expect(runWitnessCommand({ ...sandbox, command: 'test ! -e gone.txt' })).rejects.toThrow(/gone.txt/);
    expect((await fs.lstat(path.join(sandbox.workspace, 'gone.txt'))).ino).toBe(whiteout.ino);
  }, 60_000);

  test('dependency edits and opaque replacement directories fail without deleting installed upper work', async () => {
    await fs.mkdir(path.join(source, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(source, 'node_modules', 'dep', 'index.js'), 'old');
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    expect((await runWitnessCommand({ ...sandbox, mode: 'write',
      command: 'rm -rf node_modules/dep; mkdir node_modules/dep; printf installed > node_modules/dep/index.js' })).exitCode).toBe(0);
    await fs.writeFile(path.join(source, 'node_modules', 'dep', 'index.js'), 'new');
    await expect(runWitnessCommand({ ...sandbox, command: 'cat node_modules/dep/index.js' }))
      .rejects.toThrow(/freshness conflict.*node_modules/);
    expect(await fs.readFile(path.join(sandbox.workspace, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('installed');
  }, 60_000);

  test('nonempty legacy upper is refused without creating a claimed baseline or discarding work', async () => {
    const upper = sandboxPathFor(LANE, source);
    await fs.mkdir(upper, { recursive: true });
    await fs.writeFile(path.join(upper, 'unharvested.txt'), 'keep me');
    await expect(ensureWitnessCodingSandbox(LANE, source)).rejects.toThrow(/legacy upper.*no known lower baseline/);
    expect(await fs.readFile(path.join(upper, 'unharvested.txt'), 'utf8')).toBe('keep me');
    await expect(fs.stat(path.join(path.dirname(upper), 'lower-baseline.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('a real local dependency install and check persist, then changed lower package metadata refuses verification', async () => {
    await fs.mkdir(path.join(source, 'vendor', 'dep'), { recursive: true });
    await fs.writeFile(path.join(source, 'vendor', 'dep', 'package.json'), JSON.stringify({ name: 'shell-fixture-dep', version: '1.0.0', main: 'index.js' }));
    await fs.writeFile(path.join(source, 'vendor', 'dep', 'index.js'), 'module.exports = 7;');
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ private: true, scripts: { check: 'node check.cjs' } }));
    await fs.writeFile(path.join(source, 'check.cjs'), "require('node:assert/strict').equal(require('shell-fixture-dep'), 7); process.stdout.write('CHECK PASSED');");
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    const install = await runWitnessCommand({ ...sandbox, mode: 'write', timeoutMs: 60000,
      command: 'npm install --offline --ignore-scripts --no-audit --no-fund ./vendor/dep && npm run check' });
    expect(install.exitCode, install.stderr).toBe(0);
    expect(install.stdout).toContain('CHECK PASSED');
    const reopened = await ensureWitnessCodingSandbox(LANE, source);
    expect((await runWitnessCommand({ ...reopened, command: 'node check.cjs' })).stdout).toContain('CHECK PASSED');
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ private: true, version: '2.0.0' }));
    await expect(runWitnessCommand({ ...reopened, command: 'node check.cjs' })).rejects.toThrow(/package.json/);
    expect((await fs.readdir(sandbox.workspace))).toContain('node_modules');
  }, 90_000);

  test('unshadowed live edits remain visible while independent overlay work persists across reopen', async () => {
    await fs.writeFile(path.join(source, 'live.txt'), 'before');
    let sandbox = await ensureWitnessCodingSandbox(LANE, source);
    expect((await runWitnessCommand({ ...sandbox, mode: 'write', command: 'printf keep > own.txt' })).exitCode).toBe(0);
    await fs.writeFile(path.join(source, 'live.txt'), 'after');
    sandbox = await ensureWitnessCodingSandbox(LANE, source);
    const result = await runWitnessCommand({ ...sandbox, command: 'cat live.txt own.txt' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('afterkeep');
  }, 60_000);

  test('concurrent live drift discards the result and preserves shell work', async () => {
    await fs.writeFile(path.join(source, 'value.txt'), 'before');
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    let drift;
    const run = runWitnessCommand({ ...sandbox, mode: 'write',
      command: 'printf upper > value.txt; printf READY; sleep 0.3; cat value.txt',
      onChunk: () => { drift ||= fs.writeFile(path.join(source, 'value.txt'), 'after'); },
    });
    await expect(run).rejects.toThrow(/freshness conflict/);
    await drift;
    expect(await fs.readFile(path.join(sandbox.workspace, 'value.txt'), 'utf8')).toBe('upper');
  }, 60_000);

  test('pre-aborted input never spawns or writes a marker', async () => {
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    const controller = new AbortController();
    controller.abort();
    await expect(runWitnessCommand({ ...sandbox, mode: 'write', signal: controller.signal, command: 'touch marker' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    await expect(fs.stat(path.join(sandbox.workspace, 'marker'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

// CQ-907 / #527 — the desk's backend runs under the Electron binary, whose fs is
// asar-patched: archives stat as directories with synthetic per-process inodes and
// undefined timestamps, and readdir walks INTO them. A lower baseline taken through
// that patch never matches the next boot — Tenekom's sovereign ground burned 19
// recovery generations on the loop. These tests prove the inventory reads the real
// filesystem (original-fs under Electron) and that poisoned baselines self-repair.
describe('asar poisoning (CQ-907)', () => {
  const manifestFor = (upper) => path.join(path.dirname(upper), 'lower-baseline.json');

  test('an asar in the lower is one file entry, never walked into', async (ctx) => {
    await fs.stat(REAL_ASAR).catch(() => ctx.skip());
    await fs.mkdir(path.join(source, 'node_modules', 'electron', 'dist', 'resources'), { recursive: true });
    await fs.copyFile(REAL_ASAR, path.join(source, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar'));
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    const baseline = JSON.parse(await fs.readFile(manifestFor(sandbox.workspace), 'utf8'));
    const rows = baseline.roots['node_modules'];
    const asarKey = 'electron/dist/resources/default_app.asar';
    expect(Object.keys(rows).filter((key) => key.startsWith(asarKey))).toEqual([asarKey]);
    expect(rows[asarKey]).not.toContain('undefined');
    expect(rows[asarKey].split(':')[3]).toBe('108953'); // the real file size
  });

  // The exact reproduction of the live loop: TWO separate Electron processes (two
  // boots) share one lane baseline. Boot 1 prepares and shadows node_modules (what an
  // in-shell vitest run writes); boot 2 must prepare and assert clean.
  const DRIVER = `
    const [workspace, sourceRoot, shadow] = process.argv.slice(-3);
    (async () => {
      const path = await import('node:path');
      const fs = await import('node:fs/promises');
      const mod = await import(process.env.OVERLAY_MODULE_URL);
      await mod.prepareOverlayFreshness({ workspace, sourceRoot, masks: { dirs: [], files: [] } });
      if (shadow === 'shadow') {
        await fs.mkdir(path.join(workspace, 'node_modules', '.vite'), { recursive: true });
        await fs.writeFile(path.join(workspace, 'node_modules', '.vite', 'results.json'), '{}');
      }
      await mod.assertOverlayFresh({ workspace, sourceRoot });
      process.stdout.write('BOOT OK');
      process.exit(0);
    })().catch((error) => { process.stderr.write(String(error?.message || error)); process.exit(1); });
  `;

  const electronBoot = (driver, workspace, sourceRoot_, shadow) => execFileAsync(
    ELECTRON_BIN, ['--no-sandbox', driver, workspace, sourceRoot_, shadow],
    { env: { ...process.env, OVERLAY_MODULE_URL: `file://${path.join(REPO, 'backend', 'services', 'overlay-freshness.js')}` }, timeout: 55000 },
  );

  test('two Electron boots share one baseline without conflict', async (ctx) => {
    await fs.stat(ELECTRON_BIN).catch(() => ctx.skip());
    await fs.stat(REAL_ASAR).catch(() => ctx.skip());
    await fs.mkdir(path.join(source, 'node_modules', 'electron', 'dist', 'resources'), { recursive: true });
    await fs.copyFile(REAL_ASAR, path.join(source, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar'));
    const upper = path.join(root, 'upper');
    await fs.mkdir(upper, { recursive: true });
    const driver = path.join(root, 'driver.js');
    await fs.writeFile(driver, DRIVER);
    const boot1 = await electronBoot(driver, upper, source, 'shadow');
    expect(boot1.stdout).toBe('BOOT OK');
    const boot2 = await electronBoot(driver, upper, source, 'none');
    expect(boot2.stdout).toBe('BOOT OK');
    const baseline = JSON.parse(await fs.readFile(manifestFor(upper), 'utf8'));
    expect(JSON.stringify(baseline.roots['node_modules'])).not.toContain('undefined');
  }, 120_000);

  test('a baseline poisoned by the historical asar patch is repaired, not conflicted', async () => {
    await fs.mkdir(path.join(source, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(source, 'node_modules', 'dep', 'index.js'), 'real');
    const sandbox = await ensureWitnessCodingSandbox(LANE, source);
    // What an in-shell test run writes: the node_modules shadow forms.
    await fs.mkdir(path.join(sandbox.workspace, 'node_modules', '.vite'), { recursive: true });
    // Hand-poison the baseline exactly as the patched fs wrote it live.
    const manifest = manifestFor(sandbox.workspace);
    const baseline = JSON.parse(await fs.readFile(manifest, 'utf8'));
    baseline.roots['node_modules']['electron/dist/resources/default_app.asar'] = '1:286:16804:0:undefined:undefined';
    baseline.roots['node_modules']['electron/dist/resources/default_app.asar/main.js'] = '1:297:33188:9403:undefined:undefined';
    await fs.writeFile(manifest, JSON.stringify(baseline));
    // The very next ensure must repair and pass — before the fix this threw
    // OVERLAY_CONFLICT and sent the being into a recovery generation.
    const reopened = await ensureWitnessCodingSandbox(LANE, source);
    expect(reopened.workspace).toBe(sandbox.workspace);
    const repaired = JSON.parse(await fs.readFile(manifest, 'utf8'));
    expect(JSON.stringify(repaired.roots['node_modules'])).not.toContain('undefined');
    expect(repaired.roots['node_modules']['dep/index.js']).toBeTruthy();
  });
});
