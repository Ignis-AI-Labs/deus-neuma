/**
 * NOTIFICATION REDUCER — the tray's state, as a pure function.
 *
 * Mirrors the split the desk already uses everywhere: a pure reducer in its own
 * module, an impure hook that owns the socket and the clock. Everything here is
 * data in, data out, so every case below is an ordinary function call with an
 * ordinary expected value and nothing to fake (RULE 0).
 *
 * ── WHY DEDUPE BY ID IS LOAD-BEARING ────────────────────────────────────────
 *
 * The same record can arrive twice by two honest routes: it is in the hydrate
 * the desk gets on connect, AND it arrives as a live frame if the socket
 * reconnects mid-flight. A tray that appended blindly would show the operator
 * two cards for one event and count it twice in the badge — which reads as the
 * feature being broken, because it is.
 *
 * ── WHY read STATE COMES FROM THE SERVER ────────────────────────────────────
 *
 * Read state is not local. The operator has several desk windows open, and
 * marking a card read in one must clear the badge in the others — so the reducer
 * folds a `MARK_READ` that arrived over the wire exactly the same way it folds
 * one the operator just clicked. The window that clicked is not privileged.
 */

import { compareRecords } from '../../../../core/runtime/notification-record.js';

/**
 * How many cards the tray holds in memory.
 *
 * Separate from the store's read window on purpose: this bounds what React
 * renders, the store bounds what the disk hands over. They happen to be the same
 * number today; conflating them would couple the DOM to the file format.
 */
export const DISPLAY_CAP = 200;

export const initialNotifications = Object.freeze({
  records: Object.freeze([]),
  unread: 0,
  /** Has a hydrate landed? Until it has, "no notifications" and "not asked yet"
   *  are different facts, and only the first should render as an empty tray. */
  hydrated: false,
});

/** Pure — newest first, capped, with the unread count derived rather than tracked. */
const settle = (records) => {
  const ordered = [...records].sort(compareRecords).slice(0, DISPLAY_CAP);
  return Object.freeze({
    records: Object.freeze(ordered),
    unread: ordered.filter((rec) => !rec.read).length,
    hydrated: true,
  });
};

/**
 * @param {object} state
 * @param {{type: string, records?: object[], record?: object, ids?: string[]}} action
 */
export const notificationReducer = (state = initialNotifications, action = {}) => {
  switch (action.type) {
    // The bounded tail the server sends on connect. Replaces rather than merges:
    // the server is the source of truth for what exists and what has been read,
    // and a desk that merged its stale local list over a fresh hydrate would
    // resurrect records the operator already cleared elsewhere.
    case 'HYDRATE': {
      const incoming = Array.isArray(action.records) ? action.records : [];
      return settle(incoming.filter((rec) => rec && typeof rec.id === 'string'));
    }

    case 'RECEIVE': {
      const rec = action.record;
      if (!rec || typeof rec.id !== 'string') return state;
      const without = state.records.filter((existing) => existing.id !== rec.id);
      // A re-delivered record must not resurrect as unread if this desk has
      // already marked it read.
      const prior = state.records.find((existing) => existing.id === rec.id);
      const merged = prior?.read ? { ...rec, read: true } : rec;
      return settle([...without, merged]);
    }

    case 'MARK_READ': {
      const ids = new Set(Array.isArray(action.ids) ? action.ids : []);
      if (ids.size === 0) return state;
      let changed = false;
      const next = state.records.map((rec) => {
        if (!ids.has(rec.id) || rec.read) return rec;
        changed = true;
        return { ...rec, read: true };
      });
      // Returning the same object when nothing moved keeps React from
      // re-rendering the tray on every duplicate read frame from a sibling window.
      return changed ? settle(next) : state;
    }

    case 'MARK_ALL_READ': {
      if (state.unread === 0) return state;
      return settle(state.records.map((rec) => (rec.read ? rec : { ...rec, read: true })));
    }

    // The operator dismissed cards (the ×, or CLEAR for all of them). Folded the
    // same way whether this window pressed it or a sibling did; the server keeps
    // them out of every later hydrate, and the records stay in its file.
    case 'DISMISS': {
      const ids = new Set(Array.isArray(action.ids) ? action.ids : []);
      if (ids.size === 0) return state;
      const next = state.records.filter((rec) => !ids.has(rec.id));
      return next.length === state.records.length ? state : settle(next);
    }

    default:
      return state;
  }
};
