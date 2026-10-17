// HouseClockBody — the HOUSE CLOCK window, pure rendering: a head that always
// shows where the charter stands and carries the PAUSE / RESUME switch, then
// one tab per question the operator asks of a house that wakes itself —
// CHARTER (what it may do), NOW (what it is doing), LEDGER (what it did),
// ASKS (what came back to me), MONEY IN (what it earned).
// No sound imports — renderable under node for the view tests.

import './HouseClock.css';
import { charterStatus, pauseSwitch, openAskCount } from './house-clock-view.js';
import { CharterSection } from './CharterSection.jsx';
import { NowSection, LedgerSection, AsksSection } from './WakeSections.jsx';
import { MoneyInSection } from './MoneyInSection.jsx';

export const HouseClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 7 L8 2.5 L14 7" />
    <path d="M3.5 6 V13.5 H12.5 V6" />
    <circle cx="8" cy="9.5" r="2.4" />
    <path d="M8 8.3 V9.5 L8.9 10.2" />
  </svg>
);

/** The window's tabs, in the order the operator asks their questions. */
export const HOUSE_TABS = Object.freeze(['charter', 'now', 'ledger', 'asks', 'money']);

const tabLabel = (tab, asks) => {
  if (tab === 'asks') {
    const open = openAskCount(asks);
    return open ? `ASKS (${open})` : 'ASKS';
  }
  return { charter: 'CHARTER', now: 'NOW', ledger: 'LEDGER', money: 'MONEY IN' }[tab];
};

const Head = ({ charter, busy, error, onPause }) => {
  const status = charterStatus(charter);
  const sw = pauseSwitch(charter);
  return (
    <header className="hclock-head">
      <span className="hclock-head-label label-data">HOUSE CLOCK</span>
      <span className={`hclock-head-status label-data is-${status.key}`} data-standing={status.key}>{status.words}</span>
      <button type="button" className={`hclock-switch label-data${charter?.paused ? ' is-paused' : ''}`}
        disabled={busy || !sw.enabled} title={sw.title} onClick={onPause}>
        {sw.label}
      </button>
      {error ? <p className="hclock-error label-data" role="alert">{error}</p> : null}
    </header>
  );
};

/**
 * @param {Object} p - the shell's state and handlers (HouseClockApp.jsx)
 */
export const HouseClockBody = (p) => (
  <div className="hclock">
    <Head charter={p.charter} busy={p.busy} error={p.error} onPause={p.onPause} />
    <nav className="hclock-tabs" role="tablist" aria-label="House clock sections">
      {HOUSE_TABS.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={p.tab === t}
          className={`hclock-tab label-data${p.tab === t ? ' is-on' : ''}`} onClick={() => p.onTab(t)}>
          {tabLabel(t, p.asks)}
        </button>
      ))}
    </nav>
    <div className="hclock-panel" role="tabpanel">
      {p.tab === 'charter' ? (
        <CharterSection charter={p.charter} history={p.history} names={p.names} draft={p.draft} busy={p.busy}
          onEdit={p.onEdit} onDraft={p.onDraft} onSeat={p.onSeat} onSave={p.onSave} onCancel={p.onCancel} onApprove={p.onApprove} />
      ) : null}
      {p.tab === 'now' ? <NowSection queue={p.queue} names={p.names} onOpenSitting={p.onOpenSitting} /> : null}
      {p.tab === 'ledger' ? (
        <LedgerSection ledger={p.ledger} filter={p.filter} names={p.names} seats={p.seats} page={p.page} pageSize={p.pageSize}
          onFilter={p.onFilter} onPage={p.onPage} onOpenSitting={p.onOpenSitting} />
      ) : null}
      {p.tab === 'asks' ? <AsksSection asks={p.asks} names={p.names} busy={p.busy} onClose={p.onCloseAsk} onOpenSitting={p.onOpenSitting} /> : null}
      {p.tab === 'money' ? (
        <MoneyInSection money={p.money} names={p.names} lanes={p.lanes} addr={p.addr} busy={p.moneyBusy}
          onAddr={p.onAddr} onDeclare={p.onDeclare} onRemove={p.onRemove} onScan={p.onScan} />
      ) : null}
    </div>
  </div>
);
