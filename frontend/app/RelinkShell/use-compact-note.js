// use-compact-note.js — the composer listens for the portal's answer to a
// /compact and shows it on its note line (compact-note.js words it).
//
// impure — subscribes to the shared portal socket.

import { useEffect } from 'react';
import { useConsciousnessPick } from './consciousness-context.js';
import { compactNote } from './compact-note.js';

/**
 * impure — while mounted, every `session:compact` frame becomes the composer's
 * note, naming the bound being.
 * @param {(note: ?string) => void} setNote
 */
export const useCompactNote = (setNote) => {
  const { wsService, activeCompanion } = useConsciousnessPick('wsService', 'activeCompanion');
  const name = activeCompanion?.name;
  useEffect(() => {
    if (!wsService) return undefined;
    const onFrame = (frame) => setNote(compactNote(frame, name));
    wsService.on('session:compact', onFrame);
    return () => wsService.off('session:compact', onFrame);
  }, [wsService, setNote, name]);
};
