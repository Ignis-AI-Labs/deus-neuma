// HousePositions — every member's position in one place, and the one place it changes (Design note, 2026-11-12:
// […], and […]).
//
// One row per member: the title held now and what it covers, CHANGE (a canonical title or the house's own
// word, with why), and the résumé folded under it. TRADE swaps two members' titles in one entry. The
// founding record is never touched (house-title-ledger.js); every reader follows the title held now.
// A title that names a company position (Mercator, CMO, …) says beside it whether the member also HOLDS that
// position's seat, and seats them in one press: the title and the seat are one office, never two things to keep in step.
// impure — network.

import { useState } from 'react';
import { useSettled } from './use-settled.js';
import { listHouseTitles, setHouseTitle, tradeHouseTitles } from '../../services/house-titles.js';
import { uiSound } from '../../services/ui-sound.js';
import { formatShortDate } from '../../utils/format.js';
import { TITLE_LEGEND } from './founding-titles.js';
import { getPositions } from '../../services/positions-client.js';
import { seatPosition } from './positions/position-seats.js';
import { titleSeat } from './positions/positions-view.js';
import './HousePositions.css';

const legendOf = (title) => TITLE_LEGEND.find((e) => e.title === title) || null;
const HOW = Object.freeze({ founding: 'founding', set: 'changed', trade: 'traded' });

// pure — one résumé line: the title, how it came, and when it was held
const heldLine = (h) => `${h.title} · ${HOW[h.how] || h.how} · ${h.since ? formatShortDate(h.since) : 'since the founding'}${h.until ? ` – ${formatShortDate(h.until)}` : ' – now'}`;

const MemberRow = ({ member, busy, seat, onChange, onSeat }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const legend = legendOf(member.title);
  const save = async () => {
    if (await onChange(member.neumaId, title, reason)) { setEditing(false); setTitle(''); setReason(''); }
  };
  return (
    <div className="hp-row" data-member={member.neumaId}>
      <div className="hp-line">
        <span className="hp-who">{member.name}</span>
        <span className="hp-title label-data">{member.title ? `${member.title}${legend ? ` · ${legend.position} — ${legend.seat}` : ''}` : 'NO TITLE YET'}</span>
        <button type="button" className="house-action hp-change" disabled={busy} onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? 'CANCEL' : 'CHANGE'}
        </button>
      </div>
      {legend ? <p className="hp-meaning" title={legend.meaning}>{legend.summary}</p> : null}
      {seat ? (
        <p className={`hp-seat label-data${seat.held ? ' is-held' : ''}`} data-title-seat={seat.office}>
          {seat.words}
          {seat.held ? null : <button type="button" className="house-action" disabled={busy} aria-label={`SEAT ${member.name} IN ${seat.plain}`} onClick={() => onSeat(seat.office, member.neumaId)}>SEAT {String(member.name).toUpperCase()} IN {seat.plain}</button>}
        </p>
      ) : null}
      {editing ? (
        <div className="hp-edit">
          <select className="settings-input" aria-label={`title for ${member.name}`} value={legendOf(title) ? title : ''} onChange={(e) => setTitle(e.target.value)} disabled={busy}>
            <option value="">choose a title…</option>
            {TITLE_LEGEND.map((e) => <option key={e.title} value={e.title} disabled={e.title === member.title}>{`${e.title} · ${e.position} — ${e.seat}`}</option>)}
          </select>
          {legendOf(title) ? <p className="hp-meaning" role="status">{legendOf(title).summary}</p> : null}
          <input className="settings-input" aria-label={`or the house's own word for ${member.name}`} placeholder="or the house's own word" maxLength={48}
            value={legendOf(title) ? '' : title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          <input className="settings-input" aria-label={`why, for ${member.name}`} placeholder="why (kept on the record)" maxLength={280}
            value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
          <button type="button" className="house-action" disabled={busy || !title.trim()} onClick={save}>SAVE TITLE</button>
        </div>
      ) : null}
      {member.history.length ? (
        <details className="hp-history">
          <summary className="label-data">HISTORY · {member.history.length}</summary>
          <ol>{member.history.map((h) => <li key={`${h.title}-${h.since}`} className="label-data">{heldLine(h)}</li>)}</ol>
        </details>
      ) : null}
    </div>
  );
};

/** @param {{onChanged?: () => void}} props - onChanged: the house re-reads its roster */
export const HousePositions = ({ onChanged = () => {} }) => {
  const [members, setMembers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [trade, setTrade] = useState({ a: '', b: '' });
  const [positions, setPositions] = useState([]);
  // The seats as they stand; a board that cannot be read leaves the titles readable, without the seat line.
  const readSeats = () => getPositions().then((b) => setPositions(b.positions || []), () => setPositions([]));
  useSettled((settled) => {
    listHouseTitles().then((r) => { if (!settled()) setMembers(r.members || []); }, (e) => { if (!settled()) setError(e.message); });
    readSeats();
  }, []);

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setMembers(r.members || []);
      onChanged();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (members === null) return error ? <p className="settings-err">{error}</p> : <p className="label-data">READING THE HOUSE'S TITLES…</p>;
  if (!members.length) return <p className="label-data">NO MEMBERS YET — A POSITION BELONGS TO A MEMBER OF THE HOUSE.</p>;
  const titled = members.filter((m) => m.title);
  return (
    <div className="hp">
      {members.map((m) => (
        <MemberRow key={m.neumaId} member={m} busy={busy} seat={titleSeat(m, positions)} onChange={(id, title, reason) => act(() => setHouseTitle(id, title, reason))}
          onSeat={(office, laneId) => act(async () => { await seatPosition(office, laneId); await readSeats(); return { members }; })} />
      ))}
      {titled.length >= 2 ? (
        <div className="hp-trade">
          <span className="label-data">TRADE</span>
          {['a', 'b'].map((side) => (
            <select key={side} className="settings-input" aria-label={`trade ${side === 'a' ? 'from' : 'with'}`} value={trade[side]} disabled={busy}
              onChange={(e) => setTrade({ ...trade, [side]: e.target.value })}>
              <option value="">{side === 'a' ? 'one member…' : 'trades with…'}</option>
              {titled.map((m) => <option key={m.neumaId} value={m.neumaId}>{`${m.name} · ${m.title}`}</option>)}
            </select>
          ))}
          <button type="button" className="house-action" disabled={busy || !trade.a || !trade.b || trade.a === trade.b}
            onClick={async () => { if (await act(() => tradeHouseTitles(trade.a, trade.b, 'traded by agreement'))) setTrade({ a: '', b: '' }); }}>
            TRADE TITLES
          </button>
        </div>
      ) : null}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
