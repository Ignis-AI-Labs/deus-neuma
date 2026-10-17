#!/usr/bin/env node
/**
 * PATCH TYPELESS DEPS — silence MODULE_TYPELESS_PACKAGE_JSON at its source.
 *
 * astronomy-engine ships real ESM under esm/ but declares no "type" anywhere,
 * so every backend boot logs a MODULE_TYPELESS_PACKAGE_JSON warning and pays
 * Node's per-file syntax detection (the same mispackaging that forced
 * --experimental-detect-module into the Electron spawn env — that flag stays,
 * as the belt for a checkout where postinstall never ran).
 *
 * The fix is the standard dual-package one: a SCOPED marker
 * (esm/package.json {"type":"module"}) — never "type" on the package root,
 * which would flip the CJS main (./astronomy.js) to ESM and break require().
 *
 * Runs from postinstall; must never fail an install (exit 0 always). Safe to
 * re-run: writing the same marker twice is a no-op.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// dir (relative to the package root) → the scoped marker its files need.
const PATCHES = [
  { pkg: 'astronomy-engine', dir: 'esm', marker: { type: 'module' } },
];

for (const { pkg, dir, marker } of PATCHES) {
  try {
    const scoped = path.join(repoRoot, 'node_modules', pkg, dir, 'package.json');
    if (!fs.existsSync(path.dirname(scoped))) continue; // package absent — nothing to patch
    const wanted = `${JSON.stringify(marker, null, 2)}\n`;
    const current = fs.existsSync(scoped) ? fs.readFileSync(scoped, 'utf8') : null;
    if (current === wanted) continue;
    fs.writeFileSync(scoped, wanted);
    console.log(`[patch-typeless-deps] ${pkg}/${dir}/package.json ← ${JSON.stringify(marker)}`);
  } catch (err) {
    // Never fail an install over a hygiene patch — the warning simply returns.
    console.warn(`[patch-typeless-deps] ${pkg}: ${err.message}`);
  }
}
