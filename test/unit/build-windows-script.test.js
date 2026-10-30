// The Windows build fetches nothing it has not pinned: winCodeSign is checked against its SHA-256
// before it is unpacked, and every npm tool runs from the locked install, never through a registry
// fetch. Reads the real script and the real lockfile (no mocks); PowerShell itself is not run here.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = fs.readFileSync(path.join(REPO, 'scripts/build-windows.ps1'), 'utf8');
const lines = script.split(/\r?\n/);
const lineOf = (re) => lines.findIndex((l) => re.test(l));
const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8'));

describe('scripts/build-windows.ps1', () => {
  test('winCodeSign is hashed and refused on a mismatch before it is unpacked', () => {
    const download = lineOf(/Invoke-WebRequest .*winCodeSign-2\.6\.0\.7z'$/);
    const pin = lineOf(/^\s*\$pinned = 'cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4'$/);
    const hash = lineOf(/Get-FileHash -Algorithm SHA256 -LiteralPath \$archive/);
    const refuse = lineOf(/^\s*if \(\$got -ne \$pinned\) \{$/);
    const fail = lineOf(/^\s*Fail "winCodeSign-2\.6\.0\.7z is not the pinned archive/);
    const unpack = lineOf(/7za\.exe x -y .*\$archive/);
    for (const at of [download, pin, hash, refuse, fail, unpack]) expect(at).toBeGreaterThan(-1);
    expect(download < pin && pin < hash && hash < refuse && refuse < fail && fail < unpack).toBe(true);
  });

  test('no npm tool runs through npx', () => {
    expect(script).not.toMatch(/npx\s+(--yes|-y)\b/);
    expect(script).not.toMatch(/npx @\(\s*'(--yes|-y)'/);
    expect(lines.filter((l) => /^\s*(&\s*)?(Run\s+)?npx\b/.test(l))).toEqual([]);
  });

  test('prebuild-install and electron-builder run from the locked install', () => {
    expect(script).toContain('& node ..\\prebuild-install\\bin.js --runtime=electron');
    // run from node_modules\better-sqlite3, ..\prebuild-install is the hoisted, locked copy
    expect(lock.packages['node_modules/prebuild-install'].version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.packages['node_modules/better-sqlite3/node_modules/prebuild-install']).toBeUndefined();
    expect(script).toContain("Run (Join-Path $PWD 'node_modules\\.bin\\electron-builder.cmd') @('--win', '--publish', 'never', '-c.npmRebuild=false')");
  });
});
