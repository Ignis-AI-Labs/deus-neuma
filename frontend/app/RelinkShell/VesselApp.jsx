// VesselApp — VESSEL, the stat sheets: the human vessel's vitals (ME) and
// each being's machine vessel (one lane per house neuma), with the rig's
// facts labeled SHARED — they belong to no one being. The lanes live in
// VesselMeLane.jsx / VesselNeumaLane.jsx over the shared atoms in
// vessel-format.jsx (size-law breakdown, 2026-08-26); this file is the
// window itself — the scope rail and which lane it seats.

import { useState } from 'react';
import './VesselApp.css';
import { useConsciousnessPick } from './consciousness-context.js';
import { AppTitle } from './app-title.jsx';
import { useSettled } from './use-settled.js';
import { recoverRoster } from '../roster-recovery.js';
import { getRoster } from '../../utils/companion-data.js';
import { uiSound } from '../../services/ui-sound.js';
import { orderedScopes } from './todo-view.js';
import { MeLane } from './VesselMeLane.jsx';
import { NeumaLane } from './VesselNeumaLane.jsx';

const VesselIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.5 8 H4.5 L6.2 4.5 L8.5 11.5 L10.3 8 H14.5" />
  </svg>
);

// --- The window -------------------------------------------------------------

const VesselBody = () => {
  const { activeCompanion } = useConsciousnessPick('activeCompanion');
  const [roster, setRoster] = useState(getRoster);
  // 'me' = the human vessel; otherwise a neumaId from the roster.
  const [scope, setScope] = useState('me');

  // The cached roster renders instantly; the backend refreshes it once per
  // open so a renamed or newly-summoned being appears without a reload.
  useSettled((settled) => {
    recoverRoster().then(() => { if (!settled()) setRoster(getRoster()); });
  }, []);

  const scopes = orderedScopes(roster, activeCompanion);
  // A being that left the house mid-session snaps the lane back to ME rather
  // than aiming at a scope the backend would (rightly) refuse.
  const scopeKnown = scope === 'me' || scopes.some((m) => m.neumaId === scope);
  const effectiveScope = scopeKnown ? scope : 'me';
  const isMe = effectiveScope === 'me';
  const scopeName = isMe ? null : (scopes.find((m) => m.neumaId === effectiveScope)?.name || effectiveScope).toUpperCase();

  const selectScope = (id) => {
    if (id === scope) return;
    uiSound('tick');
    setScope(id);
  };

  return (
    <div className="vl">
      <nav className="vl-scopes" aria-label="Vessel lane">
        <button
          type="button"
          className={`vl-scope${isMe ? ' is-on' : ''}`}
          aria-pressed={isMe}
          onClick={() => selectScope('me')}
        >ME</button>
        {scopes.map((m) => (
          <button
            key={m.neumaId}
            type="button"
            className={`vl-scope${effectiveScope === m.neumaId ? ' is-on' : ''}`}
            aria-pressed={effectiveScope === m.neumaId}
            onClick={() => selectScope(m.neumaId)}
          >{(m.name || m.neumaId).toUpperCase()}</button>
        ))}
      </nav>
      <p className="vl-scope-note label-data">
        {isMe
          ? 'THE HUMAN VESSEL — LOGGED BY YOU, OR BY YOUR NEUMA AT YOUR WORD'
          : `THE MACHINE VESSEL — WHAT ${scopeName} RUNS ON`}
      </p>
      {isMe ? <MeLane /> : <NeumaLane key={effectiveScope} neumaId={effectiveScope} />}
    </div>
  );
};

export const vesselApp = {
  label: 'VESSEL',
  labelKey: 'apps.vessel',
  icon: <VesselIcon />,
  title: <AppTitle label="VESSEL" labelKey="apps.vessel" />,
  Body: VesselBody,
  storageKey: 'vessel',
};
