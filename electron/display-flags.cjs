'use strict';

/**
 * The desk's display platform on Linux: X11, which under a Wayland session is
 * XWayland — the way it ran on Electron 33.
 *
 * Electron 38 made Chromium pick native Wayland in a Wayland session, and
 * Electron 44 fixes the platform before main runs, so nothing inside the app
 * can choose it: every launch path passes this flag instead (electron-builder
 * linux.executableArgs, the rpm/deb `neuma` wrapper, the login entry,
 * electron:dev, the sitting scripts). Under native Wayland a window may not
 * place itself (primary-placement.cjs), and native Wayland measured no faster
 * on this desk while renderer CPU rose (7bd597dbd). Chromium ignores the
 * switch off Linux.
 */
const LINUX_DISPLAY_FLAG = '--ozone-platform=x11';

module.exports = { LINUX_DISPLAY_FLAG };
