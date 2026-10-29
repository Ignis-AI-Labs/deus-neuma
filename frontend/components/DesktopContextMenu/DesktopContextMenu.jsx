// DesktopContextMenu — the right-click menu, drawn in the platform's own
// look instead of the OS-native white panel (which cannot be styled).
//
// Electron main intercepts Chromium's context-menu event, derives the item
// template (spelling corrections, dictionary, edit ops) and sends it over
// the preload bridge; this component draws it and answers with the single
// action the witness chose. Focus never leaves the text field under the
// cursor — every press is mousedown-defused — so replace/paste land where
// the witness was typing. DEFINE is answered HERE, not in main: it opens
// DefineCard at the spot, carrying the sentence and the chat window read
// the moment the menu opened. Renders nothing outside the desktop shell.

import { useCallback, useEffect, useRef, useState } from 'react';
import { itemLabel, moveSelection, clampPosition } from './context-menu-view.js';
import { defineContextNow } from './define-context.js';
import { DefineCard } from './DefineCard.jsx';
import { uiSound } from '../../services/ui-sound.js';
import './DesktopContextMenu.css';

const LINE_BELOW = 24;

export const DesktopContextMenu = () => {
  const bridge = window.neuma?.contextMenu;
  const [menu, setMenu] = useState(null); // { x, y, items, context }
  const [define, setDefine] = useState(null); // { word, x, y, sentence, composer }
  const [sel, setSel] = useState(-1);
  const [pos, setPos] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!bridge) return undefined;
    const off = bridge.onShow((payload) => {
      if (!Array.isArray(payload?.items) || payload.items.length === 0) return;
      uiSound('open');
      // read now — the selection stands only until something else is pressed
      setMenu({ ...payload, context: payload.items.some((i) => i.kind === 'define') ? defineContextNow() : null });
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
    // the card opens a line below the cursor, so the sentence stays readable
    if (item.kind === 'define') setDefine({ word: item.word, x: menu.x, y: menu.y + LINE_BELOW, ...menu.context });
    else bridge.act(item);
    close();
  }, [bridge, close, menu]);
  const closeDefine = useCallback(() => setDefine(null), []);

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

  if (!bridge) return null;
  const card = define ? <DefineCard {...define} onClose={closeDefine} /> : null;
  if (!menu || !pos) return card;

  return (
    <>
      {card}
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
    </>
  );
};

export default DesktopContextMenu;
