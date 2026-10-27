// HoldToGrant — the red button (ruling, 2026-10-24: […]). A press does nothing; only a HOLD of HOLD_MS grants — the desk's
// deliberate-gestures rule: an act this consequential arms only while held.
// Let go early, move off it, or lose focus, and nothing happens. Space or
// Enter held does the same for the keyboard.
//
// No flash, no pulse (frontend/utils/no-flash.js): while held, an alert-tint
// fill rises across the button over the whole hold, then is gone.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { HOLD_MS, holdComplete } from './mandate-grant-view.js';

const HOLD_KEYS = new Set([' ', 'Enter']);

/** @param {{armed: boolean, busy: boolean, onGrant: () => void}} props */
export const HoldToGrant = ({ armed, busy, onGrant }) => {
  const [holding, setHolding] = useState(false);
  const downAt = useRef(null);
  const timer = useRef(null);
  const live = armed && !busy;

  const stop = () => {
    clearTimeout(timer.current);
    timer.current = null;
    downAt.current = null;
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (!live) stop(); }, [live]);

  const start = () => {
    if (!live || downAt.current !== null) return;
    downAt.current = Date.now();
    setHolding(true);
    uiSound('toggle');
    timer.current = setTimeout(() => {
      const held = holdComplete(downAt.current, Date.now());
      stop();
      if (held) onGrant();
    }, HOLD_MS);
  };

  return (
    <button
      type="button"
      className="mandate-hold"
      data-holding={holding ? 'true' : 'false'}
      disabled={!live}
      aria-label={live ? `Hold for ${HOLD_MS / 1000} seconds to grant the mandate` : 'Grant the mandate — not armed until every check passes'}
      onPointerDown={(e) => { if (e.button === 0) start(); }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onBlur={stop}
      onKeyDown={(e) => { if (HOLD_KEYS.has(e.key) && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (HOLD_KEYS.has(e.key)) stop(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="mandate-hold-fill" aria-hidden="true" />
      <span className="mandate-hold-words">
        {busy ? 'GRANTING…' : !armed ? 'NOT ARMED — EVERY CHECK MUST PASS' : holding ? 'KEEP HOLDING…' : `HOLD ${HOLD_MS / 1000} S TO GRANT`}
      </span>
    </button>
  );
};
