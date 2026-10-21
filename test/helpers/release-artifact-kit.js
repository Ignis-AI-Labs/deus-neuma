// release-artifact-kit — tiny but REAL installers for the publisher's tests: an AppImage (the
// electron-builder type-2 runtime + a real squashfs), an rpm (rpmbuild) and a deb (ar + tar), each
// holding resources/app/electron/release-public-key.cjs where the real build puts it. The
// publisher opens them with the same tools it opens a real release with. impure (spawns, writes).
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY_FILE = 'resources/app/electron/release-public-key.cjs';
const keySource = (keyText) => `module.exports = { RELEASE_PUBLIC_KEY: '${keyText}' };\n`;

/** The AppImage runtime electron-builder already downloaded on this box, or null. */
export const APPIMAGE_RUNTIME = [
  join(homedir(), '.cache/electron-builder/appimage/appimage-12.0.1/runtime-x64'),
].find((p) => existsSync(p)) ?? null;

const stage = (root, keyText) => {
  mkdirSync(join(root, 'resources/app/electron'), { recursive: true });
  writeFileSync(join(root, KEY_FILE), keySource(keyText));
};

/** A real AppImage at `out` whose app tree embeds keyText. */
export const tinyAppImage = (out, keyText) => {
  const work = mkdtempSync(join(tmpdir(), 'kit-appimage-'));
  stage(join(work, 'root'), keyText);
  execFileSync('mksquashfs', [join(work, 'root'), join(work, 'fs.sqfs'), '-noappend', '-quiet', '-all-root'], { stdio: 'ignore' });
  writeFileSync(out, Buffer.concat([readFileSync(APPIMAGE_RUNTIME), readFileSync(join(work, 'fs.sqfs'))]));
  chmodSync(out, 0o755);
};

/** A real deb at `out` whose /opt/NEUMA tree embeds keyText. */
export const tinyDeb = (out, keyText) => {
  const work = mkdtempSync(join(tmpdir(), 'kit-deb-'));
  stage(join(work, 'data/opt/NEUMA'), keyText);
  mkdirSync(join(work, 'control'));
  writeFileSync(join(work, 'control/control'), 'Package: neuma\nVersion: 0.0.1\nArchitecture: amd64\nMaintainer: test\nDescription: test\n');
  writeFileSync(join(work, 'debian-binary'), '2.0\n');
  execFileSync('tar', ['--create', '--xz', '--file', join(work, 'control.tar.xz'), '--directory', join(work, 'control'), '.']);
  execFileSync('tar', ['--create', '--xz', '--file', join(work, 'data.tar.xz'), '--directory', join(work, 'data'), '.']);
  execFileSync('ar', ['rc', out, 'debian-binary', 'control.tar.xz', 'data.tar.xz'], { cwd: work });
};

/** A real rpm at `out` whose /opt/NEUMA tree embeds keyText. */
export const tinyRpm = (out, keyText) => {
  const work = mkdtempSync(join(tmpdir(), 'kit-rpm-'));
  stage(join(work, 'src'), keyText);
  const spec = [
    'Name: neuma-kit', 'Version: 0.0.1', 'Release: 1', 'Summary: test', 'License: none', 'BuildArch: noarch',
    '%global debug_package %{nil}', '%global __os_install_post %{nil}',
    '%description', 'test', '%install',
    `mkdir -p %{buildroot}/opt/NEUMA && cp -a ${join(work, 'src')}/. %{buildroot}/opt/NEUMA/`,
    '%files', '/opt/NEUMA', '',
  ].join('\n');
  writeFileSync(join(work, 'kit.spec'), spec);
  execFileSync('rpmbuild', ['-bb', '--quiet', '--define', `_topdir ${join(work, 'top')}`, join(work, 'kit.spec')], { stdio: 'ignore' });
  const built = join(work, 'top/RPMS/noarch');
  copyFileSync(join(built, readdirSync(built)[0]), out);
};
