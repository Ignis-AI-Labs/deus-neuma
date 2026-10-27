#!/usr/bin/env node
// build-rpm.mjs — package release/linux-unpacked as a Fedora-native RPM.
//
// Why not electron-builder's rpm target: it shells out to its bundled fpm
// (2017-era ruby), which fails against rpmbuild 6.x (Fedora 40+; this box
// runs RPM 6.0.2). rpmbuild itself is present and works on any Fedora dev
// machine, so we drive it directly — no ruby, no fpm, no libcrypt shim.
//
// Input:  release/linux-unpacked (from `electron-builder --linux dir`)
//         build/icon.png, package.json (name/version/description)
// Output: release/neuma-<version>-1.fc<tag>.x86_64.rpm
//
// The RPM's Requires list is what makes […] structural: `dnf install ./neuma.rpm` pulls every system library the
// shell needs automatically — the Windows-redist equivalent, done the Fedora
// way. AutoReqProv stays OFF: the bundled tree (node_modules binaries) would
// poison the generated dependency set.
//
// impure (process IO, spawns rpmbuild).
import { mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { menuEntry } from './linux-menu-entry.mjs';
import { packageDescription } from './installer-license.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const UNPACKED = join(ROOT, 'release', 'linux-unpacked');
const ICON = join(ROOT, 'build', 'icon.png');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const die = (msg) => { process.stderr.write(`build-rpm: ${msg}\n`); process.exit(1); };

if (!existsSync(join(UNPACKED, 'neuma'))) {
  die('release/linux-unpacked missing — run `npx electron-builder --linux dir` first');
}
if (!existsSync(ICON)) die('build/icon.png missing');

// System libraries the Electron shell links against (Fedora package names).
// Mirrors the list electron-builder passes fpm, trimmed to Fedora reality.
const REQUIRES = [
  'gtk3', 'libnotify', 'nss', 'libXScrnSaver', 'libXtst',
  'xdg-utils', 'at-spi2-core', 'libuuid', 'libsecret', 'alsa-lib',
  'mesa-libgbm', 'libdrm',
];

const desktop = menuEntry(pkg.description);

const spec = `Name: neuma
Version: ${pkg.version}
Release: 1%{?dist}
Summary: ${pkg.description}
License: ${pkg.license}
URL: ${pkg.homepage}
Vendor: Ignis AI Labs LLC
Packager: Ignis AI Labs LLC <legal@ignislabs.ai>
AutoReqProv: no
${REQUIRES.map((r) => `Requires: ${r}`).join('\n')}

%description
${packageDescription(pkg.description)}

%install
mkdir -p %{buildroot}/opt/NEUMA %{buildroot}/usr/bin \\
  %{buildroot}/usr/share/applications \\
  %{buildroot}/usr/share/icons/hicolor/512x512/apps
cp -a @UNPACKED@/. %{buildroot}/opt/NEUMA/
ln -sf /opt/NEUMA/neuma %{buildroot}/usr/bin/neuma
install -m 644 @DESKTOP@ %{buildroot}/usr/share/applications/neuma.desktop
install -m 644 @ICON@ %{buildroot}/usr/share/icons/hicolor/512x512/apps/neuma.png

%files
/opt/NEUMA
/usr/bin/neuma
/usr/share/applications/neuma.desktop
/usr/share/icons/hicolor/512x512/apps/neuma.png
`;

const work = join(tmpdir(), `neuma-rpm-${process.pid}`);
try {
  for (const d of ['BUILD', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS']) mkdirSync(join(work, d), { recursive: true });
  const desktopPath = join(work, 'neuma.desktop');
  writeFileSync(desktopPath, desktop);
  const specText = spec
    .replaceAll('@UNPACKED@', UNPACKED)
    .replaceAll('@DESKTOP@', desktopPath)
    .replaceAll('@ICON@', ICON);
  writeFileSync(join(work, 'SPECS', 'neuma.spec'), specText);

  execFileSync('rpmbuild', [
    '-bb',
    '--define', `_topdir ${work}`,
    '--define', `buildroot ${join(work, 'BUILD', 'neuma-root')}`,
    join(work, 'SPECS', 'neuma.spec'),
  ], { stdio: ['ignore', 'pipe', 'inherit'] });

  const rpms = readdirSync(join(work, 'RPMS', 'x86_64')).filter((f) => f.endsWith('.rpm'));
  if (rpms.length !== 1) die(`expected exactly 1 rpm, found ${rpms.length}`);
  const out = join(ROOT, 'release', rpms[0]);
  cpSync(join(work, 'RPMS', 'x86_64', rpms[0]), out);
  process.stdout.write(`build-rpm: wrote ${out}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
