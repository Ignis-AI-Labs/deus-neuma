// Sheet — A LIST OF RECORDS IS A SHEET (design-language.md § SHEET; Design note, 2026-11-16, on the leads list rebuilt
// as a table: […]).
//
// One component for every list of like records in every window: one record a line, one fact a column, the
// same columns for every row, so the eye runs down a column and finds what it wants. A cell holds a value,
// never a sentence. What does not fit a cell (a note, the reasons behind a score, a history) opens under the
// row on a press of its first cell. More than a hundred rows are paged, and the sheet says where it stands.
// Keyboard and screen readers get a real table: column headers, a row header, an expand button that says
// whether it is open.

import { useState } from 'react';
import { sheetPage, rangeWords, SHEET_PAGE } from './sheet-view.js';
import './Sheet.css';

/**
 * @param {{label: string, columns: Array<{head: string, cell: (row: object) => any, tone?: (row: object) => ?string, title?: (row: object) => ?string,
 *   attrs?: (row: object) => object, exact?: boolean, wrap?: boolean}>, rows: object[], rowKey: (row: object) => string, rowName?: (row: object) => string, rowAttrs?: (row: object) => object,
 *   detail?: (row: object) => any, detailLabel?: (row: object) => string, pageSize?: number, empty?: any}} props —
 *   rowName: the row's name in words (for the expand button) ·
 *   columns: the first is the row's own name (its header cell); tone 'on' | 'alert' colours a cell; exact: a value
 *   read character by character (an address, a domain); wrap: the one column whose value is itself a sentence (a fact's own words) and reads whole · detail: what opens under a row, or null for a row with nothing more
 */
export const Sheet = ({ label, columns, rows, rowKey, rowName = rowKey, rowAttrs = () => ({}), detail = () => null, detailLabel = () => 'more on this row', pageSize = SHEET_PAGE, empty = null }) => {
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(0);
  if (!rows.length) return empty;
  const shown = sheetPage(rows, page, pageSize);
  const [first, ...rest] = columns;
  const cellProps = (c, r) => ({ className: [c.exact ? 'sheet-exact' : '', c.wrap ? 'sheet-wrapped' : '', c.tone?.(r) ? `is-${c.tone(r)}` : ''].filter(Boolean).join(' ') || undefined, title: c.title?.(r) ?? undefined, ...(c.attrs?.(r) ?? {}) });
  return (
    <div className="sheet" data-sheet={label}>
      {shown.pages > 1 ? (
        <div className="sheet-pager">
          <span className="sheet-range label-data" data-sheet-range="">{rangeWords(shown)}</span>
          <button type="button" className="sec-scan sheet-step label-data" disabled={shown.page === 0} onClick={() => setPage(shown.page - 1)}>PREVIOUS</button>
          <button type="button" className="sec-scan sheet-step label-data" disabled={shown.page >= shown.pages - 1} onClick={() => setPage(shown.page + 1)}>NEXT</button>
        </div>
      ) : null}
      <div className="sheet-wrap">
        <table className="sheet-table" aria-label={label}>
          <thead><tr>{columns.map((c) => <th key={c.head} scope="col" className="label-data">{c.head}</th>)}</tr></thead>
          <tbody>
            {shown.rows.map((r) => {
              const key = rowKey(r);
              const more = detail(r);
              const isOpen = open === key;
              return [
                <tr key={key} data-sheet-row={key} {...rowAttrs(r)}>
                  <th scope="row" {...cellProps(first, r)}>{more
                    ? <button type="button" className="sheet-open" aria-expanded={isOpen} aria-label={`${rowName(r)} — ${detailLabel(r)}`} onClick={() => setOpen(isOpen ? null : key)}><span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> {first.cell(r)}</button>
                    : first.cell(r)}</th>
                  {rest.map((c) => <td key={c.head} {...cellProps(c, r)}>{c.cell(r) ?? '—'}</td>)}
                </tr>,
                more && isOpen ? <tr key={`${key}:more`} data-sheet-detail={key}><td colSpan={columns.length} className="sheet-detail">{more}</td></tr> : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
