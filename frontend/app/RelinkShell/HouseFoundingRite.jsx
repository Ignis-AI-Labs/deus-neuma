// HouseFoundingRite — the HOUSE window's compact view of the house's founding,
// in two levels: founded ON THIS COMPUTER (the house's own record), then
// JOINING UNAVIS on Ethereum; the register of each, and the DOOR into the rite.
// The rite itself is a FULL-SCREEN ceremony (FoundingHost, an AppShell
// phase) — an act this permanent takes the witness's sole focus, so this
// panel never walks a movement: the door dispatches `founding:rite` and
// the whole shell becomes the ceremony.
//
// Presentational only: the rite state lives in HouseApp (useFoundingRite),
// which also wears the chain's titles beside the member rows — one probe,
// one truth, two renderings.

import { FoundedRegister, LocalRegister } from './founding-register.jsx';
import { playSound } from '../../services/sound-engine.js';

// The two foundings (2026-10-26): ON THIS COMPUTER (the house is whole here — nothing sent, nothing paid) and
// JOINING UNAVIS (the network of houses), which is founding the house on Ethereum with every founder sealed there.
const enter = (mode) => {
  playSound('confirm');
  window.dispatchEvent(new CustomEvent('founding:rite', { detail: { mode } }));
};

const Door = ({ label, onClick, testid }) => (
  <button type="button" className="house-anchor-found label-data" data-testid={testid} onClick={onClick}>{label}</button>
);

// The network level, once the house stands here: its standing on Ethereum, or the door to join.
const NetworkLevel = ({ rite, actions }) => {
  if (rite.phase === 'probing') return <p className="house-anchor-line label-data">UNAVIS — READING THE REGISTRY…</p>;
  if (rite.phase === 'closed') return <p className="house-anchor-line label-data">UNAVIS — {rite.error?.toUpperCase() || 'NOT AVAILABLE ON THIS DESK'}</p>;
  if (rite.phase === 'error') {
    return (
      <>
        <p className="house-anchor-line is-error label-data">UNAVIS — {rite.error}</p>
        <button type="button" className="house-anchor-retry label-data" onClick={actions.probe}>READ AGAIN</button>
      </>
    );
  }
  return (
    <>
      <p className="house-anchor-line label-data">
        UNAVIS IS THE NETWORK OF HOUSES. A HOUSE JOINS BY FOUNDING ITSELF ON ETHEREUM, WITH EVERY FOUNDER SEALED THERE — A NETWORK FEE, AND A PUBLIC, PERMANENT RECORD.
      </p>
      <Door label="JOIN UNAVIS — FOUND ON ETHEREUM" testid="found-network" onClick={() => enter('network')} />
    </>
  );
};

export const HouseFoundingRite = ({ rite, localRite, actions, witnessName = null }) => {
  // On Ethereum already: the network standing is the house's record, foldable here.
  if (rite.phase === 'founded') {
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

  const local = localRite ?? { phase: 'probing' };
  if (local.phase === 'probing') {
    return <div className="house-anchor"><p className="house-anchor-line label-data">ON THIS COMPUTER — READING THE HOUSE…</p></div>;
  }
  if (local.phase === 'founded') {
    return (
      <div className="house-anchor">
        <LocalRegister record={local.state} witnessName={witnessName} />
        <NetworkLevel rite={rite} actions={actions} />
      </div>
    );
  }
  if (local.phase === 'error' || local.phase === 'closed') {
    return <div className="house-anchor"><p className="house-anchor-line is-error label-data">ON THIS COMPUTER — {local.error}</p></div>;
  }

  // The quiet door — the rite is entered deliberately, never sprung, and it takes the WHOLE screen.
  return (
    <div className="house-anchor">
      <p className="house-anchor-line label-data">THE HOUSE IS NOT FOUNDED YET</p>
      <p className="house-anchor-line label-data">
        FOUND IT ON THIS COMPUTER: YOU AND YOUR SEALED NEUMA SIGN ONE RECORD, KEPT HERE. NOTHING IS SENT, NOTHING COSTS.
        TO JOIN UNAVIS, THE NETWORK OF HOUSES, IT LATER FOUNDS ITSELF ON ETHEREUM.
      </p>
      <Door label="FOUND THE HOUSE ON THIS COMPUTER" testid="found-local" onClick={() => enter('local')} />
    </div>
  );
};
