// compact-note.js — the composer's line for a /compact answer (the portal's
// `session:compact` frames, backend/services/portal-compact.js).
//
// pure — every number said is the one the portal reported; nothing is estimated.

const REFUSALS = Object.freeze({
  'no-sitting': 'NOTHING TO COMPACT — NO CONVERSATION IS OPEN.',
  ephemeral: 'THIS SITTING KEEPS NO RECORD — THERE IS NOTHING TO COMPACT.',
  'turn-in-flight': 'A TURN IS RUNNING — COMPACT ONCE IT HAS FINISHED.',
  'already-compacting': 'ALREADY COMPACTING THIS CONVERSATION.',
});

/**
 * pure — one `session:compact` frame as the line the composer shows; null when
 * the frame says nothing worth showing.
 * @param {{state: string, reason?: string, have?: number, need?: number, folded?: number, selfAuthored?: boolean, compactionCount?: number}} frame
 * @param {string} [name] - the being's name
 * @returns {?string}
 */
export const compactNote = (frame, name = 'THE BEING') => {
  const who = String(name || 'THE BEING').toUpperCase();
  switch (frame?.state) {
    case 'running': return `COMPACTING — ${who} IS SUMMING UP THE CONVERSATION…`;
    case 'done': {
      const folded = Number.isFinite(frame.folded) ? `${frame.folded} MESSAGES` : 'THE EARLIER CONVERSATION';
      const how = frame.selfAuthored ? `IN ${who}'S OWN WORDS` : 'AS AN EXTRACTIVE SUMMARY (THE MODEL DID NOT ANSWER)';
      const count = Number.isFinite(frame.compactionCount) && frame.compactionCount > 1 ? ` · COMPACTION ${frame.compactionCount}` : '';
      return `COMPACTED — ${folded} CARRIED FORWARD ${how}${count}.`;
    }
    case 'refused':
      if (frame.reason === 'too-short') {
        return `NOT ENOUGH TO COMPACT YET — ${frame.have ?? '?'} MESSAGES; COMPACTION STARTS AT ${frame.need ?? '?'} (THE LATEST 20 ALWAYS STAY WORD FOR WORD).`;
      }
      return REFUSALS[frame.reason] ?? 'THE CONVERSATION WAS NOT COMPACTED.';
    case 'failed': return 'COMPACTION FAILED — NOTHING WAS CHANGED. TRY AGAIN.';
    default: return null;
  }
};
