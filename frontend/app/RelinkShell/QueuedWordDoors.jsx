// QueuedWordDoors — what a word the portal HOLDS shows on its bubble (ruling, 2026-08-16): the
// QUEUED tag, SEND NOW (promote past the wait), and on the NEWEST held bubble the Escape hint —
// Escape's first tap on an empty composer pulls that word home (StreamInput's ladder), so the
// bubble says so (owner, 2026-10-23: […]). EDIT stays
// the bubble's shared affordance.
import { uiSound } from '../../services/ui-sound.js';

/** The hold id Escape's first tap would pull: the newest queued word on screen. Pure. */
export const newestHoldId = (messages) => [...(messages || [])].reverse().find((m) => m.queued && m.holdId)?.holdId ?? null;

export const QueuedWordDoors = ({ holdId, onQueueNow, escTakesBack = false }) => (
  <span className="stream-queued label-data">
    <span className="stream-queued-tag">QUEUED</span>
    {onQueueNow ? (
      <button
        type="button"
        className="stream-queue-now"
        title="Stop waiting — this word interjects NOW"
        onClick={() => { uiSound('activate'); onQueueNow(holdId); }}
      >
        SEND NOW
      </button>
    ) : null}
    {escTakesBack ? (
      <span
        className="stream-queue-esc"
        title="With your message box empty, Esc takes this message out of the queue and back into the box, to change it or delete it"
      >
        ESC TAKES IT BACK
      </span>
    ) : null}
  </span>
);
