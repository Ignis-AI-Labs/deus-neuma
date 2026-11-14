// FolderOpenFlow — the overlay of the open-folder gesture, as one component.
//
// While `open`, the system's own folder dialog asks (ChooseFolder; the desk's
// FolderPicker only in a plain browser); a pick runs the shared useOpenFolder
// flow, which lands the folder as THIS WINDOW's working focus (D5). The flow
// reports out through onDone(opened, message?): opened=true when the folder
// landed as the working focus, false on cancel or error (message says why) —
// the CALLER surfaces the message in its own voice.
//
// The overlay PORTALS to document.body: .picker-overlay anchors to its nearest
// positioned ancestor, and from a composer control that ancestor is a 34px
// button root (proven live — the picker was unclickable). Escaping to the body
// makes the flow a desk-level modal wherever it was summoned from.

import { createPortal } from 'react-dom';
import { ChooseFolder } from './picker/ChooseFolder.jsx';
import { useOpenFolder } from './use-open-folder.js';

/**
 * @param {{
 *   open: boolean,
 *   initialPath?: string,
 *   onDone: (opened: boolean, message?: string) => void,
 * }} props
 */
export const FolderOpenFlow = ({ open, initialPath, onDone }) => {
  const { openFolder } = useOpenFolder();

  if (!open) return null;
  return createPortal(
    <ChooseFolder
      initialPath={initialPath}
      draggable
      onPick={(abs) => openFolder(abs).then(({ status, message }) => onDone(status === 'opened', message))}
      onCancel={() => onDone(false)}
    />,
    document.body,
  );
};
