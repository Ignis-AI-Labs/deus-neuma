// SalesSection — the Mercator office on the COMPANY LINE window: who holds the
// sales seat (and the press that seats or clears it), the pipeline at a glance
// (count and value per stage), every open deal with its next step, where
// deliveries go (the operator's own folder and its https address — set here
// and nowhere else) and, per won deal, every link delivered on it. Pure
// rendering; the IO lives in CompanyLineApp.jsx. No sound imports of its own.

import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { holderName } from './company-line-view.js';

const STAGES = Object.freeze(['qualified', 'proposed', 'won', 'lost']);
const money = (value) => Object.entries(value ?? {}).map(([c, n]) => `${n} ${c}`).join(' + ') || '—';

/**
 * @param {{sales: ?object, names: Record<string, string>, pick: string, busy: boolean,
 *   onPick: (v: string) => void, onSeat: () => void, onClear: () => void,
 *   drafts?: object, onDraft?: Function, onDestination?: () => void, seatless?: boolean}} props
 *   seatless — the POSITIONS hub seats the Mercator in its own head, so the picker here stands down
 */
export const SalesSection = ({ sales, names, pick, busy, onPick, onSeat, onClear, drafts = {}, onDraft = () => {}, onDestination = () => {}, seatless = false }) => {
  const seat = sales?.mercator?.laneId ?? null;
  const open = (sales?.deals ?? []).filter((d) => d.stage === 'qualified' || d.stage === 'proposed');
  const won = (sales?.deals ?? []).filter((d) => d.stage === 'won');
  const dest = drafts._delivery ?? {};
  return (
    <section className="cline-sec" aria-label="sales" data-sales="">
      <p className="cline-h label-data">SALES — MERCATOR · {seat ? holderName(seat, names) : 'NOBODY HOLDS THE SEAT'}</p>
      {seatless ? null : (
        <div className="cline-open">
          <Select fill ariaLabel="Mercator holder" value={pick} onChange={onPick} disabled={busy}
            placeholder="— choose the Mercator —" options={Object.entries(names).map(([laneId, name]) => ({ value: laneId, label: name }))} />
          <button type="button" className="sec-scan label-data" disabled={busy || !pick} onClick={onSeat}>SEAT</button>
          {seat ? <button type="button" className="sec-scan cline-danger label-data" disabled={busy} onClick={onClear}>UNSEAT</button> : null}
        </div>
      )}
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
            <Sheet label="open deals" rows={open} rowKey={(d) => d.id} rowName={(d) => d.buyer} rowAttrs={(d) => ({ 'data-deal-id': d.id })}
              columns={[{ head: 'BUYER', cell: (d) => d.buyer }, { head: 'STAGE', sort: (d) => ({ qualified: 1, proposed: 2 }[d.stage] ?? 0), cell: (d) => d.stage.toUpperCase() }, { head: 'VALUE', cell: (d) => `${d.value.amount} ${d.value.currency}` }, { head: 'NEXT STEP', cell: (d) => d.nextStep || null, title: (d) => d.nextStep }]} />
          )}
          <p className="cline-h label-data">DELIVERY — {sales.destination ? 'WHERE FINISHED WORK GOES' : 'NOT SET: NOTHING CAN BE DELIVERED UNTIL YOU CHOOSE WHERE'}</p>
          {sales.destination ? (
            <p className="cline-move-t" data-delivery-destination="">
              INTO <span className="cline-exact">{sales.destination.folder}</span> · SERVED AT <span className="cline-exact">{sales.destination.linkBase}</span>
            </p>
          ) : null}
          <p className="cline-move-t">
            A folder on this machine that you serve on the web (a synced drive folder, a web server&apos;s directory). The Mercator publishes a deal&apos;s
            work or invoice there with your yes, under a link no one can guess, and sends the buyer the link from the house mailbox.
          </p>
          <div className="cline-open">
            <input className="cline-input" aria-label="Delivery folder on this machine" placeholder="/home/you/Dropbox/deliveries" disabled={busy}
              value={dest.folder ?? ''} onChange={(e) => onDraft('_delivery', 'folder', e.target.value)} />
            <input className="cline-input" aria-label="Its https address" placeholder="https://files.example.com/deliveries" disabled={busy}
              value={dest.linkBase ?? ''} onChange={(e) => onDraft('_delivery', 'linkBase', e.target.value)} />
            <button type="button" className="sec-scan label-data" disabled={busy || !String(dest.folder ?? '').trim() || !/^https:\/\//.test(String(dest.linkBase ?? '').trim())} onClick={onDestination}>
              {sales.destination ? 'CHANGE WHERE DELIVERIES GO' : 'SET WHERE DELIVERIES GO'}
            </button>
          </div>
          {won.length ? (
            <Sheet label="won deals" rows={won} rowKey={(d) => d.id} rowName={(d) => d.buyer} rowAttrs={(d) => ({ 'data-deal-id': d.id })}
              columns={[{ head: 'BUYER', cell: (d) => d.buyer }, { head: 'STAGE', cell: () => 'WON', tone: () => 'on' }, { head: 'VALUE', cell: (d) => `${d.value.amount} ${d.value.currency}` },
                { head: 'DELIVERED', cell: (d) => {
                  const sent = (sales.deliveries ?? []).filter((p) => p.dealId === d.id);
                  return sent.length ? sent.map((p) => <span key={p.id} data-delivery={p.id}>{p.name}: <a className="cline-link" href={p.link} target="_blank" rel="noreferrer noopener">{p.link}</a> </span>) : null;
                } }]} />
          ) : null}
        </>
      ) : null}
    </section>
  );
};
