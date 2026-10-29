// use-files-dnd — THE TWO-WAY BRIDGE (ruling, 2026-07-28): OS ⇄ Explorer drag,
// extracted whole from FilesApp (size law). dropPath plus the four drag
// handlers; the shared refreshers and setters arrive as args — state
// ownership stays with FilesApp, no restructure.

import { useCallback, useState } from 'react';
import { baseName } from '../../../utils/path.js';
import { uploadFile, rawFileUrl } from '../../../services/user-files.js';
import { dropDirForRow, dragCarriesFiles, downloadUrlFor } from './files-drop.js';

export const useFilesDnd = ({ rootsRef, setNote, refreshDir, refreshGit }) => {
  const [dropPath, setDropPath] = useState(null); // the folder a hovering OS drag would land in

  // Drag OUT: the desk's own row becomes the file itself on the OS.
  const onDragOut = useCallback((e, entry) => {
    // The Electron desk fires a REAL OS-level drag (Dolphin, the desktop,
    // another app copies the actual file). The HTML5 drag never starts.
    if (typeof window !== 'undefined' && window.neuma && typeof window.neuma.startFileDrag === 'function') {
      e.preventDefault();
      window.neuma.startFileDrag(entry.path);
      return;
    }
    // A plain browser: Chromium's DownloadURL — the drop downloads the file.
    const payload = downloadUrlFor(entry, rawFileUrl);
    if (!payload) {
      e.preventDefault();
      setNote('Dragging a folder out needs the desktop shell.');
      return;
    }
    e.dataTransfer.setData('DownloadURL', payload);
    e.dataTransfer.effectAllowed = 'copy';
  }, [setNote]);

  const onDragOverRow = useCallback((e, entry) => {
    if (!dragCarriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDropPath(dropDirForRow(entry));
  }, []);

  const onDragLeaveRow = useCallback((e, entry) => {
    if (!dragCarriesFiles(e.dataTransfer)) return;
    setDropPath((cur) => (cur === dropDirForRow(entry) ? null : cur));
  }, []);

  // Drop IN: each file lands inside the row's folder — the server sanitizes
  // names and suffixes collisions, so a drop never destroys; the note says
  // exactly what landed where (and what was refused and why).
  const onDropFiles = useCallback(async (e, entry) => {
    if (!dragCarriesFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropPath(null);
    const dir = dropDirForRow(entry);
    const files = Array.from(e.dataTransfer.files || []);
    if (!dir || !files.length) return;
    setNote('');
    const landed = [];
    const failed = [];
    for (const file of files) {
      try { landed.push(await uploadFile(dir, file)); } catch (err) { failed.push(`${file.name}: ${err.message}`); }
    }
    if (landed.length) {
      await refreshDir(dir);
      refreshGit(rootsRef.current);
    }
    const renamed = landed.filter((l) => l.renamed).map((l) => l.name);
    const bits = [];
    if (landed.length) {
      bits.push(`${landed.length} landed in ${baseName(dir)}${renamed.length ? ` — kept both: ${renamed.join(', ')}` : ''}`);
    }
    if (failed.length) bits.push(`refused: ${failed.join(' · ')}`);
    setNote(bits.join(' — '));
  }, [refreshDir, refreshGit, rootsRef, setNote]);

  return { dropPath, setDropPath, onDragOut, onDragOverRow, onDragLeaveRow, onDropFiles };
};
