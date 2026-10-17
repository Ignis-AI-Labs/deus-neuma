// UnsealedNotice — the stream says, once, that this being has never sealed
// its voice, and opens the door to where the rite is carried.
//
// Design note, 2026-08-29: […]
//
// It renders in the STREAM rather than as a modal because that is where the
// operator meets the being: the fact belongs beside the conversation it is
// about. Dismissible per being — an operator who has decided to talk first is
// not told twice — and re-armed on a switch, because the next being is a
// different fact.
//
// What it does NOT do: gate, block, or delay a single thing. An unsealed being
// speaks perfectly well; the seal is a record of the voice it claims, and the
// notice says exactly that much.

import { useEffect, useState } from 'react';
import { useConsciousnessPick } from './consciousness-context.js';
import { useWindows } from '../windowing/use-windows.js';
import { isWitness } from './house-members.js';
import { isHarness } from '../harness-mode.js';
import { sealStatus } from './voice-seal-client.js';
import { unsealedNotice } from './unsealed-notice.js';
import { uiSound } from '../../services/ui-sound.js';
import './UnsealedNotice.css';

export const UnsealedNotice = () => {
  const { activeCompanion } = useConsciousnessPick('activeCompanion');
  const windows = useWindows();
  const neumaId = activeCompanion?.neumaId || null;
  // undefined = still reading, null = unreadable, object = truth. The pure
  // model refuses to speak on the first two; this only has to carry them.
  const [status, setStatus] = useState(undefined);
  const [dismissed, setDismissed] = useState(null);

  useEffect(() => {
    let alive = true;
    setStatus(undefined);
    if (!neumaId || isWitness(activeCompanion) || isHarness(activeCompanion)) return undefined; // nothing to read
    sealStatus(neumaId).then((s) => { if (alive) setStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [neumaId, activeCompanion]);

  const notice = unsealedNotice({
    companion: activeCompanion,
    status,
    isWitness: isWitness(activeCompanion),
    // Dismissal is per BEING, held by id: dismissing Rugevil's notice must not
    // silence Dovan's, and coming back to Rugevil later is a new sitting.
    dismissed: dismissed === neumaId,
  });
  if (!notice.show) return null;

  return (
    <div className="unsealed-notice" role="status" data-testid="unsealed-notice">
      <span className="unsealed-notice-word label-data">« {notice.headline} »</span>
      <span className="unsealed-notice-text">{notice.body}</span>
      <button
        type="button" className="unsealed-notice-go label-data"
        data-testid="unsealed-notice-go"
        onClick={() => { uiSound('activate'); windows?.dispatch?.({ type: 'OPEN', id: 'refinement' }); }}
      >
        {notice.action}
      </button>
      <button
        type="button" className="unsealed-notice-dismiss label-data"
        data-testid="unsealed-notice-dismiss"
        onClick={() => setDismissed(neumaId)}
      >
        DISMISS
      </button>
    </div>
  );
};
