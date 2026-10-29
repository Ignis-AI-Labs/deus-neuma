// use-calm-gate — the calm gate (calm-gate.js) on one surface: the person is
// ENGAGED while the pointer is over it or focus is inside it, read from the
// DOM itself (`:hover`, document.activeElement) whenever it matters, so a
// focused control that unmounted never leaves the gate held.
//
// impure — reads the DOM.

import { useMemo, useRef, useState } from 'react';
import { createCalmGate } from './calm-gate.js';

/** impure — is focus (or where it is going) inside this element? */
const focusIn = (node, target = globalThis.document?.activeElement) => Boolean(node && target && node.contains(target));

/** impure — is the person at this element right now? */
const engagedWith = (node) => Boolean(node) && (node.matches(':hover') || focusIn(node));

/**
 * impure — { offer, now, handlers }: spread `handlers` on the surface's root;
 * `offer(key, apply)` for a reader's background update, `now(key, apply)`
 * for one the person asked for.
 */
export const useCalmGate = () => {
  const [gate] = useState(createCalmGate);
  const node = useRef(null);
  return useMemo(() => ({
    offer: (key, apply) => {
      gate.setEngaged(engagedWith(node.current));
      return gate.offer(key, apply);
    },
    now: gate.now,
    handlers: {
      onPointerEnter: (e) => { node.current = e.currentTarget; gate.setEngaged(true); },
      // The pointer has left: only focus can still hold the gate.
      onPointerLeave: (e) => { node.current = e.currentTarget; gate.setEngaged(focusIn(node.current)); },
      onFocus: (e) => { node.current = e.currentTarget; gate.setEngaged(true); },
      // Judged by where focus is GOING (relatedTarget), not where it stood.
      onBlur: (e) => {
        node.current = e.currentTarget;
        gate.setEngaged(node.current.matches(':hover') || focusIn(node.current, e.relatedTarget));
      },
    },
  }), [gate]);
};
