import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { mindModeExplanation } from './inner-life-copy.js';

// THE SITTINGS LAW — printed at the LIVE confirm, verbatim from the
// validation protocol: shadow → compare → experiential sittings → the flip.
const LIVE_LAW = 'LIVE changes conversation prompts for EVERY being on this machine. Review the measurements and complete experiential sittings — sessions with the beings to assess the effect — before enabling it.';

const GATE_MODES = Object.freeze({
  undercurrent: ['off', 'shadow', 'live'],
  depthFilter: ['off', 'shadow'],
  memoryLinks: ['off', 'live'],
});

// One gate as a chip row. LIVE takes the confirm step; everything else flips
// directly (and is believed only on server echo).
export const InnerLifeGateRow = ({ label, gate, posture, busy, onSet, testid }) => {
  const [confirming, setConfirming] = useState(false);
  const modes = GATE_MODES[gate] || ['off', 'shadow'];
  return (
    <div className="il-gate" data-testid={testid}>
      <span className="il-gate-l label-data">{label}</span>
      <div className="il-gate-modes">
        {modes.map((m) => (
          <button
            key={m} type="button"
            className={`rec-btn rec-chip${posture.mode === m ? ' rec-chip-on' : ''}`}
            data-testid={`${testid}-${m}`}
            disabled={busy || posture.envLocked || posture.mode === m}
            onClick={() => {
              uiSound('open');
              if (m === 'live') { setConfirming(true); return; }
              setConfirming(false);
              onSet(gate, m);
            }}
          >{m.toUpperCase()}</button>
        ))}
      </div>
      <p className="rec-note il-mode-explanation">{mindModeExplanation(gate, posture.mode)}</p>
      {posture.envLocked ? (
        <span className="rec-meta label-data">locked by the app’s launch settings; this control cannot change it</span>
      ) : null}
      {confirming ? (
        <div className="rec-confirm cham">
          <p className="rec-confirm-msg">«NOTICE» {LIVE_LAW}</p>
          <div className="rec-confirm-actions">
            <button type="button" className="rec-btn rec-btn-go" onClick={() => { uiSound('activate'); setConfirming(false); onSet(gate, 'live'); }}>FLIP LIVE</button>
            <button type="button" className="rec-btn" onClick={() => { uiSound('close'); setConfirming(false); }}>CANCEL</button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

