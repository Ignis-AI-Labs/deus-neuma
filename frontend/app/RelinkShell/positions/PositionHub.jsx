// PositionHub — one position's hub: who holds it and the one seat control,
// what waits on the operator for it, then everything it handles as tabs
// (functions in place, its switches, and THEIR EYES — the holder's own
// top-of-turn reading). Pure rendering: the IO lives in PositionsApp.jsx, and
// a function's own screen arrives as `Panel` (position-panels.jsx).

import { useState } from 'react';
import { Select } from '../Select.jsx';
import { DeskTabs } from '../DeskTabs.jsx';
import { KIND_LABEL, waitedLabel } from '../waiting/waiting-view.js';
import { hubTabs, seatOptions, stepWords, helpAsk, capOk } from './positions-view.js';
import { SaleProcess } from './SaleProcess.jsx';
import { SalesPipeline } from '../company-line/SalesPipeline.jsx';

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

// A setting that spends (paid lead data): the same ON/OFF, and beside it the one boundary it has, the most
// credits a month, with what the month has used. Nothing else to choose.
const Limit = ({ c, busy, onLimit }) => {
  const [cap, setCap] = useState(String(c.cap));
  return (
    <div className="pos-switch-limit" data-switch-limit={c.id}>
      <span className="label-data">USED {c.spent} OF</span>
      <input className="pos-switch-cap" inputMode="numeric" aria-label={`${c.name}: the most credits a month`} disabled={busy} value={cap} onChange={(e) => setCap(e.target.value)} />
      <span className="label-data">CREDITS THIS MONTH</span>
      <button type="button" className="sec-scan label-data" disabled={busy || !capOk(cap) || Number(cap) === c.cap} aria-label={`SET LIMIT for ${c.name}`} onClick={() => onLimit(c, Number(cap))}>SET LIMIT</button>
    </div>
  );
};

// SETTINGS: everything this position may be switched on or off to use. On, it uses it; off, it does not.
const Switches = ({ position, busy, onSwitch, onLimit }) => (
  <ul className="pos-switches" aria-label="what this position may use">
    {position.connections.map((c) => (
      <li key={c.id} className="pos-switch" data-switch={c.id}>
        <span className="pos-switch-name">{c.name}</span>
        <button type="button" className={`sec-scan label-data${c.on ? ' is-on' : ''}`} aria-pressed={c.on} aria-label={`${c.on ? 'ON' : 'OFF'} — ${c.name}`} disabled={busy} onClick={() => onSwitch(c)}>
          {c.on ? 'ON' : 'OFF'}
        </button>
        {c.kind === 'spend' ? <Limit key={c.cap} c={c} busy={busy} onLimit={onLimit} /> : null}
        {c.note ? <p className="pos-covers" data-switch-note="">{c.note}</p> : null}
        {!c.on && c.whileOff ? <p className="pos-covers">While it is off: {c.whileOff}.</p> : null}
      </li>
    ))}
  </ul>
);

// What the seat still needs: each step with who does it, measured done or not, the exact words to follow,
// and a press that takes the operator there — a tab of this position, a place on the desk, a page outside —
// or hands it to the seat's holder with the ask drafted in their chat (never sent from here).
// A label that already numbers its step ("1 · …") is shown as written.
const numbered = (label) => /^\d+ · /.test(label);

const Setup = ({ position, busy, onGo, onDoor, onHand }) => {
  const holder = position.holder;
  return (
    <ol className="pos-setup" aria-label={`setting up the ${position.seat}`}>
      {position.setup.steps.map((s) => (
        <li key={s.id} className={`pos-step${s.done ? ' is-done' : ''}`} data-setup-step={s.id} data-step-done={String(s.done)}>
          <p className="pos-step-h label-data">{stepWords(s)}</p>
          {s.done ? null : (
            <>
              <p className="pos-covers">{s.how}</p>
              <div className="pos-step-ways">
                {/* What is fetched outside comes first, then the exact place it goes. */}
                {s.link ? <a className="sec-scan label-data pos-step-link" href={s.link.url} target="_blank" rel="noreferrer">{s.link.label} ↗</a> : null}
                {s.go ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`GO TO ${s.go.label} — ${s.label}`} onClick={() => onGo(s.go.tab)}>{numbered(s.go.label) ? s.go.label : `GO TO ${s.go.label}`}</button> : null}
                {s.door ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`OPEN ${s.door.label} — ${s.label}`} onClick={() => onDoor(s.door)}>{numbered(s.door.label) ? s.door.label : `OPEN ${s.door.label}`}</button> : null}
                {holder && s.who === 'seat' && s.ask
                  ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`HAND TO ${holder.name} — ${s.label}`} title={`${holder.name}'s chat opens with the ask drafted; you send it`} onClick={() => onHand(holder, s.ask)}>HAND TO {holder.name.toUpperCase()}</button> : null}
                {holder && s.who === 'operator'
                  ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`${s.askLabel ?? 'ASK'} ${holder.name}${s.askLabel ? '' : ' to walk you through'} — ${s.label}`} title={`${holder.name}'s chat opens with the question drafted; you send it`} onClick={() => onHand(holder, s.ask ?? helpAsk(s))}>{s.askLabel ?? 'ASK'} {holder.name.toUpperCase()}</button> : null}
              </div>
            </>
          )}
        </li>
      ))}
    </ol>
  );
};

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
  onTab, onPick, onSeat, onAskClear, onClear, onTalk, onOpenWaiting, onSwitch, onLimit = () => {}, onDoor = () => {}, onHand = () => {}, onChanged = () => {}, Panel = null, sale = null }) => {
  // What a tab of this hub draws: a function in place, the switches, what the holder reads, the setup.
  const drawn = (t) => {
    const fn = position.functions.find((f) => f.id === t) ?? null;
    return (
      <>
        {fn && Panel ? <Panel office={position.office} fn={fn} names={names} holder={position.holder} onHand={onHand} onChanged={onChanged} onDoor={onDoor} /> : null}
        {fn && !Panel ? <p className="pos-covers">{fn.what}</p> : null}
        {t === '_switches' ? <Switches position={position} busy={busy} onSwitch={onSwitch} onLimit={onLimit} /> : null}
        {t === '_eyes' ? <Eyes position={position} eyes={eyes} /> : null}
        {(t === '_setup' || t === 'setup') && position.setup ? <Setup position={position} busy={busy} onGo={onTab} onDoor={onDoor} onHand={onHand} /> : null}
      </>
    );
  };
  // The control's name carries the words it shows (a spoken command must match what is seen).
  const placeholder = position.holder ? 'hand it to another member' : 'choose who holds it';
  const shown = members.find((m) => m.laneId === pick)?.name ?? placeholder;
  return (
    <section className="pos-hub" aria-label={`${position.seat} position`} data-position={position.office}>
      <header className="pos-head">
        <h2 className="pos-name">{position.seat} <span className="pos-title label-data">{position.acronym} · {position.title}</span></h2>
        <p className={`pos-holder label-data${position.holder ? '' : ' is-empty'}`}>{position.holder ? `HELD BY ${position.holder.name.toUpperCase()}` : 'NOBODY HOLDS THIS POSITION'}</p>
        <p className="pos-covers"><span className="pos-function label-data">{position.plain}</span> {position.covers}</p>
        <div className="pos-seat">
          <Select fill ariaLabel={`${shown}, for the ${position.seat}`} value={pick} onChange={onPick} disabled={busy}
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
      {/* THE SALES POSITION'S HUB IS ITS PIPELINE (Design note, 2026-11-18: one straight line of stages, not tabs. */}
      {position.office === 'cro' ? <SalesPipeline position={position} tab={tab} onTab={onTab} renderOther={drawn} /> : (
        <>
          {sale ? <div className="pos-sale-wrap"><SaleProcess sale={sale} position={position} onDoor={onDoor} /></div> : null}
          <DeskTabs items={hubTabs(position)} value={tab} onChange={onTab} label={`${position.seat} functions`}
            className="pos-tabs" tabClassName="pos-tab label-data" panelClassName="pos-panel">
            {drawn(tab)}
          </DeskTabs>
        </>
      )}
    </section>
  );
};
