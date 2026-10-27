// use-read-now.js — READ NOW: the stats sweep on demand, then the board read
// again. Shared by the office's head and the board's RESULTS cell, so both
// show the one read in flight and the one refusal.
//
// impure — network, sound.

import { useCallback, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { sweepResults } from '../../../services/marketing-results-client.js';

/**
 * impure — { busy, error, run }.
 * @param {() => Promise<unknown>} refresh - the board's read
 */
export const useReadNow = (refresh) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try { await sweepResults(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [refresh]);
  return { busy, error, run };
};
