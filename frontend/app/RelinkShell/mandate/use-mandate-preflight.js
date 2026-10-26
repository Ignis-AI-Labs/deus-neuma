// use-mandate-preflight — the grant protocol's rows for the grant on screen,
// read from the server (mandate-preflight.js computes them; the grant route
// runs them again). Re-read whenever the choices change; an older answer
// never lands over a newer one, and rows read for other choices are never
// handed out — the button cannot arm on a stale check.
//
// impure — REST.

import { useCallback, useEffect, useRef, useState } from 'react';
import { preflightMandate } from '../../../services/mandate-client.js';

/**
 * impure — { rows, last, atDesk, error, reread }: `rows` only when read for these
 * choices; `last` the latest rows read for any, so the list holds its place
 * (calm: nothing re-lays under the pointer) while a re-read runs.
 * @param {object} body - the grant body the screen would send
 */
export const useMandatePreflight = (body) => {
  const [state, setState] = useState({ rows: null, atDesk: false, error: null, forKey: null });
  const asked = useRef(0);
  const key = JSON.stringify({ accounts: body.accounts.map((a) => ({ id: a.id })), acts: body.acts });
  const read = useCallback(async () => {
    asked.current += 1;
    const mine = asked.current;
    try {
      const out = await preflightMandate(JSON.parse(key));
      if (mine === asked.current) setState({ rows: out.rows, atDesk: Boolean(out.atDesk), error: null, forKey: key });
    } catch (err) {
      if (mine === asked.current) setState({ rows: null, atDesk: false, error: err.message, forKey: key });
    }
  }, [key]);
  useEffect(() => { read(); }, [read]);
  const current = state.forKey === key;
  return { rows: current ? state.rows : null, last: state.rows, atDesk: current && state.atDesk, error: current ? state.error : null, reread: read };
};
