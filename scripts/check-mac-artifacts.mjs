#!/usr/bin/env node
/**
 * check-mac-artifacts.mjs — prove a packaged mac artifact is the chip it claims.
 *
 * WHY: `npm run dist:mac` makes one artifact per chip (electron-builder.yml
 * "one build per chip: the native modules are per-arch, so no universal app"),
 * and nothing downstream notices when that goes wrong. The build machine has one
 * chip; electron-builder rebuilds the native addons for the target, and if it
 * does not, or if a prebuild is picked from the host's folder, the artifact
 * carries the OTHER chip's better_sqlite3.node and pty.node. Electron then dies
 * at boot on the machine it was built for — which reads as a crash, not as a
 * packaging mistake, and only on the chip nobody is sitting in front of.
 *
 * So: every Mach-O in the bundle is read, and every one of them must be able to
 * load on the chip the directory name claims.
 *
 * Signing is REPORTED, not required: mac builds are unsigned until the
 * Developer ID and the App Store Connect key exist (docs/architecture/platform/
 * macos-build.md). Pass --require-signed to make silence impossible instead.
 *
 * Usage:
 *   node scripts/check-mac-artifacts.mjs [--release release] [--require-signed]
 *   node scripts/check-mac-artifacts.mjs --release release/app/mac-arm64 --expect arm64
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ARCH_HEADER_BYTES, archsOf } from './macho-arch.mjs';

const SELF = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(SELF), '..');

/** The chip an output directory claims, from electron-builder's own naming. */
export function expectedChipFor(dirName) {
  if (dirName === 'mac-arm64') return 'arm64';
  if (dirName === 'mac-x64' || dirName === 'mac') return 'x86_64';
  if (dirName === 'mac-universal') return 'universal';
  return null;
}

/** Does a binary's slice list satisfy the chip? */
export function verdictFor(chip, archs) {
  const required = chip === 'universal' ? ['arm64', 'x86_64'] : [chip];
  const missing = required.filter((c) => !archs.includes(c));
  return { ok: missing.length === 0, missing };
}

const headerOf = (file) => {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(ARCH_HEADER_BYTES);
    const read = fs.readSync(fd, buf, 0, ARCH_HEADER_BYTES, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
};

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // the frameworks link to themselves
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
};

/** Read every file in a bundle and judge the Mach-O ones. */
export function inspectBundle(bundleDir, chip) {
  const files = walk(bundleDir);
  const macho = [];
  const mismatches = [];
  for (const file of files) {
    const found = archsOf(headerOf(file));
    if (!found) continue; // text, JSON, JS, an icon — nothing to load
    const rel = path.relative(bundleDir, file);
    macho.push(rel);
    const verdict = verdictFor(chip, found.archs);
    if (!verdict.ok) mismatches.push({ file: rel, archs: found.archs, missing: verdict.missing });
  }
  return { files: files.length, macho, mismatches };
}

/** Signed means Apple signed it: a CodeResources seal and a valid signature. */
export function signatureOf(bundleDir) {
  const sealed = fs.existsSync(path.join(bundleDir, 'Contents', '_CodeSignature', 'CodeResources'));
  if (!sealed) return { signed: false, why: 'no Contents/_CodeSignature/CodeResources' };
  if (process.platform !== 'darwin') return { signed: true, why: 'sealed (not verified off-mac)' };
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', bundleDir], { stdio: 'pipe' });
    return { signed: true, why: 'codesign --verify --deep --strict passed' };
  } catch (err) {
    return { signed: false, why: `seal present, codesign refused: ${String(err.stderr || err.message).trim().split('\n')[0]}` };
  }
}

/** Every app bundle electron-builder left behind, with the chip it claims. */
export function bundlesUnder(releaseDir) {
  if (!fs.existsSync(releaseDir)) return [];
  const dirs = fs.readdirSync(releaseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('mac'))
    .map((e) => e.name);
  const found = [];
  for (const name of dirs) {
    const chip = expectedChipFor(name);
    const dir = path.join(releaseDir, name);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        found.push({ bundle: path.join(dir, entry.name), chip, dirName: name });
      }
    }
  }
  return found;
}

const parseArgs = (argv) => {
  const args = { release: path.join(REPO, 'release'), requireSigned: false, expect: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--release') args.release = path.resolve(argv[i += 1]);
    else if (argv[i] === '--require-signed') args.requireSigned = true;
    else if (argv[i] === '--expect') args.expect = argv[i += 1];
  }
  return args;
};

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  let targets;
  if (args.expect) {
    // A single bundle named directly, for a build that staged somewhere else.
    targets = [{ bundle: args.release, chip: args.expect, dirName: path.basename(args.release) }];
  } else {
    targets = bundlesUnder(args.release);
  }

  if (targets.length === 0) {
    console.log(`[check-mac-artifacts] FAILED: no mac*.app under ${args.release}; there is no artifact to ship`);
    return 1;
  }

  let failed = 0;
  for (const { bundle, chip, dirName } of targets) {
    const chipLabel = chip || 'unknown';
    const { files, macho, mismatches } = inspectBundle(bundle, chip);
    const sig = signatureOf(bundle);
    const name = path.basename(bundle);

    console.log(`\n[check-mac-artifacts] ${name}  (from ${dirName}/, claims ${chipLabel})`);
    console.log(`  ${files} files, ${macho.length} Mach-O, ${mismatches.length} wrong chip`);

    if (!chip) {
      console.log(`  CANNOT JUDGE: the directory name "${dirName}" names no chip; expected mac-arm64, mac-x64, mac or mac-universal`);
      failed += 1;
      continue;
    }
    for (const bad of mismatches.slice(0, 40)) {
      console.log(`  WRONG CHIP: ${bad.file} is [${bad.archs.join(', ')}], needs ${bad.missing.join(', ')}`);
    }
    if (mismatches.length > 40) console.log(`  … and ${mismatches.length - 40} more`);
    if (mismatches.length > 0) failed += 1;

    if (!sig.signed) {
      const line = `  UNSIGNED — ${sig.why}. Gatekeeper will refuse this on another Mac, and the updater will not apply it.`;
      if (args.requireSigned) {
        console.log(line);
        failed += 1;
      } else {
        console.log(`${line} (expected until the signing credentials exist)`);
      }
    } else {
      console.log(`  signed: ${sig.why}`);
    }
  }

  if (failed > 0) {
    console.log(`\n[check-mac-artifacts] FAILED: ${failed} problem(s). The artifact cannot ship as it stands.`);
    return 1;
  }
  console.log('\n[check-mac-artifacts] every Mach-O matches the chip its artifact claims');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  process.exit(main());
}
