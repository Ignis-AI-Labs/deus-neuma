// FilesApp — the VS Code-style file explorer, hosted in the Explorer rail.
//
// The operator opens folders ("roots") and browses the real files inside
// them: a lazy folder tree (dirs first, every file including dotfiles —
// .git, .gitignore, the lot). Design note, 2026-08-17: nothing is hidden from him.
// Clicking a file opens it in ITS OWN floating EDITOR window (never
// squeezed into this rail): one window per file, re-click focuses the
// window it already has. Every path is re-validated by the backend against
// the open roots — this surface never escapes them, and an open root can't
// be renamed or deleted.
//
// There is exactly ONE open-folder affordance in the explorer — the panel
// header's, riding the shared FolderOpenFlow (witness law: no duplicated
// gestures). An inline picker here rendered clipped inside the rail, which
// is why it is gone.
//
// PANEL-ONLY (D12): this Body is HOSTED by the ExplorerPanel rail — the one
// mount anywhere; the floating FILES window is retired (registry panel flag).
// `focusRoots` (D6) scopes which open roots the tree SHOWS — display only,
// every file operation is still backend-validated against the open roots.

import { baseName, dirOf } from '../../../utils/path.js';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import './FilesApp.css';
import {
  closeFolder, createEntry, renamePath, deletePath,
} from '../../../services/user-files.js';
import { dragCarriesFiles } from './files-drop.js';
import { useFilesRoots } from './use-files-roots.js';
import { useFilesDnd } from './use-files-dnd.js';
import { applyRowClick, EMPTY_SELECTION, visiblePaths } from './tree-selection.js';
import { deleteSetFor, isUnder } from './delete-set.js';
import { DeleteConfirm } from './DeleteConfirm.jsx';
import { FilesIcon } from './files-glyphs.jsx';
import { FileNode } from './FileNode.jsx';
import { useProjects } from '../projects/project-context.js';
import { FocusContext } from '../use-desk-focus.js';
import { releaseFocusOnRootClose } from '../desk-focus.js';
import { useWindows } from '../../windowing/use-windows.js';
import { isImagePath } from './image-view-model.js';
import { appIdOf } from '../../windowing/window-manager-reducer.js';
import { AppTitle } from '../app-title.jsx';
import { CtxMenu } from '../CtxMenu.jsx';
import { treeMenuItems } from './files-menu.js';
import { isFavorite, toggleFavorite } from '../folder-shelf.js';
import { loadDeskPrefs, loadShelf, saveDeskPrefs, saveShelf } from '../../windowing/window-storage.js';
import { useOpenFolder } from '../projects/use-open-folder.js';

const joinPath = (dir, name) => `${dir.replace(/\/+$/, '')}/${name}`;

const FilesBody = ({ focusRoots = null }) => {
  const [roots, setRoots] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [childrenMap, setChildrenMap] = useState({});
  const [showHidden, setShowHidden] = useState(true);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [note, setNote] = useState('');
  const [prompt, setPrompt] = useState(null); // {kind:'new-file'|'new-folder'|'rename', dir?, entry?, value}
  const [confirmDel, setConfirmDel] = useState(null); // [{path,name,type}] — the popup's delete set
  const rootsRef = useRef([]);

  const projects = useProjects();
  const activeFolder = projects?.activeProject?.folder;
  // THIS window's focus lens — read for the D9 root-close release only.
  const focusLens = useContext(FocusContext);
  // File clicks spawn EDITOR windows through the desk's window manager.
  const windows = useWindows();

  useEffect(() => { rootsRef.current = roots || []; }, [roots]);

  // Roots/git/dir refresh machinery — the calm poll and the announcement
  // listeners as ONE unit (live-watch RCA law; use-files-roots.js).
  const { gitByRoot, refreshGit, refreshDir } = useFilesRoots({
    activeFolder, expanded, setExpanded, rootsRef, setRoots, setNote, setChildrenMap,
  });

  const toggleDir = useCallback(async (entry) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path);
      return next;
    });
    if (!childrenMap[entry.path]) await refreshDir(entry.path);
  }, [childrenMap, refreshDir]);

  // A file opens in ITS OWN editor window (witness law). One window per
  // file: a re-click focuses the window the file already has instead of
  // spawning a duplicate.
  const openFileAt = useCallback((entry) => {
    if (!windows) return;
    // A document gets the READER, a picture the VIEWER, everything else the
    // editor (Design note, 2026-07-29: […]; 2026-08-30:
    // […]). Same one-window-per-file law: a re-click focuses the window the
    // file already has.
    const name = entry.name || entry.path;
    const appId = /\.pdf$/i.test(name) ? 'pdf'
      : isImagePath(name) ? 'image'
        : 'editor';
    const existing = windows.state.windows.find((w) => appIdOf(w.id) === appId && w.payload === entry.path);
    if (existing) windows.dispatch({ type: 'FOCUS', id: existing.id });
    else windows.dispatch({ type: 'OPEN_NEW', appId, payload: entry.path });
  }, [windows]);

  const removeRoot = useCallback(async (root) => {
    try {
      setRoots(await closeFolder(root));
      setExpanded((prev) => { const n = new Set(prev); n.delete(root); return n; });
      // D9 (second half): closing the focused folder's root releases this
      // window's focus LOUDLY — the strip empties, nothing refocuses.
      if (focusLens && releaseFocusOnRootClose(focusLens.focus, root)) {
        focusLens.setFocus(null);
        setNote(`Working focus released — ${baseName(root)} closed`);
      }
    } catch (e) { setNote(e.message); }
  }, [focusLens]);

  // THE TWO-WAY BRIDGE (ruling, 2026-07-28): OS ⇄ Explorer drag — dropPath plus
  // the four drag handlers (use-files-dnd.js).
  const { dropPath, setDropPath, onDragOut, onDragOverRow, onDragLeaveRow, onDropFiles } = useFilesDnd({
    rootsRef, setNote, refreshDir, refreshGit,
  });

  // --- Create / rename / delete (one inline prompt bar, no native dialogs) ---

  // One act over the whole delete set. Failures are named in the note, and
  // the popup closes either way — the honest retry is a fresh gesture, never
  // a stale ask offering paths that may already be gone.
  const deleteEntries = useCallback(async (entries) => {
    setNote('');
    const landed = [];
    const failed = [];
    for (const entry of entries) {
      try { await deletePath(entry.path); landed.push(entry); } catch (e) { failed.push(`${entry.name}: ${e.message}`); }
    }
    if (landed.length) {
      setExpanded((prev) => new Set([...prev].filter((p) => !landed.some((d) => p === d.path || isUnder(p, d.path)))));
      // Every editor/reader window on a deleted file — or under a deleted
      // folder — closes with it: never a stranded buffer saving into a path
      // that no longer exists.
      for (const w of windows?.state.windows ?? []) {
        if (['editor', 'pdf', 'image'].includes(appIdOf(w.id)) && landed.some((d) => w.payload === d.path || isUnder(w.payload, d.path))) {
          windows.dispatch({ type: 'CLOSE', id: w.id });
        }
      }
      setSelection(EMPTY_SELECTION); // what stood selected is gone — nothing lingers
      for (const dir of [...new Set(landed.map((d) => dirOf(d.path)))]) await refreshDir(dir);
      refreshGit(rootsRef.current); // the deletion moved the working tree — badges follow
    }
    const bits = [];
    if (landed.length) bits.push(landed.length === 1 ? `Deleted ${landed[0].name}` : `Deleted ${landed.length} items`);
    if (failed.length) bits.push(`refused: ${failed.join(' · ')}`);
    setNote(bits.join(' — '));
    setConfirmDel(null);
    return failed.length === 0 && landed.length > 0;
  }, [refreshDir, refreshGit, windows]);

  const startNew = useCallback((kind, dir) => { setConfirmDel(null); setPrompt({ kind, dir: dir.path, value: '' }); }, []);
  const startRename = useCallback((entry) => { setConfirmDel(null); setPrompt({ kind: 'rename', entry, value: entry.name }); }, []);
  // The destructive gesture asks first — unless the witness has said […] (desk prefs; Settings › GENERAL turns the asking back on).
  // The pref is read at gesture time so a Settings flip needs no remount.
  const [noAskDraft, setNoAskDraft] = useState(false); // the popup's chip, armed per ask
  const askDelete = useCallback((entry) => {
    setPrompt(null);
    // A gesture inside the standing selection takes the WHOLE selection
    // (file-manager grammar, Design note, 2026-08-16; open roots refuse, descendants
    // fold into their selected ancestor (delete-set.js).
    const paths = deleteSetFor(selection.paths, entry.path, rootsRef.current);
    if (!paths.length) return;
    const entries = paths.map((p) => (p === entry.path
      ? { path: p, name: entry.name, type: entry.type }
      : { path: p, name: baseName(p), type: (childrenMap[dirOf(p)] || []).find((e) => e.path === p)?.type ?? 'file' }));
    if (!loadDeskPrefs().confirmDelete) { deleteEntries(entries); return; }
    setNoAskDraft(false);
    setConfirmDel(entries);
  }, [selection, childrenMap, deleteEntries]);

  const submitPrompt = useCallback(async () => {
    if (!prompt) return;
    const name = prompt.kind === 'rename' ? prompt.value : prompt.value.trim();
    if (prompt.kind === 'rename' && name === prompt.entry.name) { setPrompt(null); return; }
    if (!name.trim()) return;
    setNote('');
    try {
      if (prompt.kind === 'rename') {
        const r = await renamePath(prompt.entry.path, joinPath(dirOf(prompt.entry.path), name));
        await refreshDir(dirOf(prompt.entry.path));
        // An editor window open on the renamed file follows it (REPAYLOAD) —
        // never left pointing at a path the tree no longer knows.
        windows?.dispatch({ type: 'REPAYLOAD', appId: 'editor', from: prompt.entry.path, to: r.path });
      } else {
        await createEntry(joinPath(prompt.dir, name), prompt.kind === 'new-folder' ? 'dir' : 'file');
        setExpanded((prev) => new Set(prev).add(prompt.dir));
        await refreshDir(prompt.dir);
      }
      refreshGit(rootsRef.current); // the mutation moved the working tree — badges follow
      setPrompt(null);
    } catch (e) { setNote(e.message); }
  }, [prompt, refreshDir, refreshGit, windows]);

  const doDelete = useCallback(async () => {
    if (!confirmDel) return;
    const clean = await deleteEntries(confirmDel);
    // "Don't ask again" binds ONLY to a delete that landed CLEAN — a
    // cancelled ask silences nothing, and any failure keeps the guard: the
    // witness never waives a confirmation they haven't seen work.
    if (clean && noAskDraft) {
      saveDeskPrefs({ ...loadDeskPrefs(), confirmDelete: false });
      window.dispatchEvent(new CustomEvent('neuma:desk-prefs'));
    }
  }, [confirmDel, noAskDraft, deleteEntries]);

  // --- The row right-click menu (ruling, 2026-07-24): every row action the tree
  // offers, plus the shelf pin and the focus lens. Items derive pure
  // (files-menu.js); pinned state reads the shelf at open time.
  const { openFolder } = useOpenFolder();
  const [ctx, setCtx] = useState(null); // { at:{x,y}, entry, isRoot, items }

  const openMenu = useCallback((e, entry, isRoot) => {
    e.preventDefault();
    e.stopPropagation();
    const pinned = entry.type === 'dir' && isFavorite(loadShelf(), entry.path);
    setCtx({
      at: { x: e.clientX, y: e.clientY },
      entry,
      items: treeMenuItems({ entry, isRoot, pinned }),
    });
  }, []);

  const onMenuAct = useCallback(async (id) => {
    const entry = ctx?.entry;
    if (!entry) return;
    setNote('');
    switch (id) {
      case 'open-file': openFileAt(entry); break;
      case 'show-in-folder': {
        if (typeof window !== 'undefined' && window.neuma && typeof window.neuma.showInFolder === 'function') {
          const r = await window.neuma.showInFolder(entry.path);
          if (!r?.ok) setNote('The OS file manager would not take that path.');
        } else {
          setNote('Opening the containing folder needs the desktop shell.');
        }
        break;
      }
      case 'open-in-browser': {
        if (typeof window !== 'undefined' && window.neuma && typeof window.neuma.openInBrowser === 'function') {
          const r = await window.neuma.openInBrowser(entry.path);
          if (!r?.ok) setNote('The browser would not take that file.');
        } else {
          setNote('Opening in a browser needs the desktop shell.');
        }
        break;
      }
      case 'focus': {
        const r = await openFolder(entry.path);
        if (r.status !== 'opened') setNote(r.message || 'Folder would not open.');
        break;
      }
      case 'refresh': {
        // Manual truth on demand (Design note, 2026-08-16: […])
        // — rides the SAME files-changed bus as the live watch: {bulk}
        // re-lists the subtree, {path} re-lists the parent so a row deleted
        // behind the desk's back leaves the tree. Roots have no parent here.
        const dir = entry.type === 'dir' ? entry.path : dirOf(entry.path);
        window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { bulk: dir } }));
        if (!rootsRef.current.includes(dir)) {
          window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { path: dir } }));
        }
        break;
      }
      case 'new-file': startNew('new-file', entry); break;
      case 'new-folder': startNew('new-folder', entry); break;
      case 'rename': startRename(entry); break;
      case 'delete': askDelete(entry); break;
      case 'pin':
        saveShelf(toggleFavorite(loadShelf(), entry.path));
        window.dispatchEvent(new CustomEvent('neuma:folder-shelf'));
        break;
      case 'copy-path':
        try {
          await navigator.clipboard.writeText(entry.path);
          setNote(`Copied — ${entry.path}`);
        } catch (e) { setNote(e.message); }
        break;
      case 'close-root': removeRoot(entry.path); break;
      default: break;
    }
  }, [ctx, openFileAt, openFolder, startNew, startRename, askDelete, removeRoot]);

  // D6 scoping — the lens narrows what the tree SHOWS, never what is open:
  // the intersection with the really-open roots. null focusRoots = unscoped.
  const shownRoots = roots === null ? null : (focusRoots ? roots.filter((r) => focusRoots.includes(r)) : roots);

  // One click, three grammars (ruling, 2026-08-16): plain = select one and still
  // toggle/open; ctrl(meta) = toggle membership; shift = range over the rows
  // as rendered. A modified click only SELECTS — expanding or opening under
  // ctrl/shift would fight the gesture the operator is making.
  const onRowClick = useCallback((e, entry, isDir) => {
    const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey };
    if (mods.ctrl || mods.shift) {
      const order = visiblePaths({ roots: shownRoots || [], expanded, childrenMap, showHidden });
      setSelection((s) => applyRowClick(s, entry.path, mods, order));
      return;
    }
    setSelection((s) => applyRowClick(s, entry.path, mods));
    if (isDir) toggleDir(entry); else openFileAt(entry);
  }, [shownRoots, expanded, childrenMap, showHidden, toggleDir, openFileAt]);

  const treeActions = {
    onRowClick, onToggleDir: toggleDir, onOpenFile: openFileAt, onRemoveRoot: removeRoot,
    onNew: startNew, onRename: startRename, onDelete: askDelete, onMenu: openMenu,
    onDragOut, onDragOverRow, onDragLeaveRow, onDropFiles, dropPath,
  };

  return (
    <div className="files">
      <div className="files-bar">
        <button type="button" className={`files-toggle${showHidden ? ' on' : ''}`} onClick={() => setShowHidden((s) => !s)}>
          DOTFILES {showHidden ? 'ON' : 'OFF'}
        </button>
      </div>

      {prompt ? (
        <div className="files-prompt">
          <span className="files-prompt-label label-data">
            {prompt.kind === 'rename'
              ? `RENAME ${prompt.entry.name}`
              : `${prompt.kind === 'new-folder' ? 'NEW FOLDER' : 'NEW FILE'} in ${baseName(prompt.dir)}`}
          </span>
          <input
            className="files-prompt-input"
            autoFocus
            value={prompt.value}
            onChange={(e) => setPrompt((p) => ({ ...p, value: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') submitPrompt(); if (e.key === 'Escape') setPrompt(null); }}
            placeholder="name"
            spellCheck={false}
          />
          <button type="button" className="files-prompt-go" onClick={submitPrompt}>{prompt.kind === 'rename' ? 'RENAME' : 'CREATE'}</button>
          <button type="button" className="files-prompt-x" onClick={() => setPrompt(null)}>CANCEL</button>
        </div>
      ) : null}

      <div
        className="files-main"
        onDragOver={(e) => {
          if (!dragCarriesFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          // Rows stopPropagation, so only a drop on the BARE pane lands here
          // — and the pane is no folder: the explorer says so rather than
          // guessing one the witness never chose.
          if (!dragCarriesFiles(e.dataTransfer)) return;
          e.preventDefault();
          setDropPath(null);
          setNote('Drop onto a folder — the file needs a place to land.');
        }}
      >
        <div className="files-tree">
          {shownRoots === null ? (
            <p className="files-treenote label-data">LOADING…</p>
          ) : roots.length === 0 ? (
            <p className="files-treenote label-data">NO FOLDERS OPEN</p>
          ) : shownRoots.length === 0 ? (
            <p className="files-treenote label-data">NO OPEN FOLDERS IN THIS FOCUS</p>
          ) : shownRoots.map((root) => (
            <FileNode
              key={root} entry={{ path: root, type: 'dir', name: baseName(root) }} depth={0} isRoot
              expanded={expanded} childrenMap={childrenMap} showHidden={showHidden}
              rootPath={root} gitFiles={gitByRoot[root]?.files ?? null} gitIgnored={gitByRoot[root]?.ignored ?? null}
              selected={selection.paths} actions={treeActions}
            />
          ))}
        </div>
      </div>

      {note ? <div className="files-note label-data">{note}</div> : null}

      {ctx ? <CtxMenu at={ctx.at} items={ctx.items} onAct={onMenuAct} onClose={() => setCtx(null)} /> : null}

      {confirmDel ? (
        <DeleteConfirm
          entries={confirmDel}
          noAsk={noAskDraft}
          onNoAsk={() => setNoAskDraft((v) => !v)}
          onDelete={doDelete}
          onCancel={() => setConfirmDel(null)}
        />
      ) : null}
    </div>
  );
};

export const filesApp = {
  label: 'FILES',
  labelKey: 'apps.files',
  icon: <FilesIcon />,
  title: <AppTitle label="FILES" labelKey="apps.files" />,
  Body: FilesBody,
  storageKey: 'files',
  // Panel-only law (D12): FILES lives in the Explorer rail. The dock and the
  // palette toggle the panel; the window manager never floats a panel app.
  panel: true,
};
