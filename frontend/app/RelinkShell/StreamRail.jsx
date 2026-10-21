// StreamRail — ONE strip on the stream's right edge, holding every rail button.
//
// Design note, 2026-08-25, on finding TASKS and CHATS standing as two separate spines:
// […]
//
// TWO THINGS THIS FIXES, and only the second is behavioural:
//
//   1. Two columns become one. Each rail used to mount its own full-height
//      spine as a sibling, so every rail added later took another column of
//      stream width. Now a rail contributes a BUTTON to a shared strip.
//
//   2. The strip no longer disappears when a panel opens. Each rail used to
//      render EITHER its spine OR its panel, so with tasks open there was no
//      way to reach chats without folding tasks first. The strip now always
//      stands: tapping another button swaps the panel in place.
//
// Exclusivity is NOT implemented here — stream-rail-state.js already holds one
// value naming the open rail (ruling, 2026-08-15) and folding is its mechanism.
// This file is the strip; that file is the law.
//
// A rail JOINS BY MOUNTING. It registers {id, label, badge, show, title} and
// renders its own panel when it is the open one; nothing here enumerates the
// rails, so adding one costs no layout edit.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import './StreamRail.css';
import { RailGlyph } from './RailGlyph.jsx';
import { getOpenRail, setOpenRail, OPEN_RAIL_EVENT } from './stream-rail-state.js';
import { uiSound } from '../../services/ui-sound.js';

const RailContext = createContext(null);

/**
 * Publish this rail's button and learn whether it is the open one.
 *
 * @param {string} id rail id, the same value stream-rail-state persists
 * @param {{label: string, badge?: number, show?: boolean, title?: string}} button
 * @returns {boolean} true when this rail is the open one and should draw its panel
 */
export const useRailItem = (id, button) => {
  const ctx = useContext(RailContext);
  const { label, badge = 0, show = true, title = '' } = button || {};
  const register = ctx?.register;

  useEffect(() => {
    if (!register) return undefined;
    register(id, { id, label, badge, show, title });
    // Unregistering on unmount is what keeps the strip honest: a rail that
    // stops rendering stops offering a button, rather than leaving a dead
    // one that opens nothing.
    return () => register(id, null);
  }, [register, id, label, badge, show, title]);

  return ctx?.open === id;
};

/** The strip, and the panel area beside it. */
export const StreamRail = ({ children }) => {
  const [items, setItems] = useState({});
  const [open, setOpenState] = useState(getOpenRail);

  useEffect(() => {
    const onRail = (e) => setOpenState(e.detail ?? null);
    window.addEventListener(OPEN_RAIL_EVENT, onRail);
    return () => window.removeEventListener(OPEN_RAIL_EVENT, onRail);
  }, []);

  const register = useCallback((id, item) => {
    setItems((prev) => {
      if (!item) {
        if (!(id in prev)) return prev;
        const { [id]: _gone, ...rest } = prev;
        return rest;
      }
      const was = prev[id];
      // Registration runs on every render of a rail; bail when nothing the
      // button shows has changed, or the strip re-renders in a loop.
      if (was && was.label === item.label && was.badge === item.badge
        && was.show === item.show && was.title === item.title) return prev;
      return { ...prev, [id]: item };
    });
  }, []);

  const ctx = useMemo(() => ({ register, open }), [register, open]);

  // Insertion order is mount order, which is the order ChatApp lists them —
  // deliberate and readable, rather than a separate ordering constant that can
  // drift from the markup.
  const buttons = Object.values(items).filter((item) => item.show);

  const toggle = (id) => {
    uiSound(open === id ? 'close' : 'open');
    // Tapping the open rail folds it; tapping another SWAPS in place. The
    // shared state does the folding, so two panels cannot both be open.
    setOpenRail(open === id ? null : id);
  };

  return (
    <RailContext.Provider value={ctx}>
      {children}
      {buttons.length > 0 ? (
        <nav className="stream-rail-strip" aria-label="Stream panels">
          {buttons.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`stream-rail-tab${open === item.id ? ' is-open' : ''}`}
              onClick={() => toggle(item.id)}
              title={item.title || item.label}
              aria-expanded={open === item.id}
              aria-current={open === item.id}
            >
              <RailGlyph open={open === item.id} />
              <span className="stream-rail-word label-data">{item.label}</span>
              {item.badge > 0 ? <span className="stream-rail-count label-data">{item.badge}</span> : null}
            </button>
          ))}
        </nav>
      ) : null}
    </RailContext.Provider>
  );
};
