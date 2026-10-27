// TreasuryBody — the TREASURY window, pure rendering: what waits on you
// first (each spend as its SPEND card, each Quaestor flag), then the flight
// check, every wallet of the house with its balances read live, the history
// of money out with each being's reason, money in, the campaigns' planning
// budgets, what the cost meter reads, and the Quaestor's seat. The display
// law lives in treasury-view.js and spend/spend-card-view.js; the IO lives in
// TreasuryApp.jsx. NO sound imports here — renderable under node.

import './SecurityApp.css';
import './LegalApp.css';
import './TreasuryApp.css';
import { formatDateTime } from '../../utils/format.js';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import { SpendCard } from './spend/SpendCard.jsx';
import {
  markOf, ethLabel, walletName, limitLabel, custodyLabel, historyStatus, historyLoud, treasuryOverview, seatLine,
} from './treasury-view.js';

export const TreasuryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 6 L8 2.5 L14 6 Z M3 13.5 H13 M4 7 V12 M8 7 V12 M12 7 V12" />
  </svg>
);

// One count that opens what lies below it.
const Tile = ({ n, label, sub, loud, onPress }) => (
  <button type="button" className={`tre-tile${loud ? ' is-loud' : ''}`} onClick={onPress}>
    <b className="tre-tile-n">{n}</b>
    <span className="tre-tile-l label-data">{label}</span>
    {sub ? <span className="tre-tile-s label-data">{sub}</span> : null}
  </button>
);

const SeatSection = ({ seat, lanes, pick, busy, onPick, onSeat, onClear }) => (
  <section className="legal-seat" data-treasury-section="seat">
    <p className="legal-sec-head label-data">THE SEAT — QUAESTOR · CHIEF FINANCIAL OFFICER</p>
    <p className="legal-note">
      One being oversees the house&apos;s money. It reads every wallet, reviews each spend before you decide it,
      and flags what looks wrong. It holds no key and signs nothing: every spend still waits on your own signature.
    </p>
    <div className="legal-seat-controls">
      <Select fill ariaLabel="Quaestor holder" value={pick} onChange={onPick} disabled={busy || lanes.length === 0}
        placeholder="— choose the holder —" options={lanes.map((l) => ({ value: l.neumaId, label: l.name || l.neumaId }))} />
      <button type="button" className="sec-scan label-data" disabled={busy || !pick} onClick={onSeat}>{busy ? 'WORKING…' : 'SEAT'}</button>
      {seat ? <button type="button" className="sec-scan legal-danger label-data" disabled={busy} onClick={onClear}>UNSEAT</button> : null}
    </div>
  </section>
);

export const TreasuryBody = ({
  board, error, loading, now, readAtMs, lanes, pick, seatBusy,
  onRefresh, onDecided, onFlagSeen, onJump, onPick, onSeat, onClear,
}) => {
  const view = treasuryOverview(board);
  const ethConfigured = board?.chains?.ethereum !== false;
  return (
    <div className="sec treasury">
      <header className="sec-head">
        <span className="sec-head-label label-data">TREASURY</span>
        <span className={`sec-head-seat label-data${board?.seat ? '' : ' legal-empty'}`}>{seatLine(board?.seat)}</span>
        <button type="button" className="sec-scan label-data" onClick={onRefresh} disabled={loading}>{loading ? 'READING…' : 'READ NOW'}</button>
      </header>
      {error ? <p className="sec-error label-data" role="alert">{error}</p> : null}
      {!board ? <EmptyState title={loading ? 'READING THE TREASURY…' : 'THE TREASURY COULD NOT BE READ'} /> : (
        <>
          <section className="tre-tiles" aria-label="the treasury at a glance">
            <Tile n={view.waiting} label="WAITING ON YOU" sub={`${view.pending} SPEND · ${view.flags} FLAG`} loud={view.waiting > 0} onPress={() => onJump('spends')} />
            <Tile n={view.notOk} label="CHECKS NOT OK" sub={view.failing ? `${view.failing} FAILING` : 'OF THE FLIGHT CHECK'} loud={view.failing > 0} onPress={() => onJump('flight')} />
            <Tile n={view.base.total} label="ETH HELD ON BASE" sub={view.base.unread ? `${view.base.unread} WALLET UNREAD` : 'EVERY WALLET READ'} onPress={() => onJump('wallets')} />
            <Tile n={view.received} label="RECEIPTS IN" sub="RECEIVE-ONLY LEDGER" onPress={() => onJump('in')} />
          </section>

          <section className="tre-sec" data-treasury-section="spends">
            <p className="tre-h label-data">SPENDS WAITING ON YOU</p>
            {board.pending.length === 0 ? <EmptyState title="NO SPEND WAITS ON YOU" /> : board.pending.map((card) => (
              <SpendCard key={`${card.neumaId}:${card.id}`} card={card} readAtMs={readAtMs} now={now} seated={Boolean(board.seat)} onDecided={onDecided} />
            ))}
            {board.flags.map((f) => (
              <div key={f.id} className="tre-flag cham" data-flag-id={f.id}>
                <div className="tre-flag-in cham-in">
                  <span className="spend-kind label-data">FLAG</span>
                  <span className="tre-flag-t">{f.title}</span>
                  {f.detail ? <span className="tre-flag-d">{f.detail}</span> : null}
                  <span className="tre-flag-m label-data">{String(f.kind).toUpperCase()} · {formatDateTime(f.at)}</span>
                  <button type="button" className="sec-scan label-data" onClick={() => onFlagSeen(f)}>READ</button>
                </div>
              </div>
            ))}
          </section>

          <section className="tre-sec" data-treasury-section="flight">
            <p className="tre-h label-data">FLIGHT CHECK — READ {formatDateTime(board.readAt)}</p>
            <ul className="tre-marks">
              {board.marks.map((m) => (
                <li key={m.id} className={`tre-mark ${markOf(m.state).cls}`}>
                  <span className="tre-mark-w label-data">{markOf(m.state).word}</span>
                  <span className="tre-mark-l label-data">{m.label}</span>
                  <span className="tre-mark-t">{m.line}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="tre-sec" data-treasury-section="wallets">
            <p className="tre-h label-data">WALLETS — BASE · ETHEREUM</p>
            <ul className="tre-rows">
              {board.wallets.map((w) => (
                <li key={w.address || w.neumaId} className="tre-row">
                  <span className="tre-row-who label-data">{walletName(w)}</span>
                  <span className="spend-addr">{w.address || 'NO WALLET'}</span>
                  <span className="tre-row-v label-data">{ethLabel(w.balances.base)} · {ethLabel(w.balances.ethereum, { configured: ethConfigured })}</span>
                  <span className="tre-row-s label-data">{limitLabel(w)}{w.kind === 'being' ? ` · ${w.recipients.length} APPROVED RECIPIENT${w.recipients.length === 1 ? '' : 'S'} · KEY ${custodyLabel(w)}` : ''}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="tre-sec" data-treasury-section="history">
            <p className="tre-h label-data">MONEY OUT — EVERY SPEND ASKED, AND WHAT BECAME OF IT</p>
            {board.history.length === 0 ? <EmptyState title="NO SPEND HAS BEEN ASKED YET" /> : (
              <ul className="tre-rows">
                {board.history.map((h) => (
                  <li key={`${h.neumaId}:${h.id}`} className="tre-row">
                    <span className={`tre-row-who label-data${historyLoud(h) ? ' is-loud' : ''}`}>{historyStatus(h)}</span>
                    <span className="tre-row-v label-data">{h.amount} {h.asset} → {h.to}</span>
                    <span className="tre-row-s label-data">{String(h.name || h.neumaId).toUpperCase()} · {formatDateTime(h.resolvedAt || h.requestedAt)}{h.txHash ? ` · TX ${h.txHash}` : ''}</span>
                    {h.reason ? <q className="tre-row-q">{h.reason}</q> : null}
                    {h.note ? <span className="tre-row-s label-data">YOUR NOTE: {h.note}</span> : null}
                    {h.failure ? <span className="tre-row-s label-data is-loud">{h.failure}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tre-sec" data-treasury-section="in">
            <p className="tre-h label-data">MONEY IN — RECEIVE-ONLY</p>
            <p className="tre-line label-data">
              {board.moneyIn.count} RECEIPT{board.moneyIn.count === 1 ? '' : 'S'}
              {Object.values(board.moneyIn.perAsset).map((a) => ` · ${a.amount} ${a.asset} ON ${String(a.network).toUpperCase()}`).join('')}
              {board.moneyIn.unpriced ? ` · ${board.moneyIn.unpriced} UNPRICED` : ''}
            </p>
            <p className="tre-h label-data">BUDGETS — PLANNING NUMBERS; NOTHING SPENDS THEM</p>
            {board.budgets.length === 0 ? <p className="tre-line label-data">NO CAMPAIGN SETS A BUDGET.</p> : board.budgets.map((b) => (
              <p key={b.id} className="tre-line label-data">{b.name}: {b.money ?? '—'} MONEY · {b.hours ?? '—'} HOURS{b.note ? ` — ${b.note}` : ''}</p>
            ))}
            <p className="tre-h label-data">RUNNING COSTS</p>
            <p className="tre-line label-data">
              {board.costs.gpuPowerW === null ? 'GPU POWER DRAW UNREAD' : `${board.costs.gpuName || 'GPU'} DRAWING ${board.costs.gpuPowerW} W NOW`}
              {' '}— NOT MEASURED YET: {board.costs.missing.join(' · ').toUpperCase()}
            </p>
          </section>

          <SeatSection seat={board.seat} lanes={lanes} pick={pick} busy={seatBusy} onPick={onPick} onSeat={onSeat} onClear={onClear} />
          {board.gaps.length ? <p className="sec-error label-data">NOT READ: {board.gaps.map((g) => g.part).join(', ').toUpperCase()}</p> : null}
        </>
      )}
    </div>
  );
};
