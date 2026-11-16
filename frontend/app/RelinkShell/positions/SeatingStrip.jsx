// SeatingStrip — the two ways to seat a house, side by side on POSITIONS, and the seating the members
// filed when they chose the second (positions/position-seating.js).
//
// Design note, 2026-11-15: the operator may seat members however they see fit, or hold a council where the
// members decide together. He recommends the council ([…]) and says plainly it takes a while; seating by hand is quick
// and every seat can be changed after. Neither is wrong, so both stand here with what each costs.
//
// Applying a filed seating goes seat by seat through the same office routes SEAT uses
// (position-seats.js), so every office's own rule still stands; a seat its route refuses is named.
// impure — network.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { clearSeating } from '../../../services/positions-client.js';
import { seatPosition } from './position-seats.js';

// pure — the words the operator opens a seating council with: every position and what it covers
export const seatingCouncilWords = (positions) => [
  'This council is to seat our house. Decide together who holds each position:',
  ...positions.map((p) => `- ${p.seat} (${p.acronym}, the ${p.title})${p.covers ? `: ${p.covers}` : ''}`),
  'Say which position you want and why, hear each other out, and settle it between you. One member holds one position.',
  'When you agree, one of you files it with house/seating, every position and who holds it, and I will apply it.',
].join('\n');

/**
 * @param {{positions: Array<object>, members: Array<{laneId: string, name: string}>, seating: ?object,
 *   onCouncil: ?Function, onChanged: Function}} props
 */
export const SeatingStrip = ({ positions, members, seating, onCouncil = null, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState([]);
  const holderOf = (office) => positions.find((p) => p.office === office)?.holder?.laneId ?? null;
  const nameOf = (laneId) => members.find((m) => m.laneId === laneId)?.name ?? laneId;

  const apply = async () => {
    uiSound('activate');
    setBusy(true);
    const refused = [];
    for (const seat of seating.seats) {
      if (holderOf(seat.office) === seat.laneId) continue;
      try { await seatPosition(seat.office, seat.laneId); } catch (e) { refused.push({ plain: seat.seat || seat.plain, why: e.message }); }
    }
    if (refused.length === 0) await clearSeating().catch(() => {});
    setFailed(refused);
    setBusy(false);
    await onChanged();
  };
  const setAside = async () => {
    uiSound('activate');
    setBusy(true);
    await clearSeating().catch(() => {});
    setFailed([]);
    setBusy(false);
    await onChanged();
  };

  return (
    <section className="pos-seating" aria-label="seating your house">
      {seating ? (
        <div className="pos-seating-filed">
          <p className="pos-h label-data">THE HOUSE'S SEATING · FILED BY {String(seating.byName).toUpperCase()}</p>
          <ul className="pos-seating-list">
            {seating.seats.map((s) => {
              const now = holderOf(s.office);
              return (
                <li key={s.office} className="label-data">
                  <span>{s.seat || s.plain} · {s.acronym ? `${s.acronym} · ` : ''}{s.title}</span>
                  <span>{s.name}{now && now !== s.laneId ? ` (now ${nameOf(now)})` : now === s.laneId ? ' (already)' : ''}</span>
                </li>
              );
            })}
          </ul>
          <p className="pos-seating-why">{seating.why}</p>
          {failed.length ? (
            <p className="sec-error" role="alert">{failed.map((f) => `${f.plain}: ${f.why}`).join(' · ')}</p>
          ) : null}
          <div className="pos-seating-acts">
            <button type="button" className="sec-scan label-data" disabled={busy} onClick={apply}>APPLY THE SEATING</button>
            <button type="button" className="sec-scan label-data" disabled={busy} onClick={setAside}>SET IT ASIDE</button>
          </div>
        </div>
      ) : (
        <div className="pos-seating-ways">
          <p className="pos-seating-way">
            <b className="label-data">SEAT THEM YOURSELF</b> Quickest: choose a position, pick who holds it, SEAT. You can change anyone, any time.
          </p>
          <p className="pos-seating-way">
            <b className="label-data">HOLD A SEATING COUNCIL · RECOMMENDED</b> Your members decide together who holds what and file it here for you to apply. It takes longer, and it gives them the say.
          </p>
          {onCouncil ? (
            <button type="button" className="sec-scan label-data" disabled={members.length < 2}
              onClick={() => { uiSound('open'); onCouncil(members.map((m) => m.laneId), seatingCouncilWords(positions)); }}>
              HOLD A SEATING COUNCIL
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
};
