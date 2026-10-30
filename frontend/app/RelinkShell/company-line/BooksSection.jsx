// BooksSection — the Logista office on the COMPANY LINE window: who keeps the
// books (never the Quaestor's being), each company's year to date per
// currency (in, out, net — and how many entries no receipt backs yet), its
// deadlines (a licensed CPA's marked), and every receipt no company has
// booked. Pure rendering; the IO lives in CompanyLineApp.jsx.

import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { holderName } from './company-line-view.js';

const SHOWN = 5;

/**
 * @param {{books: ?object, names: Record<string, string>, pick: string, busy: boolean,
 *   onPick: (v: string) => void, onSeat: () => void, onClear: () => void}} props
 */
export const BooksSection = ({ books, names, pick, busy, onPick, onSeat, onClear }) => {
  const seat = books?.logista?.laneId ?? null;
  return (
    <section className="cline-sec" aria-label="the books" data-books="">
      <p className="cline-h label-data">THE BOOKS — LOGISTA · {seat ? holderName(seat, names) : 'NOBODY KEEPS THEM'}</p>
      <div className="cline-open">
        <Select fill ariaLabel="Logista holder" value={pick} onChange={onPick} disabled={busy}
          placeholder="— choose the Logista (never the Quaestor) —" options={Object.entries(names).map(([laneId, name]) => ({ value: laneId, label: name }))} />
        <button type="button" className="sec-scan label-data" disabled={busy || !pick} onClick={onSeat}>SEAT</button>
        {seat ? <button type="button" className="sec-scan cline-danger label-data" disabled={busy} onClick={onClear}>UNSEAT</button> : null}
      </div>
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
              <ul className="cline-ws-src">
                {b.deadlines.filter((d) => !d.met).map((d) => (
                  <li key={d.id} data-deadline-id={d.id}>DUE {d.due}: {d.what} — TO {d.authority}{d.needsCpa ? ' — NEEDS A LICENSED CPA' : ''}</li>
                ))}
              </ul>
            </div>
          ))}
          {books.unbooked.length === 0 ? <EmptyState title="EVERY RECEIPT IS BOOKED" /> : (
            <>
              <p className="cline-co-line label-data">{books.unbooked.length} RECEIPT{books.unbooked.length === 1 ? '' : 'S'} NOT YET BOOKED</p>
              <ul className="cline-ws-src">{books.unbooked.slice(0, SHOWN).map((r) => <li key={`${r.kind}:${r.ref}`}>{r.label}</li>)}</ul>
            </>
          )}
        </>
      ) : null}
    </section>
  );
};
