// PickerList — the FolderPicker's contents pane: a readout head (true count,
// name filter, hidden toggle) over the rows. A folder row navigates in; its
// trailing OPEN picks it without entering (folder mode). Keyboard: arrows
// walk the rows, Enter/→ enters, Backspace/← climbs, typing in the filter
// narrows and ↓ drops into the rows. Rows cascade in under one scanline on
// each arrival (the motion kernel's kx-cascade + kx-scan) — the list is
// re-keyed by folder so it plays per navigation, never on a filter
// keystroke. Focus and hover lock MGS corner brackets onto a row (kx-lock).

import { useRef } from 'react';
import { FolderGlyph, FileGlyph, FilterGlyph, ChevronGlyph } from './picker-glyphs.jsx';

// impure — move DOM focus among the rendered rows.
const focusRow = (listEl, index) => {
  const rows = listEl?.querySelectorAll('.picker-row');
  if (!rows || rows.length === 0) return;
  rows[Math.max(0, Math.min(index, rows.length - 1))].focus();
};

/**
 * @param {{
 *   cwd: string|null, entries: Array|null, rows: Array<{name: string, path: string, dir: boolean}>,
 *   pickFile: boolean, query: string, onQuery: (q: string) => void,
 *   showHidden: boolean, onToggleHidden: () => void,
 *   onEnter: (path: string) => void, onPick: (path: string) => void, onUp: () => void,
 *   onRowMenu: (e: MouseEvent, entry: object) => void, onListMenu: (e: MouseEvent) => void,
 * }} props
 */
export const PickerList = ({
  cwd, entries, rows, pickFile, query, onQuery, showHidden, onToggleHidden,
  onEnter, onPick, onUp, onRowMenu, onListMenu,
}) => {
  const listRef = useRef(null);
  const total = (entries || []).filter((e) => showHidden || !e.hidden).length;
  const noun = pickFile ? 'ITEMS' : 'FOLDERS';

  const onRowKey = (e, entry, index) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(listRef.current, index + 1); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index === 0) listRef.current?.closest('.picker-main')?.querySelector('.picker-filter-input')?.focus();
      else focusRow(listRef.current, index - 1);
    } else if (e.key === 'ArrowRight' && entry.dir !== false) { e.preventDefault(); onEnter(entry.path); }
    else if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); onUp(); }
  };

  return (
    <div className="picker-main">
      <div className="picker-listhead">
        <span className="picker-count">
          {entries === null ? 'READING…' : `${String(rows.length).padStart(2, '0')}${rows.length === total ? '' : ` / ${String(total).padStart(2, '0')}`} ${noun}`}
        </span>
        <label className="picker-filter">
          <FilterGlyph />
          <input
            className="picker-filter-input"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(listRef.current, 0); }
              if (e.key === 'Enter' && rows.length === 1 && rows[0].dir !== false) onEnter(rows[0].path);
              if (e.key === 'Escape' && query) { e.stopPropagation(); onQuery(''); }
            }}
            placeholder="Filter"
            spellCheck={false}
            aria-label="Filter this folder"
          />
        </label>
        <button type="button" className={`picker-toggle${showHidden ? ' on' : ''}`} aria-pressed={showHidden} onClick={onToggleHidden} title="Show dotfiles">
          HIDDEN
        </button>
      </div>

      <div className="picker-list" ref={listRef} onContextMenu={onListMenu} aria-label={cwd || 'Folder contents'}>
        {entries === null ? (
          <p className="picker-note">
            <span className="picker-note-ring" aria-hidden="true" />
            READING FOLDER
          </p>
        ) : rows.length === 0 ? (
          <p className="picker-note">
            {query.trim() ? `NOTHING MATCHES “${query.trim()}”` : pickFile ? 'EMPTY FOLDER' : 'NO SUBFOLDERS'}
            <small>{query.trim() ? 'Clear the filter, or open this folder as it is.' : pickFile ? 'Nothing here to choose.' : 'This is the end of the branch — OPEN picks it.'}</small>
          </p>
        ) : (
          <ul key={cwd} className="picker-rows kx-cascade kx-scan">
            {rows.map((e, i) => (
              <li key={e.path} className={`picker-rowwrap${e.dir === false ? ' is-file' : ''}${e.hidden ? ' is-hidden' : ''}`}>
                {/* A directory always navigates; in file mode a file row is the pick. */}
                <button
                  type="button"
                  className={`picker-row kx-lock${e.dir === false ? ' is-file' : ''}`}
                  onClick={() => (e.dir === false ? onPick(e.path) : onEnter(e.path))}
                  onKeyDown={(ev) => onRowKey(ev, e, i)}
                  onContextMenu={(ev) => onRowMenu(ev, e)}
                  title={e.path}
                >
                  <span className="picker-glyph">{e.dir === false ? <FileGlyph /> : <FolderGlyph />}</span>
                  <span className="picker-name">{e.name}</span>
                  {e.dir === false ? null : <span className="picker-chev"><ChevronGlyph /></span>}
                </button>
                {pickFile || e.dir === false ? null : (
                  <button type="button" className="picker-row-pick" onClick={() => onPick(e.path)} tabIndex={-1} title={`Open ${e.path}`}>
                    OPEN
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
