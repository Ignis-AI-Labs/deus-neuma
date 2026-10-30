'use strict';

// appimage-launcher-hook.cjs — electron-builder's afterPack hook (electron-builder.yml). When the
// AppImage is among the targets, the packed app's binary becomes neuma-bin and build/appimage-launcher.sh
// takes its name, so the AppImage decides at launch whether the renderer sandbox can run (the
// launcher's header says why it cannot be decided inside the app). `--linux dir`, the rpm and deb
// input, is left as packed: they install a setuid chrome-sandbox.

const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = path.join(__dirname, '..', 'build', 'appimage-launcher.sh');

/**
 * Does this pack build an AppImage? Pure.
 * @param {{targets: Array<{name: string}>, electronPlatformName: string}} context
 * @returns {boolean}
 */
const buildsAppImage = ({ targets, electronPlatformName }) =>
  electronPlatformName === 'linux' && targets.some((t) => t.name === 'appImage');

/**
 * Put the launcher in front of the binary. impure (fs).
 * @param {{appOutDir: string, targets: Array<{name: string}>, electronPlatformName: string,
 *   packager: {executableName: string}}} context
 */
const installLauncher = async (context) => {
  if (!buildsAppImage(context)) return;
  const binary = path.join(context.appOutDir, context.packager.executableName);
  fs.renameSync(binary, path.join(context.appOutDir, 'neuma-bin'));
  fs.copyFileSync(LAUNCHER, binary);
  fs.chmodSync(binary, 0o755);
};

// electron-builder takes the export named after the hook
module.exports = { afterPack: installLauncher, buildsAppImage };
