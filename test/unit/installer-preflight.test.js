/**
 * THE WIZARD'S SYSTEM CHECK (build/installer-preflight.ps1, build/installer-runtime.ps1).
 * The driver floors the script holds a card to must be the app's own (gpu-driver-guard.js), or the
 * wizard and the app would disagree about the same card. On Windows the scripts are RUN for real:
 * the real hardware read, the real registry, no stand-ins (RULE 0).
 */
import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { driverFloorFor } from '../../backend/services/gpu-driver-guard.js';

const BUILD = path.resolve(import.meta.dirname, '../../build');
const PREFLIGHT = path.join(BUILD, 'installer-preflight.ps1');
const onWindows = process.platform === 'win32';
const CARDS = [
  'NVIDIA GeForce RTX 5070 Ti Laptop GPU', 'NVIDIA GeForce RTX 5090', 'NVIDIA RTX PRO 6000 Blackwell',
  'NVIDIA GeForce GTX 1060', 'NVIDIA GeForce GTX 980', 'Quadro P2000',
  'NVIDIA GeForce RTX 3060', 'NVIDIA GeForce RTX 4090', 'NVIDIA GeForce RTX 2060',
];

// the script's own floor table, read from its text: [{ floor, test }]
const scriptFloors = () => [...fs.readFileSync(PREFLIGHT, 'utf8').matchAll(/@\{ floor = (\d+); test = '([^']*)' \}/g)]
  .map((m) => ({ floor: Number(m[1]), test: m[2] }));

describe('the System check holds a card to the same driver floor as the app', () => {
  test.each(CARDS)('%s', (card) => {
    const mine = scriptFloors().find((f) => !f.test || new RegExp(f.test, 'i').test(card));
    expect(mine.floor).toBe(driverFloorFor(card).floor);
  });
});

const runScript = (file, args = []) => execFileSync(
  path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
  { encoding: 'utf8', timeout: 120_000 },
);

describe.skipIf(!onWindows)('on this Windows PC, for real', () => {
  test('the System check writes every key the wizard reads, with sane values', () => {
    const out = path.join(os.tmpdir(), `dn-preflight-test-${process.pid}.txt`);
    runScript(PREFLIGHT, [out]);
    const found = Object.fromEntries(fs.readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    fs.rmSync(out, { force: true });
    for (const key of ['os', 'ramGB', 'gpu', 'gpuGB', 'gpuDriver', 'driverFloor', 'driverOld', 'vcRuntime', 'ollama', 'ollamaRunning', 'lmstudio', 'online']) {
      expect(found, key).toHaveProperty(key);
    }
    expect(Number(found.ramGB)).toBeGreaterThan(0);
    expect(['0', '1']).toContain(found.driverOld);
    expect(['0', '1']).toContain(found.vcRuntime);
    // the driver, when read, is NVIDIA's own number (617.42), never Windows' 32.0.16.1742
    if (found.gpuDriver) expect(found.gpuDriver).toMatch(/^\d{3}\.\d{1,2}$/);
    if (found.gpuDriver && found.gpu) expect(Number(found.driverFloor)).toBe(driverFloorFor(found.gpu).floor);
  }, 120_000);

  test('the runtime fetch gets Microsoft\'s installer and checks its signature, without running it', () => {
    const out = runScript(path.join(BUILD, 'installer-runtime.ps1'), ['-CheckOnly']);
    expect(out).toContain('signed by Microsoft Corporation');
    expect(fs.existsSync(path.join(os.tmpdir(), 'deus-neuma-vc_redist.x64.exe'))).toBe(false);
  }, 120_000);
});
