#!/usr/bin/env node
// build-deb.mjs — package release/linux-unpacked as a Debian/Ubuntu .deb.
//
// Why not electron-builder's deb target: it shells out to its bundled fpm
// (2017-era ruby), whose interpreter links against libcrypt.so.1 — dropped by
// Fedora 40+ (this box ships libcrypt.so.2 only, and libxcrypt-compat is not
// installed). fpm dies with […] before it
// writes a byte. This is the SAME fpm wall that already forced the RPM onto
// its own path (see build-rpm.mjs); the deb simply hit it from the other side.
//
// A .deb is an ar archive of exactly three members, in this order:
//   debian-binary    the literal text "2.0\n"
//   control.tar.xz   the package metadata + maintainer scripts
//   data.tar.xz      the payload, laid out as it lands on the filesystem
// GNU ar, tar, and xz are all present on any dev box, so we build it directly
// — no ruby, no fpm, and no dpkg-deb (which Fedora does not ship either).
//
// Input:  release/linux-unpacked (from `electron-builder --linux dir`)
//         build/icon.png, package.json (name/version/description)
// Output: release/neuma_<version>_amd64.deb
//
// impure (process IO, spawns ar/tar).
import { mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..');
const UNPACKED = join(ROOT, 'release', 'linux-unpacked');
const ICON = join(ROOT, 'build', 'icon.png');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const die = (msg) => { process.stderr.write(`build-deb: ${msg}\n`); process.exit(1); };

if (!existsSync(join(UNPACKED, 'neuma'))) {
  die('release/linux-unpacked missing — run `npx electron-builder --linux dir` first');
}
if (!existsSync(ICON)) die('build/icon.png missing');

// Debian package names for the system libraries the Electron shell links
// against — the same set electron-builder passes fpm, which is what makes
// `apt install ./neuma.deb` pull the prerequisites automatically.
const DEPENDS = [
  'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6',
  'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libsecret-1-0',
  'libasound2', 'libgbm1', 'libdrm2',
];

const desktop = `[Desktop Entry]
Type=Application
Name=NEUMA
Comment=${pkg.description}
Exec=neuma %U
Icon=neuma
Categories=Utility;
Terminal=false
StartupWMClass=NEUMA
`;

/** Installed-Size is in KiB and Debian policy expects it. impure (spawns du). */
const installedSizeKiB = (dir) =>
  execFileSync('du', ['-sk', dir], { encoding: 'utf8' }).split(/\s+/)[0];

const work = join(tmpdir(), `neuma-deb-${process.pid}`);
try {
  const dataRoot = join(work, 'data');
  const controlRoot = join(work, 'control');
  mkdirSync(join(dataRoot, 'opt'), { recursive: true });
  mkdirSync(join(dataRoot, 'usr/bin'), { recursive: true });
  mkdirSync(join(dataRoot, 'usr/share/applications'), { recursive: true });
  mkdirSync(join(dataRoot, 'usr/share/icons/hicolor/512x512/apps'), { recursive: true });
  mkdirSync(controlRoot, { recursive: true });

  // The payload, laid out exactly as it lands on the target filesystem.
  cpSync(UNPACKED, join(dataRoot, 'opt/NEUMA'), { recursive: true });
  writeFileSync(join(dataRoot, 'usr/share/applications/neuma.desktop'), desktop);
  cpSync(ICON, join(dataRoot, 'usr/share/icons/hicolor/512x512/apps/neuma.png'));
  // A relative symlink, so the link is correct no matter where the archive is
  // unpacked or inspected from.
  execFileSync('ln', ['-sf', '/opt/NEUMA/neuma', join(dataRoot, 'usr/bin/neuma')]);

  // Electron's sandbox helper must be setuid root, or the app refuses to start
  // on a normal Debian kernel ([…]). electron-builder's own postinst does exactly this.
  const postinst = `#!/bin/bash
set -e
chmod 4755 /opt/NEUMA/chrome-sandbox || true
update-desktop-database /usr/share/applications || true
`;
  const prerm = `#!/bin/bash
set -e
update-desktop-database /usr/share/applications || true
`;

  const control = `Package: neuma
Version: ${pkg.version}
License: BUSL-1.1
Vendor: Ignis AI Labs LLC <legal@ignislabs.ai>
Architecture: amd64
Maintainer: Ignis AI Labs LLC <legal@ignislabs.ai>
Installed-Size: ${installedSizeKiB(dataRoot)}
Depends: ${DEPENDS.join(', ')}
Recommends: libappindicator3-1
Section: utils
Priority: optional
Homepage: https://github.com/Ignis-AI-Labs/deus-neuma
Description: ${pkg.description}
`;

  writeFileSync(join(controlRoot, 'control'), control);
  writeFileSync(join(controlRoot, 'postinst'), postinst);
  writeFileSync(join(controlRoot, 'prerm'), prerm);
  chmodSync(join(controlRoot, 'postinst'), 0o755);
  chmodSync(join(controlRoot, 'prerm'), 0o755);

  // debian-binary must be the FIRST member of the archive, uncompressed.
  writeFileSync(join(work, 'debian-binary'), '2.0\n');

  const tarUp = (cwd, out) => execFileSync('tar', [
    '--create', '--xz', '--file', out,
    // Reproducibility + correct ownership on the target: everything in a .deb
    // belongs to root, never to whoever happened to build it.
    '--owner=root:0', '--group=root:0', '--numeric-owner',
    '--directory', cwd, '.',
  ], { stdio: ['ignore', 'pipe', 'inherit'] });

  tarUp(controlRoot, join(work, 'control.tar.xz'));
  tarUp(dataRoot, join(work, 'data.tar.xz'));

  const out = join(ROOT, 'release', `neuma_${pkg.version}_amd64.deb`);
  rmSync(out, { force: true });
  // `ar r` in this exact member order is what makes it a valid .deb.
  execFileSync('ar', ['rc', out,
    join(work, 'debian-binary'),
    join(work, 'control.tar.xz'),
    join(work, 'data.tar.xz'),
  ], { stdio: ['ignore', 'pipe', 'inherit'] });

  process.stdout.write(`build-deb: wrote ${out}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
