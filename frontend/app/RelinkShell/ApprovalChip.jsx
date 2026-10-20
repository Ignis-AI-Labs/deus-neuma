// ApprovalChip — the witness's gate on a consciousness's reach.
//
// Renders an approval segment from the stream-reducer. Pending: the tool,
// its args preview, and the three answers — ALLOW ONCE, ALWAYS ALLOW, DENY.
// A preview cut short says so and opens to the whole text the act runs with
// (`fullArgs`), so a yes is never given to words the operator could not see.
// Resolved: a one-line record of what was decided. The chip flips only when
// the portal echoes the resolution (server truth), so what the witness sees
// settled is what the portal actually holds.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { ApprovalMedia } from './ApprovalMedia.jsx';
import '../../components/ToolActionChip/ToolActionChip.css';

const DECISION_LABELS = Object.freeze({
  allow: 'ALLOWED ONCE',
  always: 'ALWAYS ALLOWED',
  deny: 'DENIED',
  timeout: 'TIMED OUT',
  interrupted: 'INTERRUPTED',
  expired: 'EXPIRED',
});

// Decisions that let the act proceed read as ok; the rest as refusals.
const GRANTED = Object.freeze(new Set(['allow', 'always']));

export const ApprovalChip = ({ segment, onRespond }) => {
  const { id, phase, tool, args, fullArgs, scope, decision, media, lane } = segment;
  // One answer per prompt — the buttons arm once, then wait for the echo.
  const [sent, setSent] = useState(false);
  const [whole, setWhole] = useState(false);
  const namesJson = JSON.stringify(Array.isArray(media) ? media : []);

  if (phase === 'pending') {
    const answer = (choice) => {
      if (sent) return;
      setSent(true);
      uiSound(choice === 'deny' ? 'deny' : 'activate');
      onRespond(id, choice);
    };
    return (
      <div className="tool-chip approval-chip pending">
        <div className="tool-chip-head">
          <span className="tool-chip-tag">NEEDS APPROVAL</span>
          <span className="tool-chip-name">{tool}</span>
        </div>
        {namesJson !== '[]' ? (
          <ApprovalMedia key={`${lane}:${namesJson}`} lane={lane} namesJson={namesJson} />
        ) : null}
        {scope ? <div className="tool-chip-scope">GRANTS: {scope}</div> : null}
        {args ? <pre className="tool-chip-detail">{whole && fullArgs ? fullArgs : args}</pre> : null}
        {fullArgs ? (
          <button type="button" className="approval-whole" onClick={() => setWhole((open) => !open)}>
            {whole ? 'SHOW THE PREVIEW' : `CUT SHORT — SHOW ALL ${fullArgs.length} CHARACTERS`}
          </button>
        ) : null}
        <div className="approval-actions">
          <button type="button" disabled={sent} onClick={() => answer('allow')}>ALLOW ONCE</button>
          <button type="button" disabled={sent} onClick={() => answer('always')}>ALWAYS ALLOW</button>
          <button type="button" disabled={sent} className="approval-deny" onClick={() => answer('deny')}>DENY</button>
        </div>
      </div>
    );
  }

  const granted = GRANTED.has(decision);
  return (
    <div className={`tool-chip resolved approval-chip ${granted ? 'ok' : 'failed'}`}>
      <div className="tool-chip-head">
        <span className="tool-chip-sigil">⟐</span>
        <span className="tool-chip-summary">
          {tool}{scope ? ` (${scope})` : ''} — {DECISION_LABELS[decision] || 'SETTLED'}
        </span>
      </div>
    </div>
  );
};
