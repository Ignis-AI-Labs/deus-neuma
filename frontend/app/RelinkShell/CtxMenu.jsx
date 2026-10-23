// CtxMenu — the desk's ONE in-app right-click menu surface (LINE & CYCLE).
//
// A host hands it a cursor position, a pure item list (files-menu.js shapes:
// item / separator), and an onAct(id); the menu portals to document.body,
// clamps itself inside the viewport, and dies on outside press, Escape, or a
// chosen action. Keyboard walks like the desktop context menu (arrows skip
// separators, Enter acts) — the pure helpers are SHARED with it, not forked.
// Hover only moves the visual selection; sound rides real actions (open /
// close / activate / keyboard tick), never hover. An item may be a SETTING
// (`checked` — it shows its mark and says it is on) or a PAGE TURN (`stay` —
// choosing it keeps the menu up, for the host to show the next page: the media
// menu's playback speeds).

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { moveSelection, clampPosition } from '../../components/DesktopContextMenu/context-menu-view.js';
import { uiSound } from '../../services/ui-sound.js';
import './CtxMenu.css';

/**
 * The menu's rows, as a person reads them — separate from the portal so a
 * static render can speak about them (renderToStaticMarkup has no document).
 * @param {{items: Array<object>, sel: number, onHover: (i: number) => void, onPick: (it: object) => void}} props
 */
export const CtxMenuRows = ({ items, sel, onHover, onPick }) => items.map((it, i) => (
  it.kind === 'separator' ? (
    <div key={`sep-${i}`} className="cmenu-sep" />
  ) : (
    <button
      key={it.id}
      type="button"
      role={typeof it.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={typeof it.checked === 'boolean' ? it.checked : undefined}
      className={`cmenu-item${it.danger ? ' is-danger' : ''}${i === sel ? ' is-sel' : ''}${it.checked ? ' is-checked' : ''}`}
      onMouseEnter={() => onHover(i)}
      onClick={() => onPick(it)}
    >
      {it.label}
    </button>
  )
));

/**
 * @param {{
 *   at: {x: number, y: number},
 *   items: Array<{kind:'item'|'separator', id?:string, label?:string, danger?:boolean, checked?:boolean, stay?:boolean}>,
 *   onAct: (id: string) => void,
 *   onClose: () => void,
 * }} props
 */
export const CtxMenu = ({ at, items, onAct, onClose }) => {
  const [sel, setSel] = useState(-1);
  const [pos, setPos] = useState(at);
  const boxRef = useRef(null);

  useEffect(() => { uiSound('open'); }, []);

  // After first paint, measure and clamp so the menu never leaves the window.
  useEffect(() => {
    if (!boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    setPos(clampPosition(at, {
      menuW: r.width, menuH: r.height, viewW: window.innerWidth, viewH: window.innerHeight,
    }));
  }, [at]);

  const dismiss = useCallback(() => { uiSound('close'); onClose(); }, [onClose]);
  const act = useCallback((it) => {
    uiSound('activate');
    onAct(it.id);
    if (!it.stay) onClose();
  }, [onAct, onClose]);

  // Keyboard: arrows walk, Enter acts, Escape dismisses — captured so the
  // surface underneath doesn't also react while the menu is up.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        uiSound('tick');
        setSel((cur) => moveSelection(items, cur, e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (e.key === 'Enter' && sel >= 0 && items[sel]) {
        e.preventDefault(); e.stopPropagation();
        act(items[sel]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [items, sel, act, dismiss]);

  return createPortal(
    <div
      className="cmenu-overlay"
      onMouseDown={dismiss}
      onContextMenu={(e) => { e.preventDefault(); dismiss(); }}
    >
      <div
        ref={boxRef}
        className="cmenu"
        role="menu"
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <CtxMenuRows items={items} sel={sel} onHover={setSel} onPick={act} />
      </div>
    </div>,
    document.body,
  );
};
