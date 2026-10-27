// calm-gate — background news waits while the person is working.
//
// Design note, 2026-10-23, on a TikTok queue card while a chat ran underneath:
// […]
// A board's background re-read (the 30 s poll, a being's act announced) landed
// under his pointer: cards re-laid, a menu he had open closed. The rule since:
// background activity never re-lays what the person is pointing at or typing
// into. A background update offered while they are engaged is HELD (each
// reader's latest one) and lands the moment they leave; the person's own acts
// (APPROVE, REFRESH, a save) land at once, since they asked for them.
//
// The same rule for focus: a surface that arrives (an ask in a running chat)
// takes focus only when it is free (mayTakeFocus, below).
//
// No DOM here: the hook (use-calm-gate.js) reports engagement and callers hand
// in the nodes, so this is driven directly by tests.

/**
 * Several readers share one surface's gate (a window's header and its board),
 * so what is held is keyed by reader: each reader's latest update waits, and a
 * release lands every one, in the order first held.
 * @returns {{offer: (key: string, apply: () => void) => boolean, now: (key: string, apply: () => void) => void,
 *   setEngaged: (engaged: boolean) => void, holding: () => string[]}}
 *   offer — a background update: applied at once when the person is not
 *   engaged (returns true), else held, replacing that reader's held one
 *   (returns false); now — the person's own update: applied at once, and
 *   that reader's held one is dropped (this read is newer); setEngaged — the
 *   person's engagement, a release applies what was held; holding — the
 *   readers with an update waiting.
 */
export const createCalmGate = () => {
  let engaged = false;
  const held = new Map();
  return {
    offer: (key, apply) => {
      if (!engaged) { held.delete(key); apply(); return true; }
      held.set(key, apply);
      return false;
    },
    now: (key, apply) => { held.delete(key); apply(); },
    setEngaged: (value) => {
      engaged = Boolean(value);
      if (engaged) return;
      const waiting = [...held.values()];
      held.clear();
      for (const apply of waiting) apply();
    },
    holding: () => [...held.keys()],
  };
};

/**
 * May a surface that just arrived take focus? Only when focus is free (on the
 * page itself) or already inside the surface's own window: an ask rising in a
 * running chat never pulls the caret out of a field the person is typing in
 * elsewhere on the desk. Pure over the nodes given.
 * @param {{contains?: Function}|null} active - document.activeElement
 * @param {{contains: Function}|null} home - the arriving surface's window, or null
 * @param {object|null} page - document.body (focus there is free)
 * @returns {boolean}
 */
export const mayTakeFocus = (active, home, page) => !active || active === page
  || Boolean(home && home.contains(active));
