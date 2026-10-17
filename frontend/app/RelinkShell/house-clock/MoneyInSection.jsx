// MoneyInSection — what the house RECEIVED: this week, this month and ever,
// per asset and per member; the latest receipts; the watch set and who is not
// watched and why; the operator's extra receive addresses; and a scan now.
// RECEIVE-ONLY: there is no send, no sign, no key anywhere behind this panel.
// Pure rendering (money-in-view.js holds the display law). No sound imports.

import { EmptyState } from '../empty-state.jsx';
import { Select } from '../Select.jsx';
import { totalLine, assetLines, memberLines, receiptLine, watchLine, sourceWords } from './money-in-view.js';
import { formatAddress } from '../../../utils/format.js';

const PERIODS = Object.freeze([['week', 'THIS WEEK'], ['month', 'THIS MONTH'], ['all', 'ALL TIME']]);

const Totals = ({ totals, names }) => (
  <>
    <dl className="hclock-lines">
      {PERIODS.map(([key, label]) => (
        <div key={key} className="hclock-line">
          <dt className="label-data">{label}</dt>
          <dd className="hclock-money">{totalLine(totals?.[key])}</dd>
        </div>
      ))}
    </dl>
    {assetLines(totals?.all).length ? (
      <>
        <p className="hclock-sub-head label-data">BY ASSET, ALL TIME</p>
        <ul className="hclock-rows">
          {assetLines(totals.all).map((a) => (
            <li key={a.key} className="hclock-row"><span className="hclock-row-what">{a.words}</span><span className="hclock-money">{a.usd}</span></li>
          ))}
        </ul>
        <p className="hclock-sub-head label-data">BY MEMBER, ALL TIME</p>
        <ul className="hclock-rows">
          {memberLines(totals.all, names).map((m) => (
            <li key={m.key} className="hclock-row"><span className="hclock-row-who">{m.who}</span><span className="hclock-money">{m.words}</span></li>
          ))}
        </ul>
      </>
    ) : null}
  </>
);

const Watch = ({ watch, lanes, addr, busy, onAddr, onDeclare, onRemove }) => (
  <>
    <p className="hclock-sub-head label-data">WATCHED ADDRESSES</p>
    <p className="hclock-muted label-data">{watchLine(watch)}</p>
    <ul className="hclock-rows">
      {(watch?.watched ?? []).map((w) => (
        <li key={w.address} className="hclock-row">
          <span className="hclock-row-who label-data">{formatAddress(w.address)}</span>
          <span className="hclock-row-what">{`${w.label || w.member || 'unnamed'} — ${sourceWords(w.source)}`}</span>
          {w.source === 'operator' ? (
            <button type="button" className="hclock-btn is-danger label-data" disabled={busy} onClick={() => onRemove(w.address)}>REMOVE</button>
          ) : null}
        </li>
      ))}
    </ul>
    {(watch?.unwatched ?? []).length ? (
      <>
        <p className="hclock-sub-head label-data">NOT WATCHED</p>
        <ul className="hclock-rows">
          {watch.unwatched.map((u) => (
            <li key={u.member} className="hclock-row is-held">
              <span className="hclock-row-who">{u.member}</span>
              <span className="hclock-row-what">{u.reason}</span>
            </li>
          ))}
        </ul>
      </>
    ) : null}
    <form className="hclock-pair" onSubmit={(e) => { e.preventDefault(); onDeclare(); }}>
      <input className="hclock-input label-data" aria-label="Receive address" placeholder="0x… receive address"
        value={addr.address} disabled={busy} onChange={(e) => onAddr('address', e.target.value)} />
      <input className="hclock-input" aria-label="Address label" placeholder="label" maxLength={64}
        value={addr.label} disabled={busy} onChange={(e) => onAddr('label', e.target.value)} />
      <Select ariaLabel="Address member" value={addr.member} onChange={(v) => onAddr('member', v)} disabled={busy}
        options={[{ value: '', label: 'THE HOUSE' }, ...lanes.map((l) => ({ value: l.neumaId, label: l.name || l.neumaId }))]} />
      <button type="submit" className="hclock-btn label-data" disabled={busy || !addr.address || !addr.label}>DECLARE</button>
    </form>
  </>
);

/**
 * @param {{money: Object, names: Object<string,string>, lanes: Object[], addr: Object, busy: boolean,
 *   onAddr: Function, onDeclare: Function, onRemove: Function, onScan: Function}} p
 */
export const MoneyInSection = ({ money, names, lanes, addr, busy, onAddr, onDeclare, onRemove, onScan }) => (
  <section className="hclock-sec">
    <div className="hclock-actions">
      <p className="hclock-muted">Receive only — what came in on Ethereum and Base. Nothing here can send.</p>
      <button type="button" className="hclock-btn label-data" disabled={busy} onClick={onScan}>{busy ? 'WORKING…' : 'SCAN NOW'}</button>
    </div>
    {money?.note ? <p className="hclock-muted label-data">{money.note}</p> : null}
    <Totals totals={money?.totals} names={names} />
    <p className="hclock-sub-head label-data">LATEST RECEIPTS</p>
    {(money?.receipts ?? []).length === 0 ? <EmptyState title="NOTHING RECEIVED YET" /> : (
      <ul className="hclock-rows">
        {money.receipts.map((r) => receiptLine(r, names)).map((r) => (
          <li key={r.key} className="hclock-wake">
            <div className="hclock-wake-head"><span className="hclock-row-who">{r.amount}</span><span className="hclock-money">{r.usd}</span></div>
            <p className="hclock-muted">{r.detail}</p>
          </li>
        ))}
      </ul>
    )}
    <Watch watch={money?.watch} lanes={lanes} addr={addr} busy={busy} onAddr={onAddr} onDeclare={onDeclare} onRemove={onRemove} />
  </section>
);
