/**
 * prune-foreign-prebuilds.cjs — an electron-builder `afterPack` hook.
 *
 * WHY: node-pty ships a prebuild for every chip and every platform it supports,
 * and electron-builder copies the whole package into the bundle. So a per-chip
 * mac build carries `prebuilds/darwin-x64/pty.node` inside the arm64 app: code
 * that chip can never load.
 *
 * The resolver is what makes it dead weight rather than a bug — node-pty tries
 * `build/Release`, `build/Debug`, then `prebuilds/<platform>-<arch>` only, so
 * the other directories are never opened. But they are still files in a signed
 * bundle: they grow the artifact, they grow what the notary service has to chew
 * through, and `scripts/check-mac-artifacts.mjs` cannot tell a deliberately
 * shipped foreign binary from the mistake it exists to catch.
 *
 * So: for a darwin build, read the chip off the app's own executable, then keep
 * only `prebuilds/darwin-<that chip>` and delete the rest. Read from the binary
 * rather than from electron-builder's Arch enum, so the hook and the check agree
 * about which chip the artifact is, and a future builder whose enum changes
 * cannot quietly make this a no-op.
 *
 * Any other platform is left alone: this hook exists for the mac problem.
 */
const fs = require('node:fs');
const path = require('node:path');
// The reader is ESM. require() of it is supported from Node 22.12 (both project
// floors are >=22.23.4), and it has no top-level await, so this is synchronous.
const { ARCH_HEADER_BYTES, archsOf } = require('./macho-arch.mjs');

const PREBUILD_DIR = /^(darwin|linux|win32|android|freebsd|openbsd|sunos|aix)-(\w+)$/;
/** node-gyp's staging directory: <platform>-<arch>-<node ABI>. */
const STAGING_DIR = /^(darwin|linux|win32|android|freebsd)-\w+-\d+$/;

/**
 * Mach-O calls the Intel chip x86_64; every prebuild directory on npm calls it
 * x64. The hook has to translate, or it looks for darwin-x86_64, finds nothing,
 * and deletes the one directory it should keep.
 */
const PREBUILD_ARCH = { arm64: 'arm64', x86_64: 'x64', arm: 'arm', ia32: 'ia32' };

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

/**
 * The bundle inside a build directory. electron-builder hands afterPack the
 * PARENT of the .app (`release/mac-arm64`), while the bundle is
 * `release/mac-arm64/NEUMA.app`. Both forms are accepted so the hook works
 * whether it is handed the directory or the bundle.
 */
function bundleDirIn(appOutDir, productFilename) {
  if (!fs.existsSync(appOutDir)) return null;
  if (appOutDir.endsWith('.app')) return appOutDir;
  if (productFilename) {
    const preferred = path.join(appOutDir, `${productFilename}.app`);
    if (fs.existsSync(preferred)) return preferred;
  }
  const apps = fs.readdirSync(appOutDir).filter((n) => n.endsWith('.app'));
  return apps.length > 0 ? path.join(appOutDir, apps[0]) : null;
}

/** The chip this bundle was built for, read off its own executable. */
function chipOfBundle(bundleDir) {
  const macos = path.join(bundleDir, 'Contents', 'MacOS');
  if (!fs.existsSync(macos)) return null;
  const exes = fs.readdirSync(macos).filter((f) => fs.statSync(path.join(macos, f)).isFile());
  for (const exe of exes) {
    const found = archsOf(headerOf(path.join(macos, exe)));
    if (found && found.archs.length > 0) return found.archs[0];
  }
  return null;
}

/** Every `prebuilds/` directory inside the packaged node_modules. */
function prebuildDirsUnder(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'prebuilds') out.push(full);
    else prebuildDirsUnder(full, out);
  }
  return out;
}

/** Every directory called `name` inside the packaged node_modules. */
function dirsNamed(dir, name, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === name) out.push(full);
    else dirsNamed(full, name, out);
  }
  return out;
}

/**
 * Two families of foreign binary live in a packaged node_modules:
 *
 *   prebuilds/darwin-x64/            one directory per chip, shipped by the package
 *   bin/darwin-x64-149/              node-gyp's staging for one chip and ABI,
 *                                    left by whichever build ran last on this
 *                                    machine — so a cross-arch build always packs
 *                                    the HOST's staging into the TARGET's bundle
 *
 * Neither is loaded: node-pty and better-sqlite3 read build/Release first. Both
 * are files inside a signed bundle, and both make the artifact look like it
 * carries the wrong chip.
 */
function prune({ appOutDir, platform = 'darwin', dryRun = false, productFilename = null }) {
  const result = { kept: [], removed: [], chip: null };
  if (platform !== 'darwin') return result;

  const bundleDir = bundleDirIn(appOutDir, productFilename);
  if (!bundleDir) {
    console.warn(`[prune-foreign-prebuilds] no .app under ${appOutDir} — nothing pruned`);
    return result;
  }

  const chip = chipOfBundle(bundleDir);
  result.chip = chip;
  if (!chip) {
    // Louder than shipping: the hook cannot know which chip it is pruning for,
    // so it does nothing and says why. check-mac-artifacts still judges it.
    console.warn(`[prune-foreign-prebuilds] no Mach-O executable under ${bundleDir}/Contents/MacOS — nothing pruned`);
    return result;
  }

  const arch = PREBUILD_ARCH[chip] || chip;
  const modules = path.join(bundleDir, 'Contents', 'Resources', 'app', 'node_modules');

  // prebuilds/<platform>-<arch>/
  const wantedPrebuild = `darwin-${arch}`;
  for (const prebuilds of dirsNamed(modules, 'prebuilds')) {
    for (const entry of fs.readdirSync(prebuilds, { withFileTypes: true })) {
      if (!entry.isDirectory() || !PREBUILD_DIR.test(entry.name)) continue;
      const full = path.join(prebuilds, entry.name);
      const label = `${path.basename(path.dirname(prebuilds))}/prebuilds/${entry.name}`;
      if (entry.name === wantedPrebuild) {
        result.kept.push(label);
        continue;
      }
      result.removed.push(label);
      if (!dryRun) fs.rmSync(full, { recursive: true, force: true });
    }
  }

  // bin/<platform>-<arch>-<abi>/
  const wantedStaging = new RegExp(`^darwin-${arch}-\\d+$`);
  for (const binDir of dirsNamed(modules, 'bin')) {
    for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !STAGING_DIR.test(entry.name)) continue;
      const full = path.join(binDir, entry.name);
      const label = `${path.basename(path.dirname(binDir))}/bin/${entry.name}`;
      if (wantedStaging.test(entry.name)) {
        result.kept.push(label);
        continue;
      }
      result.removed.push(label);
      if (!dryRun) fs.rmSync(full, { recursive: true, force: true });
    }
  }

  return result;
}

/** electron-builder calls this after copying the app and before signing. */
const afterPack = async (context) => {
  const platform = context.electronPlatformName || (context.packager && context.packager.platform.name);
  if (platform !== 'darwin') return;

  const { removed, kept, chip } = prune({
    appOutDir: context.appOutDir,
    platform,
    productFilename: context.packager && context.packager.appInfo && context.packager.appInfo.productFilename,
  });
  if (!chip) return;
  console.log(`[prune-foreign-prebuilds] ${chip}: kept ${kept.length} prebuild dir(s), removed ${removed.length}`);
  for (const gone of removed) console.log(`[prune-foreign-prebuilds]   removed ${gone}`);
};

exports.afterPack = afterPack;
exports.default = afterPack;
exports.prune = prune;
exports.bundleDirIn = bundleDirIn;
exports.chipOfBundle = chipOfBundle;
exports.dirsNamed = dirsNamed;
exports.prebuildDirsUnder = prebuildDirsUnder;
