// FolderOpenFlow — the overlay of the open-folder gesture, as one component.
//
// While `open`, the FolderPicker browses the real disk; a pick runs the shared
// useOpenFolder flow, which lands the folder as THIS WINDOW's working focus
// (D5). Opening never mutates the project store, so no collision can arise
// here — ownership questions belong to ProjectsApp's explicit attach and
// reconnect actions (CollisionPrompt lives on there). The flow reports out
// through onDone(opened, message?): opened=true when the folder landed as the
// working focus, false on cancel or error (message says why) — the CALLER
// surfaces the message in its own voice.
//
// The overlay PORTALS to document.body: .picker-overlay anchors to its nearest
// positioned ancestor, and from a composer control that ancestor is a 34px
// button root (proven live — the picker was unclickable). Escaping to the body
// makes the flow a desk-level modal wherever it was summoned from.

import { createPortal } from 'react-dom';
import { FolderPicker } from '../picker/FolderPicker.jsx';
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
    <FolderPicker
      initialPath={initialPath}
      draggable
      onPick={(abs) => openFolder(abs).then(({ status, message }) => onDone(status === 'opened', message))}
      onCancel={() => onDone(false)}
    />,
    document.body,
  );
};
