// DecoyWatch — the IO of the SECURITY window's DECOYS section: reads the
// decoy watch, turns it on or off, releases a frozen program. The server
// answers a wallet that does not own this computer with its own plain
// refusal, shown as it stands.

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { getDecoyWatch, setDecoyWatch, releaseFrozenProgram } from '../../services/cso-client.js';
import { DecoyWatchBody } from './DecoyWatchBody.jsx';

// A frozen program appears without a press, so the section looks again on its own.
const REFRESH_MS = 15000;

export const DecoyWatch = () => {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    const load = () => getDecoyWatch()
      .then((s) => { if (live) { setState(s); setError(null); } })
      .catch((e) => { if (live) setError(e.message); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);

  // One act at a time; the server's answer is the new state.
  const act = async (call) => {
    uiSound('activate');
    setBusy(true);
    try {
      setState(await call());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DecoyWatchBody
      state={state}
      busy={busy}
      error={error}
      onToggle={(on) => act(() => setDecoyWatch(on))}
      onRelease={(pid) => act(() => releaseFrozenProgram(pid))}
    />
  );
};
