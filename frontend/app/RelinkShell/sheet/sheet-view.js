// sheet-view.js — the arithmetic of a sheet: which rows a page holds. Pure.

export const SHEET_PAGE = 100;

/** One page of rows, with where it stands in the whole. A page past the end is the last page. */
export const sheetPage = (rows = [], page = 0, size = SHEET_PAGE) => {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(page, 0), pages - 1);
  return { rows: rows.slice(at * size, (at + 1) * size), total: rows.length, page: at, pages, from: rows.length ? at * size + 1 : 0, to: Math.min((at + 1) * size, rows.length) };
};

/** The words over a sheet that runs to more than one page. */
export const rangeWords = (p) => `SHOWING ${p.from.toLocaleString('en-US')}–${p.to.toLocaleString('en-US')} OF ${p.total.toLocaleString('en-US')}`;
