// PositionsBoard — the POSITIONS window's working core: the one read of every
// position, the chosen position and tab (kept across sittings), the seat moves
// and the switches. It reads no desk context: the window (PositionsApp.jsx)
// hands in the waiting account, the door to a holder's stream and the function
// panels, so this stands on a bare page against the real routes.
// impure — network, localStorage.

import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../empty-state.jsx';
import { uiSound } from '../../../services/ui-sound.js';
import { getPositions, getPositionEyes } from '../../../services/positions-client.js';
import { setConnection } from '../../../services/connections-client.js';
import { requestWaitingJump } from '../waiting/waiting-jump.js';
import { seatPosition, clearPosition } from './position-seats.js';
import { railRow, railSummary, pickPosition, pickTab } from './positions-view.js';
import { PositionHub } from './PositionHub.jsx';
import { SeatingStrip } from './SeatingStrip.jsx';
import { onPositionPlace, POSITION_PLACE_KEY } from '../../windowing/position-tiles.js';
import '../SecurityApp.css';
import './Positions.css';

const PLACE_KEY = POSITION_PLACE_KEY;
const readPlace = () => { try { return JSON.parse(localStorage.getItem(PLACE_KEY)) ?? {}; } catch { return {}; } };

const Rail = ({ positions, chosen, onChoose }) => (
  <nav className="pos-rail" aria-label="house positions">
    <p className="pos-h label-data">{railSummary(positions)}</p>
    {positions.map(railRow).map((row) => (
      <button key={row.office} type="button" className={`pos-row${row.office === chosen ? ' is-on' : ''}${row.holder ? '' : ' is-empty'}`}
        aria-current={row.office === chosen || undefined} onClick={() => onChoose(row.office)}>
        <span className="pos-light" aria-hidden="true" />
        <span className="pos-row-name">{row.plain}</span>
        <span className="pos-row-who label-data">{row.title} · {row.holder ?? 'NOBODY'}</span>
        {row.setupOpen ? <span className="pos-row-setup label-data" aria-label={`setup ${row.setup}`}>SETUP {row.setup}</span> : null}
        {row.waiting ? <span className="pos-row-n label-data" aria-label={`${row.waiting} waiting on you`}>{row.waiting}</span> : null}
      </button>
    ))}
  </nav>
);

/**
 * @param {{waitingCount?: number, refreshWaiting?: () => Promise<void>, onTalk?: (laneId: string) => void,
 *   onDoor?: (door: object) => void, onHand?: (member: {laneId: string, name: string}, prompt: string) => void,
 *   Panel?: Function, onCouncil?: ?Function}} props — the desk hands in its waiting account, the door to a
 *   holder's stream, the function panels and the door to a seating council; without them the board still
 *   reads and seats.
 */
export const PositionsBoard = ({ waitingCount = 0, refreshWaiting = null, onTalk = () => {}, onDoor = () => {}, onHand = () => {}, Panel = null, onCouncil = null }) => {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState(readPlace);
  const [pick, setPick] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [eyes, setEyes] = useState(null);

  const load = useCallback(() => getPositions().then((b) => { setBoard(b); setError(null); }, (e) => setError(e.message)), []);
  // The board follows the desk's waiting account: a decision answered anywhere leaves this window too.
  useEffect(() => { load(); }, [load, waitingCount]);

  // A launcher tile names a position while this window is open: stand on it.
  useEffect(() => onPositionPlace((office) => setPlace((p) => ({ ...p, office }))), []);

  const position = board ? pickPosition(board.positions, place.office) : null;
  const tab = position ? pickTab(position, place.tabs?.[position.office]) : null;
  const holderId = position?.holder?.laneId ?? null;

  useEffect(() => {
    if (tab !== '_eyes' || !holderId) return undefined;
    let live = true;
    setEyes(null);
    getPositionEyes(position.office).then((r) => { if (live) setEyes(r.eyes ?? { text: '' }); }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [tab, holderId, position?.office]);

  const go = (next) => {
    uiSound('open');
    localStorage.setItem(PLACE_KEY, JSON.stringify(next));
    setPlace(next);
    setPick('');
    setConfirmClear(false);
  };

  // One move on the server, then the board and the desk's account read again.
  const move = async (fn) => {
    uiSound('activate');
    setBusy(true);
    try {
      await fn();
      setPick('');
      setConfirmClear(false);
      setError(null);
      await Promise.all([load(), refreshWaiting?.()]);
    } catch (e) {
      setError(e.message); // surfaced, never swallowed
    } finally {
      setBusy(false);
    }
  };

  if (!board) return error ? <EmptyState title="POSITIONS UNREACHABLE" tone="error"><small>{error}</small></EmptyState> : <EmptyState title="READING THE HOUSE…" />;
  if (!position) return <EmptyState title="NO POSITIONS" />;
  const names = Object.fromEntries(board.members.map((m) => [m.laneId, m.name]));
  return (
    <div className="pos sec">
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      <SeatingStrip positions={board.positions} members={board.members} seating={board.seating ?? null} onCouncil={onCouncil}
        onChanged={() => Promise.all([load(), refreshWaiting?.()])} />
      <div className="pos-split">
        <Rail positions={board.positions} chosen={position.office} onChoose={(office) => go({ ...place, office })} />
        <PositionHub
          position={position} members={board.members} names={names} tab={tab} now={Date.now()} busy={busy}
          pick={pick} confirmClear={confirmClear} eyes={eyes} Panel={Panel}
          onTab={(next) => go({ ...place, office: position.office, tabs: { ...(place.tabs ?? {}), [position.office]: next } })}
          onPick={(v) => { uiSound('open'); setPick(v); }}
          onSeat={() => move(() => seatPosition(position.office, pick))}
          onAskClear={() => { uiSound('open'); setConfirmClear(true); }}
          onClear={() => move(() => clearPosition(position.office))}
          onTalk={() => { uiSound('open'); onTalk(holderId); }}
          onOpenWaiting={(item) => { uiSound('open'); requestWaitingJump(item); }}
          onSwitch={(c) => move(() => setConnection(c.id, !c.on))}
          onDoor={(door) => { uiSound('open'); onDoor(door); }}
          onHand={(member, prompt) => { uiSound('open'); onHand(member, prompt); }}
        />
      </div>
    </div>
  );
};

