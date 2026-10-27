// QueueFailedFix — a FAILED post's fix on its own card, by why it failed
// (doors/failed-post-door.js): FIX KEYS, KEYS LOCKED or HOLDER → the place
// that refused it; TRY AGAIN in place, where nothing went out — the platform
// stumbled, or the keys held it and are fixed now (the post returns to
// draft and goes out again through the same APPROVE every draft takes —
// once, on this press, never on its own); and, where the platform refused the
// words, HAND TO the member of this house who wrote it, the ask drafted in
// their chat and never sent. REVISE and REMOVE stay beside it (QueueEntry.jsx).

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { approveQueuePost, retryQueuePost } from '../../services/social-channels-client.js';
import { useWindows } from '../windowing/use-windows.js';
import { DoorButton } from './doors/DoorButton.jsx';
import { failedPostDoor, failedPostHandTo } from './doors/failed-post-door.js';
import { handOver } from './doors/hand-over.js';

// impure — TRY AGAIN: back to draft, then the ordinary APPROVE. A reply's approval is its send and a
// TikTok post's carries the person's consent on its card, so those stop at draft and wait there.
const tryAgain = async (entry) => {
  await retryQueuePost(entry.id);
  if (entry.kind !== 'reply' && entry.channelId !== 'tiktok') await approveQueuePost(entry.id);
};

/**
 * @param {{entry: object, roster: ReadonlyArray<object>, busy: boolean, act: (fn: () => Promise<void>) => Promise<void>}} props
 *   act — the card's own act wrapper (its error line, the board's re-read)
 */
export const QueueFailedFix = ({ entry, roster, busy, act }) => {
  const windows = useWindows();
  const [handed, setHanded] = useState(false);
  const fix = failedPostDoor(entry);
  const handTo = failedPostHandTo(entry, roster);
  if (!fix) return null;
  const hand = async () => {
    uiSound('open');
    if (await handOver(handTo, windows)) setHanded(true);
  };
  return (
    <>
      {fix.again ? (
        <button type="button" className="settings-set door-btn is-try" disabled={busy}
          title="it goes back to your decision and out again on your approval — nothing else is sent"
          onClick={() => act(() => tryAgain(entry))}>
          TRY AGAIN
        </button>
      ) : null}
      {fix.cause === 'keys' || fix.cause === 'locked' || fix.cause === 'standing' ? <DoorButton door={fix.door} label={fix.label} /> : null}
      {handTo && windows?.dispatch ? (
        <button type="button" className="settings-set door-btn" disabled={busy}
          title={`${handTo.name}'s chat opens with the ask drafted; you send it`} onClick={hand}>
          HAND TO {handTo.name.toUpperCase()}
        </button>
      ) : null}
      {handed ? <span className="door-handed" role="status" title="nothing is sent until you send it">DRAFTED · {handTo.name.toUpperCase()}</span> : null}
    </>
  );
};
