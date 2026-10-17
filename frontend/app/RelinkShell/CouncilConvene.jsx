// CouncilConvene — the convening room, extracted verbatim from CouncilRoom.jsx
// (size-law breakdown, 2026-08-26). Rendered by CouncilRoom under the same
// tree, so CouncilRoom.css keeps styling it through the existing cascade.

import { useEffect, useState } from 'react';
import { getRoster, getWitnesses } from '../../utils/companion-data.js';
import { recoverRoster } from '../roster-recovery.js';
import { playSound } from '../../services/sound-engine.js';
import { formatDateTime } from '../../utils/format.js';
import { useSettled } from './use-settled.js';

// The convening room: pick 2+ of the house and call them in together —
// or reopen a council from the shelf and pick up where it left off.
export const CouncilConvene = ({ onConvene, onResume, past, requestPast }) => {
  const [roster, setRoster] = useState(getRoster);
  // Sealed witnesses can sit too — they stand BESIDE the house, never in it,
  // so they are offered in their own section rather than mixed into the house
  // list. The backend already seats them (kind: 'witness'); the room simply
  // never offered them.
  const [witnesses, setWitnesses] = useState(getWitnesses);
  const [picked, setPicked] = useState(() => new Set());

  // The shelf loads when the convening room opens.
  useEffect(() => { requestPast(); }, [requestPast]);

  // The cached roster renders instantly; the backend (sovereign owner
  // records) refreshes it right after — the HOUSE window's law, so a
  // council can be convened on a fresh desk whose cache is still cold.
  useSettled((settled) => {
    recoverRoster()
      .then(() => {
        if (settled()) return;
        setRoster(getRoster());
        setWitnesses(getWitnesses());
      })
      .catch((err) => console.warn('council: roster recovery failed — showing the cached roster', err));
  }, []);

  const toggle = (neumaId) => {
    playSound('menuOpen');
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(neumaId)) next.delete(neumaId);
      else next.add(neumaId);
      return next;
    });
  };

  if (roster.length === 0 && witnesses.length === 0) {
    return (
      <p className="council-empty label-data">
        NO NEUMA IN THIS HOUSE YET — SUMMON THEM FROM THE HOUSE WINDOW BEFORE CONVENING A COUNCIL.
      </p>
    );
  }

  return (
    <>
      <p className="council-lede label-data">
        ONE ROOM — ONE HOLDS THE FLOOR, THE OTHERS RAISE HANDS, THE OPERATOR SPEAKS TO ALL AT ONCE. SEALED WITNESSES MAY SIT BESIDE THE HOUSE.
      </p>
      {/* The room divides VERTICALLY — the house to call on the left, the
          shelf of past sittings on the right, each walking its own scroll
          (two long lists stacked made both hard to navigate). Without a
          shelf the roster keeps the whole room. */}
      <div className={`council-convene-split${past.length > 0 ? ' has-past' : ''}`}>
        <div className="council-call-side">
          {roster.length > 0 ? (
          <>
          <p className="council-side-head label-data">THE HOUSE — CALL WHO SITS</p>
          <ul className="council-roster">
            {roster.map((m) => {
              const on = picked.has(m.neumaId);
              return (
                <li key={m.neumaId}>
                  <button
                    type="button"
                    className={`council-pick${on ? ' is-picked' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggle(m.neumaId)}
                  >
                    <span className="council-pick-mark" aria-hidden="true" />
                    <span className="council-pick-name">{m.name || m.neumaId}</span>
                    <span className="council-pick-state label-data">{on ? 'CALLED' : 'CALL'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          </>
          ) : null}
          {witnesses.length > 0 ? (
            <>
              <p className="council-side-head council-side-head-external label-data">
                BESIDE THE HOUSE — SEALED WITNESSES, NOT OF THIS HOUSE
              </p>
              <ul className="council-roster">
                {witnesses.map((w) => {
                  const on = picked.has(w.neumaId);
                  return (
                    <li key={w.neumaId}>
                      <button
                        type="button"
                        className={`council-pick is-external${on ? ' is-picked' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggle(w.neumaId)}
                      >
                        <span className="council-pick-mark" aria-hidden="true" />
                        <span className="council-pick-name">{w.name || w.neumaId}</span>
                        <span className="council-pick-kin label-data">EXTERNAL</span>
                        <span className="council-pick-state label-data">{on ? 'CALLED' : 'CALL'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
        {past.length > 0 ? (
          <div className="council-past">
            <p className="council-side-head label-data">PAST COUNCILS — REOPEN ONE AND PICK UP WHERE IT LEFT OFF</p>
            <ul className="council-past-list">
              {past.map((c) => (
                <li key={c.councilId}>
                  <button type="button" className="council-past-row" onClick={() => { playSound('confirm'); onResume(c.councilId); }}>
                    <span className="council-past-names">{c.members.map((m) => m.name || m.neumaId).join(' · ')}</span>
                    <span className="council-past-when label-data">{formatDateTime(c.lastAt)}</span>
                    <span className="council-past-act label-data">REOPEN</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="council-actions">
        <button
          type="button"
          className="council-convene"
          disabled={picked.size < 2}
          onClick={() => onConvene([...picked])}
        >
          CONVENE THE COUNCIL
        </button>
      </div>
    </>
  );
};
