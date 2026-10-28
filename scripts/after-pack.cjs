'use strict';

// after-pack.cjs — the ONE afterPack hook electron-builder.yml can hold.
//
// afterPack is a single slot, and two platforms need it for two unrelated
// reasons. So this file does nothing itself: it decides which hook runs, and
// each of them keeps owning its own job.
//
//   linux + AppImage → scripts/appimage-launcher-hook.cjs
//     The packed binary becomes neuma-bin and build/appimage-launcher.sh takes
//     its name, so the AppImage can decide at launch whether the renderer
//     sandbox can run. `--linux dir` (the rpm and deb input) is left as packed.
//
//   darwin → scripts/prune-foreign-prebuilds.cjs
//     node_modules on the build machine holds binaries for that machine, so a
//     per-chip mac bundle would carry node-pty's other-chip prebuilds. The hook
//     reads the chip off the packaged executable and deletes the rest.
//
// A third platform that needs a hook is added here, not by replacing one of
// these. test/unit/after-pack-dispatch.test.js holds the routing.

const { afterPack: appImageLauncher } = require('./appimage-launcher-hook.cjs');
const { afterPack: pruneForeignPrebuilds } = require('./prune-foreign-prebuilds.cjs');

/** Which hooks run for this pack. Pure. */
const hooksFor = ({ electronPlatformName, targets = [] }) => {
  const hooks = [];
  if (electronPlatformName === 'linux' && targets.some((t) => t.name === 'appImage')) {
    hooks.push(['appimage-launcher', appImageLauncher]);
  }
  if (electronPlatformName === 'darwin') {
    hooks.push(['prune-foreign-prebuilds', pruneForeignPrebuilds]);
  }
  return hooks;
};

/**
 * impure — runs whichever hooks this pack needs, in a fixed order.
 * @param {object} context electron-builder's afterPack context
 */
const afterPack = async (context) => {
  for (const [, hook] of hooksFor(context)) {
    // eslint-disable-next-line no-await-in-loop -- one hook at a time, on purpose
    await hook(context);
  }
};

// electron-builder takes the export named after the hook
module.exports = { afterPack, hooksFor };
