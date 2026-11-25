// BooksSection — the Logista office on the COMPANY LINE window: who keeps the
// books (never the Quaestor's being), each company's year to date per
// currency (in, out, net — and how many entries no receipt backs yet), its
// deadlines (a licensed CPA's marked), and every receipt no company has
// booked. Pure rendering; the IO lives in CompanyLineApp.jsx.

import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { holderName } from './company-line-view.js';


/**
 * @param {{books: ?object, names: Record<string, string>, pick: string, busy: boolean,
 *   onPick: (v: string) => void, onSeat: () => void, onClear: () => void}} props
 */
export const BooksSection = ({ books, names, pick, busy, onPick, onSeat, onClear, seatless = false }) => {
  const seat = books?.logista?.laneId ?? null;
  return (
    <section className="cline-sec" aria-label="the books" data-books="">
      <p className="cline-h label-data">THE BOOKS — LOGISTA · {seat ? holderName(seat, names) : 'NOBODY KEEPS THEM'}</p>
      {seatless ? null : (
        <div className="cline-open">
          <Select fill ariaLabel="Logista holder" value={pick} onChange={onPick} disabled={busy}
            placeholder="— choose the Logista (never the Quaestor) —" options={Object.entries(names).map(([laneId, name]) => ({ value: laneId, label: name }))} />
          <button type="button" className="sec-scan label-data" disabled={busy || !pick} onClick={onSeat}>SEAT</button>
          {seat ? <button type="button" className="sec-scan cline-danger label-data" disabled={busy} onClick={onClear}>UNSEAT</button> : null}
        </div>
      )}
      {books ? (
        <>
          {books.books.map((b) => (
            <div key={b.id} className="cline-co" data-books-company={b.id}>
              <p className="cline-co-name">{b.name} — {books.year} TO DATE</p>
              {Object.keys(b.yearToDate.currencies).length === 0 ? <p className="cline-co-line label-data">NOTHING BOOKED</p> : (
                <div className="cline-tiles cline-tiles-flat">
                  {Object.entries(b.yearToDate.currencies).map(([c, v]) => (
                    <div key={c} className="cline-tile">
                      <b className="cline-tile-n">{v.net}</b>
                      <span className="cline-tile-l label-data">{c} NET · IN {v.in} · OUT {v.out}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="cline-co-line label-data">{b.yearToDate.entries} ENTRIES · {b.yearToDate.unmatched} UNMATCHED{b.voided ? ` · ${b.voided} VOIDED` : ''}</p>
              <Sheet label="deadlines not yet met" rows={b.deadlines.filter((d) => !d.met)} rowKey={(d) => d.id} rowName={(d) => d.what} rowAttrs={(d) => ({ 'data-deadline-id': d.id })}
                columns={[{ head: 'WHAT IS DUE', cell: (d) => d.what, title: (d) => d.what }, { head: 'DUE', cell: (d) => d.due }, { head: 'TO', cell: (d) => d.authority }, { head: 'NEEDS', cell: (d) => (d.needsCpa ? 'A LICENSED CPA' : null), tone: (d) => (d.needsCpa ? 'alert' : null) }]} />
            </div>
          ))}
          {books.unbooked.length === 0 ? <EmptyState title="EVERY RECEIPT IS BOOKED" /> : (
            <>
              <p className="cline-co-line label-data">{books.unbooked.length} RECEIPT{books.unbooked.length === 1 ? '' : 'S'} NOT YET BOOKED</p>
              <Sheet label="receipts not yet booked" rows={books.unbooked} rowKey={(r) => `${r.kind}:${r.ref}`} columns={[{ head: 'RECEIPT', cell: (r) => r.label, title: (r) => r.label }, { head: 'KIND', cell: (r) => String(r.kind).toUpperCase() }, { head: 'REFERENCE', cell: (r) => r.ref, exact: true }]} />
            </>
          )}
        </>
      ) : null}
    </section>
  );
};
