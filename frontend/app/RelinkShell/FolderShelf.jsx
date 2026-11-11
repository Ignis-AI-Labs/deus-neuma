// FolderShelf — FAVORITES / RECENTS under the Explorer tree (D6 rail), the
// slot VS Code gives Outline/Timeline, repurposed as the witness asked
// (2026-07-24): folder MACROS, not a second tree. Every row is an absolute
// folder path; clicking it re-runs the ONE open-folder gesture (useOpenFolder,
// D5) — the folder lands as THIS window's working focus exactly as if picked
// by hand, which also bumps it to the head of RECENTS. RECENTS self-populates
// from the gesture; FAVORITES holds only what the witness pins. The shelf is
// wallet-scoped, window-shared state (window-storage walletKey); section
// collapse is per-window like panel collapse. LINE & CYCLE: --font-data
// labels, monochrome at rest, SIGNAL on live interaction, var(--token) only.

import { useCallback, useEffect, useState } from 'react';
import './FolderShelf.css';
import {
  isFavorite, removeRecent, shelfEntryLabel, toggleFavorite,
} from './folder-shelf.js';
import {
  loadShelf, saveShelf, loadShelfSections, saveShelfSections,
} from '../windowing/window-storage.js';
import { useOpenFolder } from './use-open-folder.js';
import { CtxMenu } from './CtxMenu.jsx';
import { shelfMenuItems } from './files/files-menu.js';

const Caret = ({ open }) => (
  <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
    {open ? <path d="M1 3 L5 7 L9 3 Z" /> : <path d="M3 1 L7 5 L3 9 Z" />}
  </svg>
);

const PinGlyph = ({ filled }) => (
  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M5 1 L9 5 L5 9 L1 5 Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const Row = ({ path, pinned, onOpen, onPin, onDismiss, onMenu }) => {
  const { name, hint } = shelfEntryLabel(path);
  return (
    <li className="xps-row" onContextMenu={(e) => onMenu(e, path, pinned, Boolean(onDismiss))}>
      <button type="button" className="xps-go" title={path} onClick={() => onOpen(path)}>
        <span className="xps-name">{name}</span>
        {hint ? <span className="xps-hint label-data">{hint}</span> : null}
      </button>
      <span className="xps-acts">
        <button
          type="button"
          className={`xps-pin${pinned ? ' is-pinned' : ''}`}
          title={pinned ? 'Unpin from favorites' : 'Pin to favorites'}
          aria-label={pinned ? `Unpin ${name} from favorites` : `Pin ${name} to favorites`}
          onClick={() => onPin(path)}
        >
          <PinGlyph filled={pinned} />
        </button>
        {onDismiss ? (
          <button
            type="button"
            className="xps-x"
            title="Remove from recents"
            aria-label={`Remove ${name} from recents`}
            onClick={() => onDismiss(path)}
          >
            ×
          </button>
        ) : null}
      </span>
    </li>
  );
};

const Section = ({ id, title, open, count, empty, onToggle, children }) => (
  <section className={`xps xps-${id}`}>
    <button type="button" className="xps-head" aria-expanded={open} onClick={onToggle}>
      <Caret open={open} />
      <span className="xps-title">{title}</span>
      {count > 0 ? <span className="xps-count">{count}</span> : null}
    </button>
    {open ? (
      count > 0
        ? <ul className="xps-list">{children}</ul>
        : <p className="xps-empty label-data">{empty}</p>
    ) : null}
  </section>
);

export const FolderShelf = () => {
  const { openFolder } = useOpenFolder();
  const [shelf, setShelf] = useState(loadShelf);
  const [sections, setSections] = useState(loadShelfSections);
  const [note, setNote] = useState('');

  // The gesture (this window) and sibling desk windows (storage event) both
  // move the one shared shelf — either way, re-read the persisted truth.
  useEffect(() => {
    const refresh = () => setShelf(loadShelf());
    window.addEventListener('neuma:folder-shelf', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('neuma:folder-shelf', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const commit = useCallback((next) => {
    saveShelf(next);
    setShelf(loadShelf());
  }, []);

  const open = useCallback((path) => {
    setNote('');
    // The gesture records the recent and fires the refresh event itself.
    openFolder(path).then(({ status, message }) => {
      if (status !== 'opened') setNote(message || 'Folder would not open.');
    });
  }, [openFolder]);

  const pin = useCallback((path) => commit(toggleFavorite(loadShelf(), path)), [commit]);
  const dismiss = useCallback((path) => commit(removeRecent(loadShelf(), path)), [commit]);

  const toggleSection = useCallback((which) => {
    setSections((prev) => {
      const next = { ...prev, [which]: !prev[which] };
      saveShelfSections(next);
      return next;
    });
  }, []);

  // The rows' right-click menu — the macros' own gestures, spelled out.
  const [ctx, setCtx] = useState(null); // { at:{x,y}, path, items }

  const openRowMenu = useCallback((e, path, pinned, recent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ at: { x: e.clientX, y: e.clientY }, path, items: shelfMenuItems({ pinned, recent }) });
  }, []);

  const onMenuAct = useCallback(async (id) => {
    const path = ctx?.path;
    if (!path) return;
    switch (id) {
      case 'open': open(path); break;
      case 'pin': pin(path); break;
      case 'dismiss': dismiss(path); break;
      case 'copy-path':
        try {
          await navigator.clipboard.writeText(path);
          setNote(`Copied — ${path}`);
        } catch (e) { setNote(e.message); }
        break;
      default: break;
    }
  }, [ctx, open, pin, dismiss]);

  return (
    <div className="xp-shelf">
      <Section
        id="favorites"
        title="FAVORITES"
        open={sections.favorites}
        count={shelf.favorites.length}
        empty="NOTHING PINNED YET"
        onToggle={() => toggleSection('favorites')}
      >
        {shelf.favorites.map((p) => (
          <Row key={p} path={p} pinned onOpen={open} onPin={pin} onMenu={openRowMenu} />
        ))}
      </Section>
      <Section
        id="recents"
        title="RECENTS"
        open={sections.recents}
        count={shelf.recents.length}
        empty="NO FOLDERS OPENED YET"
        onToggle={() => toggleSection('recents')}
      >
        {shelf.recents.map((p) => (
          <Row key={p} path={p} pinned={isFavorite(shelf, p)} onOpen={open} onPin={pin} onDismiss={dismiss} onMenu={openRowMenu} />
        ))}
      </Section>
      {note ? <p className="xps-note label-data">{note}</p> : null}

      {ctx ? <CtxMenu at={ctx.at} items={ctx.items} onAct={onMenuAct} onClose={() => setCtx(null)} /> : null}
    </div>
  );
};
