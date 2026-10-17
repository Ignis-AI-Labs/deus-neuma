// GalleryApp — every image and video NEUMA can reach, in one place.
//
// Design note, 2026-08-01: […]
//
// Its own window rather than a pane inside COMFY, because renders are only one
// source: ComfyUI's output is the built-in root, and the operator adds folders
// to widen the reach. Adding a folder IS the grant — the backend can read
// nothing else (gallery-roots.js).
//
// Display state is a pure fold (gallery-view.js); everything here is IO and
// layout.
//
// The media is loaded BY THE BROWSER — plain `<img src>` and `<video src>`
// pointed at /file, with the session token in the query. It is a gallery; the
// engine that has spent thirty years learning to load, decode, cache and evict
// images should be the one doing it. What was here before fetched every tile by
// hand into an object URL and hung two IntersectionObservers off each one to
// load and release it, which meant: no HTTP cache (so scrolling back re-pulled
// megabytes), no progressive decode, and every thumbnail spending one of the
// wallet's 200 requests/minute — opening the window answered the operator with
// "Too many requests" and a grid of black squares.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { getItems, getRoots, addRoot, removeRoot, fileSrc } from '../../../services/gallery-client.js';
import {
  applyView, groupByDay, readableBytes, itemKey, neighborOf, positionOf, KINDS, SORTS,
} from './gallery-view.js';
import { AppTitle } from '../app-title.jsx';
import { Viewer, markMissing, clearMissing } from './Viewer.jsx';
import './GalleryApp.css';

const GalleryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="1.5" y="3" width="13" height="10" />
    <circle cx="5.5" cy="6.5" r="1.2" />
    <path d="M2 12 L6 8.5 L8.5 10.5 L12 7 L14.5 9.5" />
  </svg>
);

const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="10" cy="10" r="8" />
    <path d="M8 6.5 L14 10 L8 13.5 Z" fill="currentColor" />
  </svg>
);

// `loading="lazy"` is the browser's own: it defers the request until the tile
// nears the viewport and, unlike a hand-rolled observer, it also lets the
// engine evict decoded bitmaps under memory pressure. There is no thumbnail
// endpoint, so a tile is the FULL-SIZE file — which is why the cache headers on
// /file matter as much as the laziness does.
const Tile = ({ item, onOpen }) => (
  <button type="button" className="gallery-tile" onClick={() => onOpen(item)} title={item.name}>
    {item.kind === 'image' ? (
      <img
        className="gallery-tile-img"
        src={fileSrc(item)}
        alt={item.name}
        loading="lazy"
        decoding="async"
        onError={markMissing}
        onLoad={clearMissing}
      />
    ) : (
      // A video tile does NOT load its bytes — a grid of videos would pull
      // gigabytes to draw thumbnails. It shows its identity and plays on open.
      <span className="gallery-tile-video" aria-hidden="true"><PlayIcon /></span>
    )}
    <span className="gallery-tile-name label-data">{item.name}</span>
    <span className="gallery-tile-meta label-data">{readableBytes(item.bytes)}</span>
  </button>
);

const GalleryBody = () => {
  const [items, setItems] = useState([]);
  const [roots, setRoots] = useState([]);
  const [view, setView] = useState({ kind: 'all', rootId: null, query: '', sort: 'newest' });
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState('');
  const alive = useRef(true);

  const load = async () => {
    setBusy(true);
    try {
      const res = await getItems();
      if (!alive.current) return;
      setItems(res.items || []);
      setRoots(res.roots || []);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e.message);
    }
    if (alive.current) setBusy(false);
  };

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, []);

  const { items: shown, counts } = useMemo(() => applyView(items, view), [items, view]);
  const days = useMemo(() => groupByDay(shown), [shown]);

  const onAdd = async () => {
    const dir = adding.trim();
    if (!dir) return;
    uiSound('toggle');
    setBusy(true);
    try {
      await addRoot(dir);
      setAdding('');
      setError(null);
      await load();
    } catch (e) { if (alive.current) { setError(e.message); setBusy(false); } }
  };

  const onRemove = async (id) => {
    uiSound('toggle');
    try { await removeRoot(id); await load(); } catch (e) { setError(e.message); }
  };

  const set = (patch) => setView((v) => ({ ...v, ...patch }));

  // Stepping walks the view the operator is looking at. At either end the move
  // is simply refused — wrapping around with no cue makes a long gallery
  // impossible to keep your place in.
  const onStep = useCallback((delta) => {
    setOpen((cur) => neighborOf(shown, cur, delta) || cur);
  }, [shown]);

  // A filter change can hide whatever is open; close rather than show an item
  // the current view no longer contains.
  useEffect(() => {
    if (open && !shown.some((it) => itemKey(it) === itemKey(open))) setOpen(null);
  }, [shown, open]);

  return (
    <div className="gallery">
      <div className="gallery-bar">
        <div className="gallery-kinds">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`gallery-act${view.kind === k ? ' is-on' : ''}`}
              onClick={() => { uiSound('toggle'); set({ kind: k }); }}
            >
              {k.toUpperCase()} <span className="gallery-count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <input
          className="gallery-search"
          type="search"
          placeholder="search by name"
          value={view.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <div className="gallery-sorts">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`gallery-act${view.sort === s.id ? ' is-on' : ''}`}
              onClick={() => { uiSound('toggle'); set({ sort: s.id }); }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" className="gallery-act" disabled={busy} onClick={() => { uiSound('toggle'); load(); }}>
          {busy ? 'READING…' : 'REFRESH'}
        </button>
      </div>

      <div className="gallery-body">
        <aside className="gallery-roots">
          <span className="label-data gallery-roots-head">FOLDERS</span>
          <button
            type="button"
            className={`gallery-root${view.rootId === null ? ' is-on' : ''}`}
            onClick={() => { uiSound('toggle'); set({ rootId: null }); }}
          >
            <span className="gallery-root-label">ALL</span>
            <span className="gallery-count">{items.length}</span>
          </button>
          {roots.map((r) => (
            <div key={r.id} className="gallery-root-row">
              <button
                type="button"
                className={`gallery-root${view.rootId === r.id ? ' is-on' : ''}${r.error ? ' is-bad' : ''}`}
                onClick={() => { uiSound('toggle'); set({ rootId: r.id }); }}
                title={r.dir}
              >
                <span className="gallery-root-label">{r.label}</span>
                <span className="gallery-count">{r.error ? '—' : r.count}</span>
              </button>
              {r.builtIn ? null : (
                <button type="button" className="gallery-root-drop" onClick={() => onRemove(r.id)} aria-label={`Stop reading ${r.label}`}>×</button>
              )}
              {r.error ? <span className="gallery-root-err">{r.error}</span> : null}
              {r.truncated ? <span className="gallery-root-err">showing the first {r.count} — folder is larger</span> : null}
            </div>
          ))}
          <div className="gallery-add">
            <input
              className="gallery-search"
              type="text"
              placeholder="/path/to/folder"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
            />
            <button type="button" className="gallery-act" disabled={!adding.trim() || busy} onClick={onAdd}>ADD FOLDER</button>
          </div>
          <p className="gallery-note">
            The gallery reads these folders and nothing else. Adding a folder is
            what grants access to it.
          </p>
        </aside>

        <div className="gallery-grid-wrap">
          {error ? <p className="gallery-err">{error}</p> : null}
          {shown.length === 0 && !busy ? (
            <p className="gallery-note">
              {items.length === 0
                ? 'Nothing in reach yet. Renders land here on their own; add a folder to bring in more.'
                : 'Nothing matches this view.'}
            </p>
          ) : null}
          {days.map((day) => (
            <section className="gallery-day" key={day.key}>
              <span className="label-data gallery-day-head">{day.key}</span>
              <div className="gallery-grid">
                {day.items.map((it) => (
                  <Tile key={itemKey(it)} item={it} onOpen={setOpen} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {open ? (
        <Viewer
          item={open}
          position={positionOf(shown, open)}
          onStep={onStep}
          onClose={() => { uiSound('toggle'); setOpen(null); }}
        />
      ) : null}
    </div>
  );
};

export const galleryApp = {
  label: 'GALLERY',
  labelKey: 'apps.gallery',
  icon: <GalleryIcon />,
  title: <AppTitle label="GALLERY" labelKey="apps.gallery" />,
  Body: GalleryBody,
  storageKey: 'gallery',
};
