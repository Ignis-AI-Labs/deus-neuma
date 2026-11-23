// Sheet — A LIST OF RECORDS IS A SHEET (design-language.md § SHEET; Design note, 2026-11-16, on the leads list rebuilt
// as a table: […]).
//
// One component for every list of like records in every window: one record a line, one fact a column, the
// same columns for every row, so the eye runs down a column and finds what it wants. A cell holds a value,
// never a sentence. What does not fit a cell (a note, the reasons behind a score, a history) opens under the
// row on a press of its first cell. More than a hundred rows are paged, and the sheet says where it stands.
// Keyboard and screen readers get a real table: column headers, a row header, an expand button that says
// whether it is open.
// Under every sheet, SPREADSHEET takes the whole of it away as a file: every row in the order shown, one column a fact.

import { useMemo, useState } from 'react';
import { sheetPage, rangeWords, SHEET_PAGE, sortRows, sortableColumn, nextSort, sheetCsv, sheetFileName } from './sheet-view.js';
import './Sheet.css';

/**
 * @param {{label: string, columns: Array<{head: string, cell: (row: object) => any, tone?: (row: object) => ?string, title?: (row: object) => ?string,
 *   attrs?: (row: object) => object, exact?: boolean, wrap?: boolean}>, rows: object[], rowKey: (row: object) => string, rowName?: (row: object) => string, rowAttrs?: (row: object) => object,
 *   detail?: (row: object) => any, detailLabel?: (row: object) => string, pageSize?: number, empty?: any}} props —
 *   rowName: the row's name in words (for the expand button) ·
 *   columns: the first is the row's own name (its header cell); tone 'on' | 'alert' colours a cell; exact: a value
 *   read character by character (an address, a domain); wrap: the one column whose value is itself a sentence (a fact's own words) and reads whole · check: the column that ticks
 *   a row (a checkbox) — it always stands FIRST, on the far left, whatever order it is given in (Design note, 2026-11-18: […]) · detail: what opens under a row, or null for a row with nothing more
 */
export const Sheet = ({ label, columns: given, rows, rowKey, rowName = rowKey, rowAttrs = () => ({}), detail = () => null, detailLabel = () => 'more on this row', pageSize = SHEET_PAGE, empty = null }) => {
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(0);
  // A ticking column always stands first, on the far left; the row's own name follows it as the row header.
  const ticks = given.filter((c) => c.check);
  const columns = [...ticks, ...given.filter((c) => !c.check)];
  // Any column orders the whole sheet, before it is paged (sheet-view.js § SORTING BY ANY COLUMN).
  const [sort, setSort] = useState(null); // {head, dir}
  const byColumn = sort ? columns.find((c) => c.head === sort.head) ?? null : null;
  const ordered = useMemo(() => (byColumn ? sortRows(rows, byColumn, sort.dir) : rows), [rows, byColumn, sort]);
  if (!rows.length) return empty;
  const shown = sheetPage(ordered, page, pageSize);
  const press = (c) => { setSort(nextSort(sort, c.head, c, rows)); setPage(0); };
  const head = (c) => {
    if (!c.head || !sortableColumn(c, rows)) return <th key={c.head} scope="col" className="label-data">{c.head}</th>;
    const on = sort?.head === c.head;
    return (
      <th key={c.head} scope="col" className="label-data" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        {/* The arrow is drawn by the stylesheet (data-mark), so the head's words stay exactly the column's name. */}
        <button type="button" className={`sheet-sort${on ? ' is-on' : ''}`} title={`Sort by ${c.head}`} data-sort={c.head} data-mark={on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'} onClick={() => press(c)}>
          {c.head}
        </button>
      </th>
    );
  };
  // The file is built on the press, from every row as ordered now — never on each draw.
  const take = () => {
    const url = URL.createObjectURL(new Blob([`\uFEFF${sheetCsv(columns, ordered)}`], { type: 'text/csv;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: sheetFileName(label) });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const [first, ...rest] = columns.slice(ticks.length);
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
          <thead><tr>{columns.map(head)}</tr></thead>
          <tbody>
            {shown.rows.map((r) => {
              const key = rowKey(r);
              const more = detail(r);
              const isOpen = open === key;
              return [
                <tr key={key} data-sheet-row={key} {...rowAttrs(r)}>
                  {ticks.map((c) => { const p = cellProps(c, r); return <td key={c.head} {...p} className={['sheet-tick', p.className].filter(Boolean).join(' ')}>{c.cell(r)}</td>; })}
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
      <div className="sheet-foot">
        <button type="button" className="sheet-take label-data" data-sheet-csv="" aria-label={`SPREADSHEET · ${ordered.length.toLocaleString('en-US')} ROW${ordered.length === 1 ? '' : 'S'} — save ${label} as a spreadsheet file`} onClick={take}>SPREADSHEET · {ordered.length.toLocaleString('en-US')} ROW{ordered.length === 1 ? '' : 'S'}</button>
      </div>
    </div>
  );
};
