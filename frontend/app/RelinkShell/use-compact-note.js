// use-compact-note.js — the composer listens for the portal's answer to a
// /compact and shows a refusal or a failure on its note line (compact-note.js
// words it); a run that goes ahead is drawn in the chat (CompactMarker.jsx).
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
    // Running and done stand in the chat itself (CompactMarker); the composer's
    // line is the refusal line, so it says only what stopped a compaction.
    const onFrame = (frame) => setNote(frame?.state === 'refused' || frame?.state === 'failed'
      ? compactNote(frame, name) : null);
    wsService.on('session:compact', onFrame);
    return () => wsService.off('session:compact', onFrame);
  }, [wsService, setNote, name]);
};
