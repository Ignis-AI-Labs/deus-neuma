// TrayWaiting — WAITING ON YOU inside the notification tray (Design note, 2026-10-24:
// […])
//
//   • WaitingMark — on the bell: a still signal diamond and the TRUE count of
//     decisions owed, its own mark beside the unread count, never a pulse
//     (no-flash law). It stays until the last one is decided.
//   • WaitingSection — the FIRST thing the opened tray shows, above ordinary
//     notifications: the overview line (how many, the oldest wait), then one
//     row per decision, oldest first — what, who asks, how long — each a door
//     to its card (waiting-jump.js); then the MANDATE row while one stands.
//   • WaitingToast — an arrival's cue in the tray's toast lane, the same rise
//     a new notification gets; pressing it jumps to the card.
//
//   • MandateMark — beside the bell while the CMO's MANDATE is ACTIVE,
//     obvious at a glance (ruling, 2026-10-24): `MANDATE · 5D` in the alert
//     colour — the days until it turns itself off, a door to MARKETING's
//     SEAT — and WITHDRAW one press beside it. Still: no animation. A paused one waits as a row instead.
//
// SHINKEI: the count on the bell is the count of rows the section lists; an
// account that cannot be read shows —, never a drawn zero.

import { useState } from 'react';
import { KIND_LABEL, waitedLabel, whoLabel } from '../waiting/waiting-view.js';
import { MandateChip } from '../mandate/MandateChip.jsx';
import { useMandate } from '../mandate/use-mandate.js';
import { chipLine } from '../mandate/mandate-view.js';
import { uiSound } from '../../../services/ui-sound.js';
import { withdrawMandate } from '../../../services/mandate-client.js';
import { useWaitingAccount } from '../waiting/use-waiting.js';
import { requestWaitingJump } from '../waiting/waiting-jump.js';
import { DoorButton } from '../doors/DoorButton.jsx';
import '../waiting/Waiting.css';
import './TrayWaiting.css';

/**
 * The bell's own mark: ◆ and the count; — when the account cannot be read.
 * @param {{line: {count: number, oldest: ?string}, unreadable: boolean}} props
 */
export const WaitingMark = ({ line, unreadable }) => {
  if (line.count) {
    return (
      <span className="ntray-wait" data-count={line.count}>
        <span className="waiting-chip-mark" aria-hidden="true" />
        <b className="ntray-wait-n">{line.count > 99 ? '99+' : line.count}</b>
      </span>
    );
  }
  if (!unreadable) return null;
  return (
    <span className="ntray-wait is-unread">
      <span className="waiting-chip-mark" aria-hidden="true" />
      <b className="ntray-wait-n">—</b>
    </span>
  );
};

/**
 * The ACTIVE mandate beside the bell — its days left and WITHDRAW — or nothing.
 * Ending capacity is the safe direction, so WITHDRAW asks no confirm.
 * @param {{mandate: ?{label: string, words: string}}} props - mandate-view.js bellMandate's answer
 */
export const MandateMark = ({ mandate }) => {
  const refresh = useWaitingAccount()?.refresh;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!mandate) return null;
  const withdraw = async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try { await withdrawMandate('withdrawn from the tray'); await refresh?.(); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <span className="ntray-mandate-mark" data-mandate="on" title={mandate.words} role="status" aria-label={mandate.words}>
      <span className="ntray-mandate-sq" aria-hidden="true" />
      <button type="button" className="ntray-mandate-k" onClick={() => { uiSound('open'); requestWaitingJump({ where: { app: 'marketing' } }); }}>{mandate.label}</button>
      <button type="button" className="mandate-withdraw" disabled={busy} onClick={withdraw}>{busy ? 'WITHDRAWING…' : 'WITHDRAW'}</button>
      {error ? <span className="mandate-chip-err" role="alert">{error}</span> : null}
    </span>
  );
};

/**
 * One decision: what, who asks, how long — a door to its card. A row that is
 * ABOUT something else (a paused mandate, a hold) also carries SEE IT: a door
 * to what tripped it or what it holds (mandate-sources.js).
 */
const Row = ({ item, now, onJump }) => (
  <li className={item.door ? 'has-door' : undefined}>
    <button type="button" className="waiting-row" onClick={() => onJump(item)}>
      <span className="waiting-row-kind">{KIND_LABEL[item.kind] || 'DECISION'}</span>
      <span className="waiting-row-title">{item.title}</span>
      <span className="waiting-row-meta">{whoLabel(item)} · {waitedLabel(item.at, now)}</span>
    </button>
    {item.door ? <DoorButton door={item.door} label="SEE IT" /> : null}
  </li>
);

/** The CMO's MANDATE while one stands: its state, WITHDRAW one press. */
const MandateRow = () => {
  const { view } = useMandate();
  if (!chipLine(view?.standing)) return null;
  return (
    <div className="ntray-mandate">
      <span className="ntray-sec-h">MANDATE</span>
      <MandateChip />
    </div>
  );
};

/**
 * @param {{account: ?object, line: {count: number, oldest: ?string}, error: ?string,
 *   now: number, onJump: (item: object) => void}} props
 */
export const WaitingSection = ({ account, line, error, now, onJump }) => (
  <section className={`ntray-wait-sec${line.count ? ' is-owed' : ''}`} aria-label="decisions waiting on you">
    {line.count ? (
      <>
        <p className="ntray-wait-h">
          <span className="waiting-chip-mark" aria-hidden="true" />
          <b>{line.count}</b> WAITING ON YOU
          {line.oldest ? <span className="ntray-wait-old">OLDEST {line.oldest}</span> : null}
        </p>
        <ul className="ntray-wait-rows">
          {account.items.map((item) => <Row key={item.id} item={item} now={now} onJump={onJump} />)}
        </ul>
      </>
    ) : error && !account ? (
      <p className="ntray-wait-h is-unread">WAITING ON YOU — CANNOT READ</p>
    ) : null}
    {account?.gaps?.length ? <p className="ntray-wait-gap">COULD NOT READ: {account.gaps.join(', ').toUpperCase()}</p> : null}
    <MandateRow />
  </section>
);

/**
 * An arrival, risen once in the toast lane.
 * @param {{item: object, now: number, arriving: boolean, onJump: Function, onDismiss: Function}} props
 */
export const WaitingToast = ({ item, now, arriving, onJump, onDismiss }) => (
  <div className={`ntray-card is-toast is-waiting${arriving ? ' is-arriving' : ''}`}>
    <div className="ntray-card-head">
      <span className="ntray-card-kind">
        <span className="waiting-chip-mark" aria-hidden="true" /> WAITING ON YOU · {KIND_LABEL[item.kind] || 'DECISION'}
      </span>
      <span className="ntray-card-ago">{waitedLabel(item.at, now)}</span>
      <button type="button" className="ntray-card-dismiss" aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" />
        </svg>
      </button>
    </div>
    <div className="ntray-card-actor">{whoLabel(item)}</div>
    <button type="button" className="ntray-card-body" onClick={() => onJump(item)}>
      <span className="ntray-card-title">{item.title}</span>
    </button>
    <div className="ntray-card-target">GO TO IT</div>
  </div>
);
