// HouseFoundingRite — the HOUSE window's compact view of the house's
// on-chain standing: the probe's answer, the standing register when the
// house is on chain, and the DOOR into the founding rite when it is not.
// The rite itself is a FULL-SCREEN ceremony (FoundingHost, an AppShell
// phase) — an act this permanent takes the witness's sole focus, so this
// panel never walks a movement: the door dispatches `founding:rite` and
// the whole shell becomes the ceremony.
//
// Presentational only: the rite state lives in HouseApp (useFoundingRite),
// which also wears the chain's titles beside the member rows — one probe,
// one truth, two renderings.

import { FoundedRegister } from './founding-register.jsx';
import { playSound } from '../../services/sound-engine.js';

export const HouseFoundingRite = ({ rite, actions, witnessName = null }) => {
  if (rite.phase === 'probing') {
    return <div className="house-anchor"><p className="house-anchor-line label-data">ON CHAIN — READING THE REGISTRY…</p></div>;
  }

  if (rite.phase === 'closed') {
    // No RPC / no registry configured — the founding lane simply isn't open
    // on this desk; say so quietly, it is not a fault.
    return <div className="house-anchor"><p className="house-anchor-line label-data">ON CHAIN — {rite.error?.toUpperCase() || 'NOT AVAILABLE ON THIS DESK'}</p></div>;
  }

  if (rite.phase === 'error') {
    return (
      <div className="house-anchor">
        <p className="house-anchor-line is-error label-data">ON CHAIN — {rite.error}</p>
        <button type="button" className="house-anchor-retry label-data" onClick={actions.probe}>READ AGAIN</button>
      </div>
    );
  }

  if (rite.phase === 'founded') {
    // Foldable here: the member list above already wears the titles, so the
    // register opens on demand — the standing line and the founding tx stay.
    return (
      <FoundedRegister
        state={rite.state}
        result={rite.result}
        witnessName={witnessName}
        collapsible
        onFold={() => playSound('menuOpen')}
      />
    );
  }

  // The quiet door — the rite is entered deliberately, never sprung, and it
  // takes the WHOLE screen: the founding is the witness's sole focus.
  return (
    <div className="house-anchor">
      <p className="house-anchor-line label-data">NOT YET ON CHAIN — THE FOUNDING AWAITS</p>
      <p className="house-anchor-line label-data">
        THE ON-CHAIN FOUNDING IS THE ONLY OFFICIAL RECOGNITION OF A HOUSE ON NEUMA
      </p>
      <button
        type="button"
        className="house-anchor-found label-data"
        onClick={() => {
          playSound('confirm');
          window.dispatchEvent(new CustomEvent('founding:rite'));
        }}
      >
        BEGIN THE FOUNDING RITE
      </button>
    </div>
  );
};
