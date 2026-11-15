// PositionHub — one position's hub: who holds it and the one seat control,
// what waits on the operator for it, then everything it handles as tabs
// (functions in place, its switches, and THEIR EYES — the holder's own
// top-of-turn reading). Pure rendering: the IO lives in PositionsApp.jsx, and
// a function's own screen arrives as `Panel` (position-panels.jsx).

import { Select } from '../Select.jsx';
import { DeskTabs } from '../DeskTabs.jsx';
import { KIND_LABEL, waitedLabel } from '../waiting/waiting-view.js';
import { hubTabs, seatOptions } from './positions-view.js';

const Waiting = ({ items, now, onOpen }) => (items.length ? (
  <section className="pos-wait" aria-label="waiting on you for this position">
    <p className="pos-h label-data">WAITING ON YOU · {items.length}</p>
    <ul className="pos-wait-list">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className="pos-wait-row" onClick={() => onOpen(item)}>
            <span className="pos-wait-kind label-data">{KIND_LABEL[item.kind] ?? String(item.kind).toUpperCase()}</span>
            <span className="pos-wait-title">{item.title}</span>
            <span className="pos-wait-age label-data">{waitedLabel(item.at, now)}</span>
          </button>
        </li>
      ))}
    </ul>
  </section>
) : null);

const Switches = ({ position, busy, onSwitch }) => (
  <ul className="pos-switches" aria-label="connections this position needs">
    {position.connections.map((c) => (
      <li key={c.id} className="pos-switch">
        <span className="pos-switch-name">{c.name}</span>
        <button type="button" className={`sec-scan label-data${c.on ? ' is-on' : ''}`} aria-pressed={c.on} disabled={busy} onClick={() => onSwitch(c)}>
          {c.on ? 'ON' : 'OFF'}
        </button>
        {!c.on && c.whileOff ? <p className="pos-covers">While it is off: {c.whileOff}.</p> : null}
      </li>
    ))}
  </ul>
);

const Eyes = ({ position, eyes }) => {
  if (!position.holder) return <p className="pos-covers">Nobody holds this position, so nobody is told anything. Seat a member above.</p>;
  if (!eyes) return <p className="pos-covers">Reading…</p>;
  return (
    <>
      <p className="pos-covers">This is what {position.holder.name} reads at the top of every turn, word for word.</p>
      <pre className="pos-eyes">{eyes.text || 'Nothing is told for this position yet.'}</pre>
    </>
  );
};

/**
 * @param {{position: object, members: object[], names: Record<string, string>, tab: string, now: number, busy: boolean,
 *   pick: string, confirmClear: boolean, eyes: ?object, onTab: Function, onPick: Function, onSeat: Function,
 *   onAskClear: Function, onClear: Function, onTalk: Function, onOpenWaiting: Function, onSwitch: Function,
 *   Panel?: Function}} props — Panel renders one function in place; without it the function's sentence stands
 */
export const PositionHub = ({ position, members, names, tab, now, busy, pick, confirmClear, eyes,
  onTab, onPick, onSeat, onAskClear, onClear, onTalk, onOpenWaiting, onSwitch, Panel = null }) => {
  const fn = position.functions.find((f) => f.id === tab) ?? null;
  // The control's name carries the words it shows (a spoken command must match what is seen).
  const placeholder = position.holder ? 'hand it to another member' : 'choose who holds it';
  const shown = members.find((m) => m.laneId === pick)?.name ?? placeholder;
  return (
    <section className="pos-hub" aria-label={`${position.plain} position`} data-position={position.office}>
      <header className="pos-head">
        <h2 className="pos-name">{position.plain} <span className="pos-title label-data">{position.title}</span></h2>
        <p className={`pos-holder label-data${position.holder ? '' : ' is-empty'}`}>{position.holder ? `HELD BY ${position.holder.name.toUpperCase()}` : 'NOBODY HOLDS THIS POSITION'}</p>
        <p className="pos-covers">{position.covers}</p>
        <div className="pos-seat">
          <Select fill ariaLabel={`${shown}, for ${position.plain}`} value={pick} onChange={onPick} disabled={busy}
            placeholder={placeholder} options={seatOptions(members, position)} />
          <button type="button" className="sec-scan label-data" disabled={busy || !pick} onClick={onSeat}>SEAT</button>
          {position.holder ? <button type="button" className="sec-scan label-data" disabled={busy} onClick={onTalk}>TALK</button> : null}
          {position.holder ? (
            <button type="button" className="sec-scan pos-danger label-data" disabled={busy} onClick={confirmClear ? onClear : onAskClear}>
              {confirmClear ? 'PRESS AGAIN TO UNSEAT' : 'UNSEAT'}
            </button>
          ) : null}
        </div>
      </header>
      <Waiting items={position.waiting} now={now} onOpen={onOpenWaiting} />
      <DeskTabs items={hubTabs(position)} value={tab} onChange={onTab} label={`${position.plain} functions`}
        className="pos-tabs" tabClassName="pos-tab label-data" panelClassName="pos-panel">
        {fn && Panel ? <Panel office={position.office} fn={fn} names={names} /> : null}
        {fn && !Panel ? <p className="pos-covers">{fn.what}</p> : null}
        {tab === '_switches' ? <Switches position={position} busy={busy} onSwitch={onSwitch} /> : null}
        {tab === '_eyes' ? <Eyes position={position} eyes={eyes} /> : null}
      </DeskTabs>
    </section>
  );
};
