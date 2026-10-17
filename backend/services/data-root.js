// data-root.js — the ONE resolution point for runtime-writable data.
//
// In the packaged app the install tree is read-only (AppImage squashfs,
// root-owned /opt), so stores cannot live at repo-relative data/ paths;
// electron/main.cjs sets NEUMA_DATA_ROOT to a dir under the OS home. In dev
// the env is unset and everything keeps landing in the repo's data/ — zero
// behavior change for the existing workflow.

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The writable data root: NEUMA_DATA_ROOT (packaged) else the repo's data/.
 * Read at call time so launch-scoped env isolation keeps working.
 * @returns {string}
 */
// impure (reads process.env)
export const getDataRoot = () => process.env.NEUMA_DATA_ROOT || join(__dirname, '../../data');

/**
 * The settings-store directory under the data root.
 * @returns {string}
 */
// impure (reads process.env via getDataRoot)
export const getSettingsDir = () => join(getDataRoot(), 'settings');

/**
 * The DNA vault root: NEUMA_VAULT_ROOT (packaged — the install tree is
 * read-only and a being's DNA is sovereign, writable data) else the repo's
 * vault/ (dev). Kept OUT of the data root so the dev layout is untouched.
 * @returns {string}
 */
// impure (reads process.env)
export const getVaultRoot = () => process.env.NEUMA_VAULT_ROOT || join(__dirname, '../../vault');
