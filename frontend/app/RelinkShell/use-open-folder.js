// use-open-folder.js — impure hook: the desk-wide "open this folder" gesture.
//
// One flow wherever it starts (the Explorer, REPO MAP, the composer's attach
// menu, the shelf): hand it an absolute path and it lands that folder as THIS
// WINDOW's working focus (D5). The gesture: (1) ensure the folder is an open
// Files root, (2) tell the ONE mounted FILES tree a root arrived (it re-fetches
// roots and expands this folder — without this the tree filters a stale root
// list and shows nothing until an unrelated remount), (3) set the window focus
// through FocusContext.

import { useCallback, useContext } from 'react';
import { FocusContext } from './use-desk-focus.js';
import { openFolder as openFilesRoot } from '../../services/user-files.js';
import { recordRecent } from './folder-shelf.js';
import { loadShelf, saveShelf } from '../windowing/window-storage.js';

/**
 * @returns {{
 *   openFolder: (absPath: string) => Promise<{ status: 'opened'|'error', message?: string }>,
 * }}
 */
export const useOpenFolder = () => {
  const focusLens = useContext(FocusContext);

  const openFolder = useCallback(async (absPath) => {
    // A flow mounted outside the desk host has no window lens — an honest
    // error beats a silently unfocused open.
    if (!focusLens) return { status: 'error', message: 'This surface has no window focus lens.' };
    try {
      await openFilesRoot(absPath); // the folder becomes (or already is) an open Files root
      // The mounted tree's root list predates this open — the same event the
      // DELIVERY desk fires tells it to re-fetch roots and expand this folder.
      window.dispatchEvent(new CustomEvent('neuma:files-focus-root', { detail: { root: absPath } }));
      focusLens.setFocus({ kind: 'folder', path: absPath });
      // The shelf's ONE recording site — every open gesture lands here, so
      // RECENTS is folders-only by construction (a re-open bumps to MRU head).
      // The event tells this window's mounted shelf; sibling desk windows
      // hear the localStorage `storage` event instead.
      saveShelf(recordRecent(loadShelf(), absPath));
      window.dispatchEvent(new CustomEvent('neuma:folder-shelf'));
      return { status: 'opened' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  }, [focusLens]);

  return { openFolder };
};
