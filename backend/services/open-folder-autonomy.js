// open-folder-autonomy.js — THE OPEN FOLDER on AUTO. isLiveShell pure; landsInOpenFolder reads the disk (realpath).
//
// Design note, 2026-10-28: […] Ruling: a
// chat on AUTO works FOR REAL in the folder open in the operator's Explorer — its
// shell runs on the live folder (witness-coding-sandbox.js `live`) and a delete
// inside it lands with no card. With SANDBOX ON, ASK keeps the overlay shell
// and the cards. SANDBOX OFF is a separate switch: direct execution regardless
// of chat mode. Outside the open folder every approval rule stands, and money,
// outward speech and security acts stay hard-gated in every mode
// (protocol-guard.js). With SANDBOX ON, `.git` stays masked in the shell
// (ruling: […]): history is the safety net.

import fs from 'node:fs';
import path from 'node:path';
import { isWithin } from './ground-roots.js';

// impure — the path with every symlink in its chain resolved, up to the
// nearest part that exists (a file about to be named need not exist yet)
const realpathOfNearestExistingSync = (filePath) => {
  let current = path.resolve(filePath);
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(current), ...tail); } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(filePath);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
};

/**
 * Does the shell stand LIVE in the open folder for this call — AUTO, and the
 * shell's ground IS the operator's focus ground (never a seat's own house
 * workspace)? Pure.
 * @param {{ mode: string, sourceRoot?: string|null, ground?: string|null }} input
 * @returns {boolean}
 */
export const isLiveShell = ({ mode, sourceRoot, ground }) =>
  mode === 'auto' && typeof sourceRoot === 'string' && typeof ground === 'string'
  && sourceRoot !== '' && ground !== '' && path.resolve(sourceRoot) === path.resolve(ground);

/**
 * Is this act one AUTO lets land without a card because it stands inside the
 * open folder? Only a delete by an ABSOLUTE path inside the focus ground — a
 * relative path would resolve against the backend's own directory, so it stays
 * gated — and inside it once every symlink is followed: a link in the folder
 * pointing anywhere else keeps its card. impure (realpath).
 * @param {{ server: string, tool: string, args?: object, ground?: string|null }} input
 * @returns {boolean}
 */
export const landsInOpenFolder = ({ server, tool, args, ground }) =>
  server === 'filesystem' && tool === 'delete_file' && typeof ground === 'string' && ground !== ''
  && typeof args?.path === 'string' && path.isAbsolute(args.path) && isWithin(args.path, ground)
  && isWithin(realpathOfNearestExistingSync(args.path), realpathOfNearestExistingSync(ground));
