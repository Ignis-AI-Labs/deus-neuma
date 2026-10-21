// App inventory — where the RUNNING app's own dependency record lives.
//
// A dev checkout carries package-lock.json at its root. A packaged install
// does not: electron-builder drops package-lock.json from `files:` by its own
// default exclusions, so the lockfile ships through `extraResources` to
// `<resources>/package-lock.json`, beside the app tree at `<resources>/app`
// (asar: false). Without it the watch read `checked: 0` on every user's
// machine while their node_modules held the vulnerable versions.
//
// The packaged app tree moves between launches (an AppImage mounts at a fresh
// /tmp/.mount_NEUMA-XXXX each time), so a watched entry marked `app: true`
// means "this running app", resolved here at scan time — never the path
// recorded the day it was seeded.

import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The running app's root: the repo in dev, `<resources>/app` packaged. */
export const APP_ROOT = resolve(join(__dirname, '../../..'));

/**
 * impure — this process's layout. Electron sets process.resourcesPath in the
 * backend child too (ELECTRON_RUN_AS_NODE); under a plain `node` it is unset.
 * @returns {{appRoot: string, resourcesPath: string|null}}
 */
export const currentLayout = () => ({ appRoot: APP_ROOT, resourcesPath: process.resourcesPath || null });

// pure — the app tree sits at <resources>/app only in an installed build;
// a dev Electron's resources dir is inside node_modules/electron instead.
export const isPackagedLayout = ({ appRoot, resourcesPath }) =>
  Boolean(resourcesPath) && resolve(appRoot) === resolve(resourcesPath, 'app');

/**
 * pure — what to read for one watched repo: the directory that must stand,
 * the lockfile inside it, and whether it is an installed app (whose dev-only
 * packages are not on disk).
 * @param {{path: string, app?: boolean}} repo a watch entry
 * @param {{appRoot: string, resourcesPath: string|null}} layout
 * @returns {{root: string, lockfile: string, installed: boolean}}
 */
export const lockfileTarget = (repo, layout) => {
  const isApp = repo.app === true || resolve(repo.path) === resolve(layout.appRoot);
  if (!isApp) return { root: repo.path, lockfile: join(repo.path, 'package-lock.json'), installed: false };
  const installed = isPackagedLayout(layout);
  return {
    root: layout.appRoot,
    lockfile: installed ? join(layout.resourcesPath, 'package-lock.json') : join(layout.appRoot, 'package-lock.json'),
    installed,
  };
};
