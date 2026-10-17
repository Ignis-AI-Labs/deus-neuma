// files-drop — the drop decision, pure.
//
// THE TWO-WAY BRIDGE (Design note, 2026-07-28: a file dragged in from the OS file
// manager needs a PLACE to land, and the tree answers that the way the
// witness's own file manager does: onto a folder row it lands IN the
// folder; onto a file row it lands BESIDE the file (its parent); onto the
// bare pane it lands NOWHERE — the explorer says so rather than guessing a
// folder the witness never chose.

import { dirOf } from '../../../utils/path.js';

/**
 * The directory a drop onto this row targets.
 * @param {{path?: string, type?: string}|null|undefined} entry the row under the cursor
 * @returns {string|null} absolute directory path, or null when the row names no place
 */
export const dropDirForRow = (entry) => {
  if (!entry || typeof entry.path !== 'string' || !entry.path) return null;
  if (entry.type === 'dir') return entry.path;
  return dirOf(entry.path);
};

/** Is this drag carrying OS files (as opposed to an in-app row drag)? Pure. */
export const dragCarriesFiles = (dataTransfer) =>
  Array.from(dataTransfer?.types || []).includes('Files');

/**
 * The drag-out payload for a row, when the desk is NOT the Electron shell:
 * a Chromium `DownloadURL` — the browser downloads the file when the row is
 * dropped on the OS. Directories have no single-file form: null, and the
 * caller says the drag-out needs the desktop shell.
 * @param {{path?: string, type?: string, name?: string}} entry
 * @param {(path: string) => string} rawUrlFor builds the authenticated raw URL
 * @returns {string|null} the DownloadURL data-transfer value
 */
export const downloadUrlFor = (entry, rawUrlFor) => {
  if (!entry || entry.type === 'dir' || !entry.path) return null;
  return `application/octet-stream:${entry.name || 'download'}:${rawUrlFor(entry.path)}`;
};
