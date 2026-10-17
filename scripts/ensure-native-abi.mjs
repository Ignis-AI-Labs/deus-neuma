#!/usr/bin/env node
/**
 * ensure-native-abi.mjs — keep the ABI-bound native addons matched to the runtime
 * that is about to load them (better-sqlite3 and node-pty; onnxruntime-node ships
 * ABI-stable prebuilds and needs no rebuild).
 *
 * WHY: a native addon is compiled for one Node ABI. `npm install` builds for
 * system Node, but the Electron app spawns the backend under Electron's bundled
 * Node (ELECTRON_RUN_AS_NODE) — a different ABI. A binary built for one cannot
 * load in the other, and the two ABIs cannot coexist in a single node_modules. So
 * instead of asking anyone to remember to rebuild, every entry point runs this
 * first: `node scripts/ensure-native-abi.mjs <node|electron>`.
 *
 * A marker file records which ABI the binary was last built for, so this is a
 * no-op (instant) when already correct — you only pay a rebuild when you actually
 * switch between running the tests/dev backend (node) and the Electron app.
 *
 * // impure — spawns the rebuild, touches a marker file.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const target = process.argv[2];
if (target !== 'node' && target !== 'electron') {
  console.error('[ensure-native-abi] usage: ensure-native-abi.mjs <node|electron>');
  process.exit(2);
}

const root = process.cwd();
// ABI-bound native addons this repo carries (onnxruntime-node is ABI-stable).
const NATIVE = ['better-sqlite3', 'node-pty'];
// Marker lives in node_modules (already gitignored, per-machine, wiped by a fresh
// install). Absent marker → assume `node`, since that is what `npm install` builds.
//
// The marker names the exact RUNTIME, not just its family: "electron" alone
// read as correct after the 33 -> 42 upgrade and skipped the rebuild, leaving
// an ABI-130 binary under an ABI-146 runtime (2026-09-25). A bare legacy
// marker never matches, so it rebuilds exactly once.
const runtimeOf = (kind) => {
  if (kind === 'node') return `node@${process.versions.node}`;
  const pkg = path.join(root, 'node_modules', 'electron', 'package.json');
  return `electron@${existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : 'unknown'}`;
};
const marker = path.join(root, 'node_modules', '.native-abi');
const current = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : 'node';
const wanted = runtimeOf(target);

if (current === wanted && existsSync(path.join(root, 'node_modules', 'better-sqlite3'))) {
  process.exit(0); // already correct — fast path, no rebuild
}

// Use the locally-installed binary (devDependency @electron/rebuild), no network fetch.
// electron-rebuild rebuilds ALL native modules for Electron; `npm rebuild <names>`
// restores them for system Node — keep every ABI-bound addon on the same ABI.
const electronRebuild = path.join(root, 'node_modules', '.bin', 'electron-rebuild');
const cmd = target === 'electron'
  ? `"${electronRebuild}" -f`
  : `npm rebuild ${NATIVE.join(' ')}`;

console.log(`[ensure-native-abi] better-sqlite3 currently "${current}", need "${wanted}" — rebuilding…`);
try {
  execSync(cmd, { stdio: 'inherit', cwd: root });
  writeFileSync(marker, wanted);
  console.log(`[ensure-native-abi] better-sqlite3 ready for ${wanted}.`);
} catch (err) {
  console.error(
    `[ensure-native-abi] FAILED to rebuild better-sqlite3 for ${target}: ${err.message}\n`
    + '  The app will still boot (platform persistence degrades gracefully), but to enable it '
    + 'run the rebuild manually — see docs/architecture/platform/platform-db.md § "Native module / ABI".'
  );
  process.exit(1);
}
