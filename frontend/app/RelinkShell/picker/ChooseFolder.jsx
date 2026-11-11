// ChooseFolder — OPEN FOLDER the way this computer already does it.
//
// Design note, 2026-11-10: […].
// In the app, every folder choice is the system's own dialog (Electron's
// dialog:openDirectory: KDE's through the desktop portal, Explorer's, Finder's),
// with its places, new folder and search. The desk's own FolderPicker stays only
// where no system dialog exists: the desk opened in a plain web browser, which
// cannot hand back a real path, or a system dialog that failed to open.
//
// Same contract as FolderPicker: onPick(absolutePath) once, or onCancel().

import { useEffect, useRef, useState } from 'react';
import { FolderPicker } from './FolderPicker.jsx';

// impure — the app's bridge to the system dialog, or null in a plain browser
const systemDialog = () => (typeof window !== 'undefined' && typeof window.neuma?.chooseDirectory === 'function'
  ? window.neuma.chooseDirectory
  : null);

/**
 * @param {{initialPath?: string, onPick: (abs: string) => void, onCancel: () => void,
 *   title?: string, draggable?: boolean}} props
 */
export const ChooseFolder = ({ initialPath, onPick, onCancel, title = 'Open folder', draggable = false }) => {
  const [fallback, setFallback] = useState(() => !systemDialog());
  const asked = useRef(false);

  useEffect(() => {
    const ask = systemDialog();
    if (!ask || asked.current) return;
    asked.current = true; // one dialog per mount
    ask({ title, defaultPath: initialPath }).then(
      (abs) => (abs ? onPick(abs) : onCancel()),
      () => setFallback(true),
    );
  }, [title, initialPath, onPick, onCancel]);

  if (!fallback) return null;
  return <FolderPicker initialPath={initialPath} onPick={onPick} onCancel={onCancel} draggable={draggable} />;
};
