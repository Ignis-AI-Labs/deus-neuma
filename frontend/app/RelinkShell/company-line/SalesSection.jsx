// SalesSection — the Mercator office on the COMPANY LINE window: who holds the
// sales seat (and the press that seats or clears it), the pipeline at a glance
// (count and value per stage), and every open deal with its next step. Pure
// rendering; the IO lives in CompanyLineApp.jsx. No sound imports of its own.

import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { holderName } from './company-line-view.js';

const STAGES = Object.freeze(['qualified', 'proposed', 'won', 'lost']);
const money = (value) => Object.entries(value ?? {}).map(([c, n]) => `${n} ${c}`).join(' + ') || '—';

/**
 * @param {{sales: ?object, names: Record<string, string>, pick: string, busy: boolean,
 *   onPick: (v: string) => void, onSeat: () => void, onClear: () => void}} props
 */
export const SalesSection = ({ sales, names, pick, busy, onPick, onSeat, onClear }) => {
  const seat = sales?.mercator?.laneId ?? null;
  const open = (sales?.deals ?? []).filter((d) => d.stage === 'qualified' || d.stage === 'proposed');
  return (
    <section className="cline-sec" aria-label="sales" data-sales="">
      <p className="cline-h label-data">SALES — MERCATOR · {seat ? holderName(seat, names) : 'NOBODY HOLDS THE SEAT'}</p>
      <div className="cline-open">
        <Select fill ariaLabel="Mercator holder" value={pick} onChange={onPick} disabled={busy}
          placeholder="— choose the Mercator —" options={Object.entries(names).map(([laneId, name]) => ({ value: laneId, label: name }))} />
        <button type="button" className="sec-scan label-data" disabled={busy || !pick} onClick={onSeat}>SEAT</button>
        {seat ? <button type="button" className="sec-scan cline-danger label-data" disabled={busy} onClick={onClear}>UNSEAT</button> : null}
      </div>
      {sales ? (
        <>
          <div className="cline-tiles cline-tiles-flat">
            {STAGES.map((s) => (
              <div key={s} className={`cline-tile${s === 'won' && sales.pipeline[s].count ? ' is-loud' : ''}`}>
                <b className="cline-tile-n">{sales.pipeline[s].count}</b>
                <span className="cline-tile-l label-data">{s.toUpperCase()} · {money(sales.pipeline[s].value)}</span>
              </div>
            ))}
          </div>
          {open.length === 0 ? <EmptyState title="NO OPEN DEAL" /> : (
            <ul className="cline-ws-src" aria-label="open deals">
              {open.map((d) => <li key={d.id} data-deal-id={d.id}>{d.buyer} — {d.stage.toUpperCase()}, {d.value.amount} {d.value.currency} — NEXT: {d.nextStep}</li>)}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
};
