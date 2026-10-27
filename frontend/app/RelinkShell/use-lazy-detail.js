// use-lazy-detail.js — the text (or image) a history segment left at the server,
// fetched once it is wanted: a chip opened, an image near the screen.
//
// impure — reads the platform through turn-detail-client.js.

import { useEffect, useState } from 'react';
import { loadTurnRows } from './turn-detail-client.js';
import { pickLazy } from './lazy-detail.js';

/**
 * impure — { value, state } for a lazy ref; nothing is read until `wanted`.
 * state: 'idle' | 'loading' | 'ready' | 'missing' | 'failed'.
 * @param {?object} ref - the address toDisplayMessages stamped (workspace-sessions.js)
 * @param {boolean} wanted
 */
export const useLazyDetail = (ref, wanted) => {
  const [got, setGot] = useState({ value: null, state: 'idle' });
  useEffect(() => {
    if (!ref || !wanted) return undefined;
    let alive = true;
    // Already read (or known absent) stays; anything else reads — a repeat is
    // a cached promise (turn-detail-client.js), so reopening costs nothing.
    setGot((g) => (g.state === 'ready' || g.state === 'missing' ? g : { value: null, state: 'loading' }));
    loadTurnRows(ref)
      .then((rows) => {
        const value = pickLazy(rows, ref);
        if (alive) setGot({ value, state: value === null ? 'missing' : 'ready' });
      })
      .catch(() => { if (alive) setGot({ value: null, state: 'failed' }); });
    return () => { alive = false; };
  }, [ref, wanted]);
  return got;
};
