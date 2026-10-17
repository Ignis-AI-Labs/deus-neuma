// DesktopContextMenu — the right-click menu, drawn in the platform's own
// look instead of the OS-native white panel (which cannot be styled).
//
// Electron main intercepts Chromium's context-menu event, derives the item
// template (spelling corrections, dictionary, edit ops) and sends it over
// the preload bridge; this component draws it and answers with the single
// action the witness chose. Focus never leaves the text field under the
// cursor — every press is mousedown-defused — so replace/paste land where
// the witness was typing. Renders nothing outside the desktop shell.

import { useCallback, useEffect, useRef, useState } from 'react';
import { itemLabel, moveSelection, clampPosition } from './context-menu-view.js';
import { uiSound } from '../../services/ui-sound.js';
import './DesktopContextMenu.css';

export const DesktopContextMenu = () => {
  const bridge = window.neuma?.contextMenu;
  const [menu, setMenu] = useState(null); // { x, y, items }
  const [sel, setSel] = useState(-1);
  const [pos, setPos] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!bridge) return undefined;
    const off = bridge.onShow((payload) => {
      if (!Array.isArray(payload?.items) || payload.items.length === 0) return;
      uiSound('open');
      setMenu(payload);
      setSel(-1);
      setPos({ x: payload.x, y: payload.y });
    });
    // Announce we can draw menus — until this lands, main falls back native.
    bridge.ready();
    return off;
  }, [bridge]);

  // After first paint, measure and clamp so the menu never leaves the window.
  useEffect(() => {
    if (!menu || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    setPos(clampPosition(
      { x: menu.x, y: menu.y },
      { menuW: r.width, menuH: r.height, viewW: window.innerWidth, viewH: window.innerHeight },
    ));
  }, [menu]);

  const close = useCallback(() => setMenu(null), []);
  const dismiss = useCallback(() => { uiSound('close'); setMenu(null); }, []);

  const act = useCallback((item) => {
    uiSound('activate');
    bridge.act(item);
    close();
  }, [bridge, close]);

  // Keyboard: arrows walk, Enter acts, Escape dismisses — captured so the
  // focused input underneath doesn't also react while the menu is up.
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        uiSound('tick');
        setSel((cur) => moveSelection(menu.items, cur, e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (e.key === 'Enter' && sel >= 0 && menu.items[sel]) {
        e.preventDefault(); e.stopPropagation();
        act(menu.items[sel]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, sel, act, dismiss]);

  if (!bridge || !menu || !pos) return null;

  return (
    <div
      className="ctxmenu-overlay"
      onMouseDown={(e) => { e.preventDefault(); dismiss(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={boxRef}
        className="ctxmenu"
        role="menu"
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        {menu.items.map((item, i) => (
          item.kind === 'separator' ? (
            <div key={`sep-${i}`} className="ctxmenu-sep" />
          ) : (
            <button
              key={`${item.kind}-${item.word || item.role}-${i}`}
              type="button"
              role="menuitem"
              className={`ctxmenu-item${item.kind === 'suggestion' ? ' is-word' : ''}${i === sel ? ' is-sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => act(item)}
            >
              {itemLabel(item)}
            </button>
          )
        ))}
      </div>
    </div>
  );
};

export default DesktopContextMenu;
