// use-lp-wallet.js — one house member's LP wallet, read once per identity and
// shared by the wallet tabs and the LIQUIDITY view, so switching between the
// two wallets is instant and both always show the same reading.

import { useCallback, useEffect, useRef, useState } from 'react';
import { readLp, openLp } from './lp-wallet-client.js';

/**
 * @param {string|null} neumaId - a house member's lane; null for any other identity
 * @returns {{lp: object|null|undefined, error: string|null, reading: boolean,
 *   reload: () => Promise<void>, open: () => Promise<void>}}
 *   lp — undefined while first reading, null when the house member has none
 */
export const useLpWallet = (neumaId) => {
  const [lp, setLp] = useState(undefined);
  const [error, setError] = useState(null);
  const [reading, setReading] = useState(false);
  const req = useRef(0);

  // impure — reads the LP view; a superseded read never writes.
  const reload = useCallback(async () => {
    if (!neumaId) { setLp(null); return; }
    const mine = ++req.current;
    setReading(true);
    const r = await readLp(neumaId);
    if (req.current !== mine) return;
    setReading(false);
    if (!r.ok) { setError(r.error); setLp((prev) => (prev === undefined ? null : prev)); return; }
    setError(null);
    // Its goals and how it runs round the clock ride beside the wallet in the same read.
    setLp(r.lp ? { ...r.lp, goals: r.goals ?? [], clock: r.clock ?? null } : null);
  }, [neumaId]);

  useEffect(() => { setLp(undefined); setError(null); reload(); }, [reload]);

  // impure — makes the wallet (once), then reads it.
  const open = useCallback(async () => {
    const r = await openLp(neumaId);
    if (!r.ok) { setError(r.error); return; }
    await reload();
  }, [neumaId, reload]);

  return { lp, error, reading, reload, open };
};
