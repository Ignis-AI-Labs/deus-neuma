// WalletLiquidityCards — the pictures of the LIQUIDITY view: the budget bar,
// a deposit waiting for the operator, and a position's range. Figures come
// from lp-figures.js; these only draw them.

import { useEffect, useRef, useState } from 'react';
import { budgetBar, poolNamed, waitingLine, usd } from './lp-figures.js';
import { uiSound } from '../../services/ui-sound.js';

const PencilIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M8.2 1.6 L10.4 3.8 L4 10.2 L1.4 10.6 L1.8 8 Z" />
  </svg>
);

/**
 * In positions, waiting, and the budget line, as one bar; the budget edits in place.
 * @param {{budgetUsd: number|null, inPositionsUsd: number|null, waitingUsd: number, onSave: (n: number) => Promise<string|null>}} props
 *   inPositionsUsd — null when positions were not read
 */
export const BudgetMeter = ({ budgetUsd, inPositionsUsd, waitingUsd, onSave }) => {
  const [editing, setEditing] = useState(budgetUsd === null);
  const [value, setValue] = useState(budgetUsd === null ? '' : String(budgetUsd));
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => { setValue(budgetUsd === null ? '' : String(budgetUsd)); setEditing(budgetUsd === null); }, [budgetUsd]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  const bar = budgetBar({ budgetUsd, inPositionsUsd: inPositionsUsd ?? 0, waitingUsd });

  const save = async (event) => {
    event.preventDefault();
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) { setError('A dollar amount, 0 or more.'); return; }
    uiSound('activate');
    const failed = await onSave(n);
    if (failed) { setError(failed); return; }
    setError(null); setEditing(false);
  };

  return (
    <section className="lpw-card lpw-budget" aria-label="Budget">
      <div className="lpw-row">
        <span className="lpw-k">BUDGET</span>
        {editing ? null : (
          <button type="button" className="lpw-link" onClick={() => { uiSound('tick'); setEditing(true); }} aria-label={`${budgetUsd === null ? 'SET' : usd(budgetUsd)}, change budget`}>
            {budgetUsd === null ? 'SET' : usd(budgetUsd)} <PencilIcon />
          </button>
        )}
      </div>
      <div className="lpw-bar" role="img"
        aria-label={`${usd(inPositionsUsd)} in positions${waitingUsd ? `, ${usd(waitingUsd)} waiting` : ''}${budgetUsd === null ? ', no budget set' : ` of a ${usd(budgetUsd)} budget`}`}>
        <span className={`lpw-bar-used${bar.over ? ' is-over' : ''}`} style={{ width: `${bar.used}%` }} />
        <span className="lpw-bar-wait" style={{ left: `${bar.used}%`, width: `${bar.waiting}%` }} />
        {bar.budgetAt === null ? null : <span className="lpw-bar-limit" style={{ left: `${bar.budgetAt}%` }} />}
      </div>
      <div className="lpw-legend">
        <span><i className="lpw-dot is-used" />{inPositionsUsd === null ? 'positions not read' : `${usd(inPositionsUsd)} in positions`}</span>
        {waitingUsd ? <span><i className="lpw-dot is-wait" />{usd(waitingUsd)} waiting</span> : null}
        {budgetUsd === null ? <span>No cap: deposits run on their own</span> : null}
      </div>
      {editing ? (
        <form className="lpw-form" onSubmit={save}>
          <span className="lpw-unit">$</span>
          <input className="lpw-in" type="number" min="0" step="1" value={value} aria-label="Budget in dollars"
            onChange={(e) => setValue(e.target.value)} ref={inputRef} />
          <button type="submit" className="lpw-btn is-primary">SET</button>
          {budgetUsd === null ? null : <button type="button" className="lpw-btn" onClick={() => setEditing(false)}>CANCEL</button>}
        </form>
      ) : null}
      {error ? <p className="wal-err label-data">{error}</p> : null}
    </section>
  );
};

/**
 * A deposit past the budget, waiting for the operator's yes or no.
 * @param {{request: object, pools: Array<object>, budgetUsd: number|null, busy: boolean, onAnswer: (verdict: 'approve'|'decline') => void}} props
 */
export const WaitingCard = ({ request, pools, budgetUsd, busy, onAnswer }) => {
  const pool = poolNamed(pools, request.action.pool);
  const verb = request.action.type === 'add' ? 'ADD TO' : 'OPEN IN';
  return (
    <li className="lpw-card lpw-wait" aria-label={`${verb} ${pool.name}, ${usd(request.depositUsd)}`}>
      <div className="lpw-row">
        <span className="lpw-amount">{usd(request.depositUsd)}</span>
        <span className="lpw-k">{verb} {pool.name}</span>
      </div>
      <p className="lpw-sub">{waitingLine(request, pool, budgetUsd)}</p>
      <div className="lpw-acts">
        <button type="button" className="lpw-btn is-primary" disabled={busy} onClick={() => onAnswer('approve')}>{busy ? 'RUNNING…' : 'APPROVE'}</button>
        <button type="button" className="lpw-btn" disabled={busy} onClick={() => onAnswer('decline')}>DECLINE</button>
      </div>
    </li>
  );
};

/**
 * One position: its worth, its fees, and its range with the pool's price on it.
 * @param {{row: ReturnType<typeof import('./lp-figures.js').positionRows>[number], symbols: {symbolX: string, symbolY: string}}} props
 */
export const PositionCard = ({ row, symbols }) => (
  <li className={`lpw-card lpw-pos${row.inRange === false ? ' is-out' : ''}`}>
    <div className="lpw-row">
      <span className="lpw-k">{row.name} <span className="lpw-id">#{row.id}</span></span>
      <span className={`lpw-chip${row.inRange === false ? ' is-out' : row.inRange ? ' is-in' : ''}`}>
        {row.inRange === null ? 'RANGE ?' : row.inRange ? 'IN RANGE' : 'OUT OF RANGE'}
      </span>
    </div>
    <div className="lpw-row">
      <span className="lpw-amount">{usd(row.usd)}</span>
      <span className="lpw-fees">{usd(row.feesUsd)} fees</span>
    </div>
    <div className="lpw-range" role="img"
      aria-label={row.inRange === null ? 'Range' : row.inRange ? 'The pool price is inside this range' : 'The pool price is outside this range'}>
      <span className="lpw-range-band" style={{ left: `${row.range.from}%`, width: `${Math.max(1, row.range.to - row.range.from)}%` }} />
      {row.range.at === null ? null : <span className="lpw-range-now" style={{ left: `${row.range.at}%` }} />}
    </div>
    <p className="lpw-sub">{row.x} {symbols.symbolX} + {row.y} {symbols.symbolY}</p>
  </li>
);
