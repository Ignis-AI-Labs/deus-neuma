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

// SORTING BY ANY COLUMN (Design note, 2026-11-18: […]). One press on a column's head orders the
// whole sheet by it, the next press turns the order; every sheet in every window gets it. A column sorts by its own
// `sort` when the cell's words would order wrongly (STRONG/WEAK/NO MATCH, a stage), else by what its cell shows: a
// figure as a number ([…], […], […], […]), words A to Z. A cell that is a control (a
// button, a box) does not sort. An empty value ([…], nothing) always stands last, whichever way the order runs.

// A leading figure, read as one: not a date (2026-11-18), a version (0.1.180), a time (10:54) or a ratio (1/12).
const LEADING_FIGURE = /^#?(\d[\d,]*(?:\.\d+)?)(?![\d\-/.:])/;

/** The value a row sorts by in this column, or null (empty, or a control). */
export const sortValue = (column, row) => {
  const v = column.sort ? column.sort(row) : column.cell(row);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t === '—' || t === '-') return null;
  const figure = LEADING_FIGURE.exec(t);
  return figure ? Number(figure[1].replace(/,/g, '')) : t.toLowerCase();
};

/** Can this column be sorted: it has its own sort, or its cells show words or figures (not controls). */
export const sortableColumn = (column, rows) => column.sortable !== false
  && (Boolean(column.sort) || rows.some((r) => { const v = column.cell(r); return typeof v === 'string' || typeof v === 'number'; }));

/** The rows in a column's order; ties keep their order, and an empty value stands last either way. */
export const sortRows = (rows, column, dir = 'asc') => {
  if (!column) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => ({ r, i, v: sortValue(column, r) })).sort((a, b) => {
    if (a.v === null || b.v === null) return a.v === null && b.v === null ? a.i - b.i : a.v === null ? 1 : -1;
    if (typeof a.v !== typeof b.v) return typeof a.v === 'number' ? -sign : sign;
    const c = typeof a.v === 'number' ? a.v - b.v : a.v.localeCompare(b.v, 'en', { numeric: true });
    return c ? c * sign : a.i - b.i;
  }).map((k) => k.r);
};

/** What a press on a column's head does: a new column starts most-first for figures and A-to-Z for words; the same column turns. */
export const nextSort = (current, head, column, rows) => {
  if (current?.head === head) return { head, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { head, dir: rows.some((r) => typeof sortValue(column, r) === 'number') ? 'desc' : 'asc' };
};

// EVERY SHEET CAN BE TAKEN AWAY AS A SPREADSHEET (Design note, 2026-11-21: match what a CRM does, then better — theirs exports
// some lists; here every list of records on the desk does). The file is the sheet as it stands: every row, not only
// the page in view, in the order shown, one column a fact.

/** What a cell says, as plain words: text and numbers as they are, an element's own text, nothing for a control. pure. */
export const cellText = (value) => {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(' ');
  if (typeof value === 'object' && value.props) {
    if (['input', 'button', 'select', 'textarea'].includes(value.type)) return '';
    return cellText(value.props.children);
  }
  return '';
};

// A value that a spreadsheet would run as a formula is written as text.
const safe = (text) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
/** One spreadsheet cell: quoted, on one line, and never run as a formula (names and titles come from pages and imports). pure. */
export const quoted = (text) => `"${safe(String(text ?? '').replace(/\s+/g, ' ').trim()).replace(/"/g, '""')}"`;

/**
 * The sheet as a spreadsheet file's text. A column may give `text(row)` where its cell is not words. pure.
 * @param {Array<{head: string, cell: Function, text?: Function, check?: boolean}>} columns
 * @param {object[]} rows
 * @returns {string}
 */
export const sheetCsv = (columns = [], rows = []) => {
  const kept = columns.filter((c) => c.head && !c.check);
  return [kept.map((c) => quoted(c.head)).join(','), ...rows.map((r) => kept.map((c) => quoted(c.text ? c.text(r) ?? '' : cellText(c.cell(r)))).join(','))].join('\r\n');
};

/** A file name from the sheet's label: "open deals" → "open-deals.csv". pure. */
export const sheetFileName = (label) => `${String(label || 'sheet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sheet'}.csv`;
