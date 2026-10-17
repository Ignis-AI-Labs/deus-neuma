#!/usr/bin/env node
/**
 * native-abi-cache.mjs — keep ONE compiled better-sqlite3 per ABI, side by side.
 *
 * THE PROBLEM: a native addon is compiled for exactly one Node ABI, and this
 * repo serves two runtimes from one node_modules — the systemd daemon on
 * system Node, the desktop app on Electron's bundled Node. ensure-native-abi
 * handles that by REBUILDING on every switch, which means the two runtimes can
 * never both be satisfied, and cannot even run at the same time. Worse, the
 * loser fails quietly: on 2026-07-21 the daemon ran for fifteen minutes with
 * platform persistence disabled because the desktop app had last rebuilt for
 * Electron.
 *
 * THE FIX: better-sqlite3 can be handed an explicit `nativeBinding` path, so
 * the artifact does not have to live in node_modules at all. This caches one
 * build per ABI under .native-abi/<abi>/, and backend/services/drivers/
 * sqlite-binding.js picks the one matching whatever runtime is asking. No
 * rebuild on switch, no flipping under a running process, and both runtimes
 * hold their own ABI at once.
 *
 * Usage:
 *   node scripts/native-abi-cache.mjs harvest        # cache the CURRENT build
 *   node scripts/native-abi-cache.mjs status         # what is cached
 *
 * `harvest` is deliberately dumb and safe: it copies whatever is currently
 * compiled in node_modules into the slot for the ABI it was built for. Run it
 * after any install or rebuild — including right after ensure-native-abi
 * switches — and each ABI accumulates its own copy over time. It never builds
 * anything itself, so it cannot fail a machine that has no toolchain.
 *
 * // impure — reads node_modules, writes .native-abi/.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.native-abi');
const ADDON = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

/**
 * The ABI a compiled addon targets. Read from the binary itself rather than
 * assumed from whatever ran last — the marker file lies the moment anything
 * rebuilds outside the script.
 * @returns {string|null}
 */
const abiOf = (addonPath) => {
  // A .node built for ABI N loads in a runtime with modules === N and throws a
  // NODE_MODULE_VERSION error naming both otherwise. Ask this runtime first.
  try {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(addonPath)})`], { stdio: 'pipe' });
    return process.versions.modules; // loaded here → built for this ABI
  } catch (err) {
    const said = `${err.stderr || ''}${err.message || ''}`;
    const compiled = said.match(/NODE_MODULE_VERSION (\d+)/g);
    // The message names the module's version first, then the runtime's.
    if (compiled?.length) return compiled[0].replace(/\D/g, '');
    return null;
  }
};

const harvest = () => {
  if (!existsSync(ADDON)) {
    console.log('[native-abi-cache] no compiled better-sqlite3 present — nothing to harvest');
    return 0;
  }
  const abi = abiOf(ADDON);
  if (!abi) {
    console.error('[native-abi-cache] could not determine the addon\'s ABI — leaving the cache alone');
    return 1;
  }
  const dest = path.join(CACHE, abi);
  mkdirSync(dest, { recursive: true });
  copyFileSync(ADDON, path.join(dest, 'better_sqlite3.node'));
  console.log(`[native-abi-cache] cached better-sqlite3 for ABI ${abi} (this runtime: ${process.versions.modules})`);
  return 0;
};

const status = () => {
  console.log(`[native-abi-cache] cache: ${CACHE}`);
  console.log(`[native-abi-cache] this runtime ABI: ${process.versions.modules} (node ${process.version})`);
  if (!existsSync(CACHE)) {
    console.log('  (empty — the default node_modules build is used, exactly as before)');
    return 0;
  }
  const abis = readdirSync(CACHE).filter((d) => statSync(path.join(CACHE, d)).isDirectory());
  if (!abis.length) console.log('  (empty)');
  for (const abi of abis.sort()) {
    const f = path.join(CACHE, abi, 'better_sqlite3.node');
    const mark = abi === process.versions.modules ? '  ← this runtime' : '';
    console.log(`  ABI ${abi}: ${existsSync(f) ? `${(statSync(f).size / 1024 / 1024).toFixed(1)} MB` : 'MISSING'}${mark}`);
  }
  return 0;
};

const cmd = process.argv[2] || 'status';
// `--never-fail` is what postinstall uses. The shell-level `|| true` this
// replaces is BASH — npm runs scripts through cmd.exe on Windows, where `true`
// is not a command, so a non-zero harvest turned into […] and failed the whole `npm ci`. Harvesting is best-effort by
// design; swallowing the code in-process is shell-agnostic. A human running it
// by hand still gets the real exit code.
const neverFail = process.argv.includes('--never-fail');
const run = () => {
  if (cmd === 'harvest') return harvest();
  if (cmd === 'status') return status();
  console.error('[native-abi-cache] usage: native-abi-cache.mjs <harvest|status> [--never-fail]');
  return 2;
};

let code;
try {
  code = run();
} catch (err) {
  // An unexpected throw must not break an install either.
  console.error(`[native-abi-cache] ${err?.message ?? err}`);
  code = 1;
}
process.exit(neverFail ? 0 : code);
