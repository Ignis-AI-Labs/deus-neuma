// FolderPicker — the "Open Folder" instrument: browse the real disk, jump to
// a place, and pick a directory. A reusable overlay used by Files (open a
// root), Projects and House (set a folder), brand kits (choose a file). The
// backend serves the directory tree (a browser sandbox can't hand a server a
// native path), directories only unless `pickFile`. The picker just returns
// an absolute path via onPick — the caller decides what to do with it.
//
// Two panes (redesign 2026-09-29, Founder: […]): the rail (PickerRail — places, pinned,
// drives, recent, the one holding the cwd lit) beside the contents
// (PickerAddress trail over PickerList rows), a TARGET readout at the foot.
//
// `draggable` (the portaled open-folder flow): the panel is a real movable
// dialog — grab its head and put it anywhere on screen. Inline hosts leave
// it off — the picker fills their window by design.

import { useCallback, useEffect, useMemo, useState } from 'react';
import './FolderPicker.css';
import './FolderPicker-rail.css';
import './FolderPicker-list.css';
import { browseDir, listRecents, listDrives, createBrowseFolder } from '../../../services/user-files.js';
import { baseName } from '../../../utils/path.js';
import { CtxMenu } from '../CtxMenu.jsx';
import { pickerMenuItems } from '../files/files-menu.js';
import { isFavorite, toggleFavorite } from '../folder-shelf.js';
import { loadShelf, saveShelf } from '../../windowing/window-storage.js';
import { railSections, activeRailPath, visibleEntries } from './picker-places.js';
import { usePickerDrag } from './use-picker-drag.js';
import { EmblemGlyph } from './picker-glyphs.jsx';
import { PickerRail } from './PickerRail.jsx';
import { PickerAddress } from './PickerAddress.jsx';
import { PickerList } from './PickerList.jsx';

/**
 * Browse the disk and pick a folder (default) or a file (`pickFile`). In file
 * mode directories still navigate; a file row returns its path via onPick and
 * the "open this folder" action is hidden (a folder is not a valid pick).
 * @param {{ initialPath?: string, onPick: (absPath: string) => void, onCancel: () => void, pickFile?: boolean, draggable?: boolean }} props
 */
export const FolderPicker = ({ initialPath, onPick, onCancel, pickFile = false, draggable = false }) => {
  const [cwd, setCwd] = useState(null);
  const [parent, setParent] = useState(null);
  const [home, setHome] = useState(null);
  const [entries, setEntries] = useState(null); // null = loading
  const [recents, setRecents] = useState([]);
  const [drives, setDrives] = useState([]);
  const [favorites, setFavorites] = useState(() => loadShelf().favorites);
  const [showHidden, setShowHidden] = useState(false);
  const [query, setQuery] = useState('');
  const [pathDraft, setPathDraft] = useState('');
  // A note from the System: { text, error } — a failure reads in alert, a
  // confirmation (copied) reads quiet. null = nothing to say.
  const [note, setNote] = useState(null);
  const fail = (e) => setNote({ text: e.message, error: true });
  // NEW FOLDER — an inline name row in the foot; creating navigates INTO
  // the new folder so OPEN picks it immediately.
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState('');
  const { pos, panelRef, startDrag } = usePickerDrag(draggable);

  // Navigate into a directory. On error, keep the prior location and show why
  // (e.g. a permission-denied folder) rather than emptying the picker.
  const go = useCallback(async (target) => {
    setNote(null);
    setEntries(null);
    try {
      const r = await browseDir(target, { includeFiles: pickFile });
      setCwd(r.path);
      setParent(r.parent);
      setHome(r.home);
      setEntries(r.entries);
      setPathDraft(r.path);
      setQuery('');
    } catch (e) {
      setNote({ text: e.message, error: true });
      setEntries((prev) => prev || []);
    }
  }, [pickFile]);

  // First load defaults to home when no initialPath; recents/drives are best-effort.
  useEffect(() => { go(initialPath || ''); }, [go, initialPath]);
  useEffect(() => { listRecents().then(setRecents).catch(() => {}); }, []);
  useEffect(() => { listDrives().then(setDrives).catch(() => {}); }, []);
  // PINNED is the witness shelf the Explorer shows — hear its pins live.
  useEffect(() => {
    const refresh = () => setFavorites(loadShelf().favorites);
    window.addEventListener('neuma:folder-shelf', refresh);
    return () => window.removeEventListener('neuma:folder-shelf', refresh);
  }, []);

  const sections = useMemo(() => railSections({ home, drives, favorites, recents }), [home, drives, favorites, recents]);
  const activePath = activeRailPath(cwd, sections.flatMap((s) => s.items.map((i) => i.path)));
  const rows = visibleEntries(entries, { showHidden, query });

  const makeFolder = async () => {
    const name = folderName.trim();
    if (!cwd || !name) return;
    setNote(null);
    try {
      const created = await createBrowseFolder(cwd, name);
      setCreating(false);
      setFolderName('');
      go(created);
    } catch (e) {
      fail(e);
    }
  };

  // --- Right-click while browsing (Design note, 2026-07-24. Rows carry their own
  // menu; the list's empty space carries the CURRENT folder's. Pinning writes
  // the same witness shelf the Explorer shows — the rail hears the event live.
  const [ctx, setCtx] = useState(null); // { at:{x,y}, entry, items }

  const openRowMenu = (e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    const pinned = entry.dir !== false && isFavorite(loadShelf(), entry.path);
    setCtx({ at: { x: e.clientX, y: e.clientY }, entry, items: pickerMenuItems({ entry, pinned, pickFile }) });
  };

  const openListMenu = (e) => {
    if (!cwd) return;
    e.preventDefault();
    const entry = { path: cwd, dir: true, name: baseName(cwd) };
    const pinned = isFavorite(loadShelf(), cwd);
    setCtx({ at: { x: e.clientX, y: e.clientY }, entry, items: pickerMenuItems({ entry, pinned, pickFile, background: true }) });
  };

  const onMenuAct = async (id) => {
    const entry = ctx?.entry;
    if (!entry) return;
    setNote(null);
    switch (id) {
      case 'enter': go(entry.path); break;
      case 'pick': onPick(entry.path); break;
      case 'choose-file': onPick(entry.path); break;
      case 'new-folder-here': setCreating(true); break;
      case 'pin':
        saveShelf(toggleFavorite(loadShelf(), entry.path));
        window.dispatchEvent(new CustomEvent('neuma:folder-shelf'));
        break;
      case 'copy-path':
        try {
          await navigator.clipboard.writeText(entry.path);
          setNote({ text: `Copied — ${entry.path}`, error: false });
        } catch (err) { fail(err); }
        break;
      default: break;
    }
  };

  // Escape anywhere in the dialog closes it; the inputs claim their own
  // Escape first (clear the filter, revert the path, cancel a new folder).
  const onDialogKey = (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !ctx) onCancel();
  };

  return (
    <div className="picker-overlay" onMouseDown={onCancel}>
      <div
        className={`picker cham${draggable ? ' is-draggable' : ''}`}
        ref={panelRef}
        style={pos ? { left: pos.x, top: pos.y, height: pos.h, bottom: 'auto', transform: 'none' } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onDialogKey}
        role="dialog"
        aria-modal="true"
        aria-label={pickFile ? 'Choose file' : 'Open folder'}
      >
        {/* the Raphael entrance: a line of light draws, the panel unfolds from it */}
        <span className="picker-light" aria-hidden="true" />
        <div className="picker-in cham-in">
          <div className="picker-head" onPointerDown={startDrag}>
            <span className="picker-emblem"><EmblemGlyph /></span>
            <span className="picker-title">{pickFile ? 'CHOOSE FILE' : 'OPEN FOLDER'}</span>
            <span className="picker-head-rule" aria-hidden="true" />
            <span className="picker-head-meta">{draggable ? 'DRAG TO MOVE' : 'DISK'}</span>
            <button type="button" className="picker-x" onClick={onCancel} aria-label="Close picker">×</button>
          </div>

          <PickerAddress
            cwd={cwd} parent={parent} home={home}
            draft={pathDraft} onDraft={setPathDraft}
            onGo={go} onCancel={onCancel}
          />

          <div className="picker-body">
            <PickerRail
              sections={sections}
              activePath={activePath}
              onGo={go}
              onOpen={(p) => (pickFile ? go(p) : onPick(p))}
            />
            <PickerList
              cwd={cwd} entries={entries} rows={rows} pickFile={pickFile}
              query={query} onQuery={setQuery}
              showHidden={showHidden} onToggleHidden={() => setShowHidden((s) => !s)}
              onEnter={go} onPick={onPick} onUp={() => parent && go(parent)}
              onRowMenu={openRowMenu} onListMenu={openListMenu}
            />
          </div>

          {note ? <div className={`picker-err${note.error ? ' is-error' : ''}`} role="status">{note.text}</div> : null}

          <div className="picker-foot">
            <div className="picker-target">
              <span className="picker-target-label">{pickFile ? 'IN' : 'TARGET'}</span>
              <span className="picker-cwd" title={cwd || ''}><bdi>{cwd || ''}</bdi></span>
            </div>
            <span className="picker-foot-actions">
              {creating ? (
                <span className="picker-newfolder">
                  <input
                    className="picker-newfolder-input"
                    autoFocus
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') makeFolder();
                      if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setFolderName(''); }
                    }}
                    placeholder="Folder name"
                    spellCheck={false}
                    aria-label="New folder name"
                  />
                  <button type="button" className="picker-newfolder-go" onClick={makeFolder} disabled={!folderName.trim()}>
                    CREATE
                  </button>
                </span>
              ) : (
                <button type="button" className="picker-newfolder-open" onClick={() => setCreating(true)} disabled={!cwd}>
                  NEW FOLDER
                </button>
              )}
              <button type="button" className="picker-cancel" onClick={onCancel}>CANCEL</button>
              {/* A folder is not a valid pick in file mode — choose a file row. */}
              {pickFile ? null : (
                <button type="button" className="picker-open" onClick={() => cwd && onPick(cwd)} disabled={!cwd}>
                  <span className="picker-open-verb">OPEN</span>
                  {cwd ? <span className="picker-open-name">{baseName(cwd)}</span> : null}
                </button>
              )}
            </span>
          </div>
        </div>
      </div>

      {ctx ? <CtxMenu at={ctx.at} items={ctx.items} onAct={onMenuAct} onClose={() => setCtx(null)} /> : null}
    </div>
  );
};
