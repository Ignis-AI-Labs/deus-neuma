// use-mind-check — the door asks the flight check's own question: is the model a being will run
// on loaded and answering? (GET /api/v1/preflight/mind runs the same substrate check the birth's
// flight check does, so the two can never disagree.) Asking also loads the model.
//
// impure — reads the backend.
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '../../utils/http.js';

// A first load of a model can take a while on a laptop; the door still never waits forever.
const MIND_READ_MS = 120_000;

/**
 * @returns {[{state: 'checking'|'ready'|'not', detail?: string, requirement?: string}, () => void]}
 */
export const useMindCheck = () => {
  const [mind, setMind] = useState({ state: 'checking' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setMind({ state: 'checking' });
    apiCall('GET', '/api/v1/preflight/mind', { strictJson: true, signal: AbortSignal.timeout(MIND_READ_MS) })
      .then((r) => { if (live) setMind({ state: r?.ready ? 'ready' : 'not', detail: r?.detail, requirement: r?.requirement }); })
      .catch(() => { if (live) setMind({ state: 'not', detail: 'The model on this machine could not be checked.' }); });
    return () => { live = false; };
  }, [round]);
  return [mind, useCallback(() => setRound((n) => n + 1), [])];
};
