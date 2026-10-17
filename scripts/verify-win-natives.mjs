#!/usr/bin/env node
// verify-win-natives.mjs — refuse a Windows package that carries the wrong
// native binaries.
//
// WHY THIS EXISTS (witnessed 2026-08-01): `electron-builder --win` run from
// Linux exits 0 and produces a perfectly well-formed NSIS installer whose
// `better_sqlite3.node` is an ELF — a LINUX shared object — because the host's
// node_modules is what gets packaged and nothing re-resolves the platform
// binaries. NEUMA.exe itself was a real PE32+, so every surface-level check
// passed.
//
// That failure is silent by design downstream: platform-db.js catches a native
// binding that will not load and degrades to a no-op driver so the backend
// keeps serving. A Windows user would install NEUMA, watch birth and portal and
// chat all work, and lose platform persistence with the only complaint in a
// backend log they will never open.
//
// So the packaging step gets a gate that reads the actual file headers. A
// Windows loadable module starts with "MZ"; if it starts with 0x7F E L F we are
// about to ship Linux into an .exe.
//
// Usage:
//   node scripts/verify-win-natives.mjs [path/to/win-unpacked]
//
// Exit 0 = safe to ship. Exit 1 = do not ship, with the reason named.
//
// impure (filesystem).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'release', 'win-unpacked'));
const MODULES = join(ROOT, 'resources', 'app', 'node_modules');

const fail = (msg) => { process.stderr.write(`verify-win-natives: ${msg}\n`); process.exit(1); };

if (!existsSync(MODULES)) fail(`no packaged node_modules at ${MODULES} — build the Windows target first`);

/** Read a file's magic bytes and name the platform it targets. Pure-ish (one read). */
const formatOf = (path) => {
  const fd = readFileSync(path).subarray(0, 4);
  if (fd[0] === 0x4d && fd[1] === 0x5a) return 'PE';                                   // MZ — Windows
  if (fd[0] === 0x7f && fd[1] === 0x45 && fd[2] === 0x4c && fd[3] === 0x46) return 'ELF'; // Linux
  if ([0xfeedface, 0xfeedfacf, 0xcafebabe].includes(fd.readUInt32BE(0))
    || [0xfeedface, 0xfeedfacf].includes(fd.readUInt32LE(0))) return 'MachO';           // macOS
  return 'unknown';
};

/** Every .node under a directory. impure (fs walk). */
const findNodeAddons = (dir, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findNodeAddons(full, acc);
    else if (entry.name.endsWith('.node')) acc.push(full);
  }
  return acc;
};

// A vendored addon for another OS is FINE when it sits in a directory named for
// that OS — node-pty ships darwin/linux prebuilds beside the win32 ones and
// picks at runtime. Only addons on a path Windows would actually load matter.
const OTHER_PLATFORM = /(^|[\\/\-_])(linux|linuxmusl|darwin|macos|android|freebsd)([\\/\-_]|$)/i;

// The modules whose Windows binary is load-bearing, and where it must live.
const REQUIRED = [
  {
    module: 'better-sqlite3',
    candidates: ['build/Release/better_sqlite3.node', 'prebuilds/win32-x64/better_sqlite3.node'],
    why: 'the platform database — a bad binary degrades to a no-op driver and silently disables persistence',
  },
  {
    module: 'node-pty',
    candidates: ['prebuilds/win32-x64/pty.node'],
    why: 'the integrated terminal',
  },
];

const problems = [];
const notes = [];

for (const { module, candidates, why } of REQUIRED) {
  const moduleDir = join(MODULES, module);
  if (!existsSync(moduleDir)) { notes.push(`${module}: not packaged (skipped)`); continue; }
  const found = candidates
    .map((rel) => join(moduleDir, ...rel.split('/')))
    .filter((p) => existsSync(p));
  if (found.length === 0) {
    problems.push(`${module}: NO Windows binary at any of [${candidates.join(', ')}] — ${why}`);
    continue;
  }
  for (const path of found) {
    const format = formatOf(path);
    const rel = path.slice(MODULES.length + 1);
    if (format === 'PE') notes.push(`${module}: ${rel} is PE — ok`);
    else problems.push(`${module}: ${rel} is ${format}, not a Windows binary — ${why}`);
  }
}

// Anything else Windows would load must not be a foreign binary.
for (const path of findNodeAddons(MODULES)) {
  const rel = path.slice(MODULES.length + 1);
  if (OTHER_PLATFORM.test(sep + rel)) continue; // vendored for another OS, by name
  const format = formatOf(path);
  if (format !== 'PE' && format !== 'unknown') {
    problems.push(`${rel} is ${format} on a path Windows would load`);
  }
}

// Optional per-platform families (sharp, @napi-rs/canvas): these ship one
// package per OS/arch, and npm only installs the ones matching the build host.
// Present-but-Linux-only means the win32 package was never fetched.
//
// The variants live in EITHER of two places and both must be searched: hoisted
// at <scope>/<family>-<platform>, or nested under the base package at
// <scope>/<family>/node_modules/<scope>/. Checking only the hoisted location
// would fail a perfectly good Windows build whose variant happens to be nested.
const variantDirs = (scope, family) => {
  const found = [];
  for (const base of [join(MODULES, scope), join(MODULES, scope, family, 'node_modules', scope)]) {
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    // `sharp-linux-x64` is a variant; the bare `sharp` is the base package.
    found.push(...readdirSync(base).filter((d) => d.startsWith(`${family}-`)));
  }
  return [...new Set(found)];
};

for (const [scope, family] of [['@img', 'sharp'], ['@napi-rs', 'canvas']]) {
  const dirs = variantDirs(scope, family);
  if (dirs.length === 0) continue; // family not in use — nothing to require
  if (dirs.some((d) => /win32/i.test(d))) {
    notes.push(`${scope}/${family}: win32 variant present — ok`);
  } else {
    problems.push(`${scope}/${family}: only [${dirs.join(', ')}] packaged — no win32 variant, so it will throw if loaded`);
  }
}

for (const note of notes) process.stdout.write(`  ${note}\n`);

if (problems.length > 0) {
  process.stderr.write(`\nverify-win-natives: ${problems.length} problem(s) — DO NOT SHIP THIS BUILD\n`);
  for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
  process.stderr.write('\nNative modules must be resolved ON Windows. Build the win target on a\n'
    + 'local Windows host (docs/operations/local-validation.md), not cross-built from Linux.\n');
  process.exit(1);
}

process.stdout.write('\nverify-win-natives: every Windows-loadable native binary is a real PE — safe to ship\n');
