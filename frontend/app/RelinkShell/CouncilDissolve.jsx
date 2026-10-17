import { useEffect, useState } from 'react';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';
import { playSound } from '../../services/sound-engine.js';

/** Confirm room closure; the server's acknowledgement owns final teardown. impure. */
export const CouncilDissolve = ({ close, connected, error }) => {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    if (!connected) { setPending(false); setConfirming(false); }
    else if (error) setPending(false);
  }, [connected, error]);
  const dissolve = () => {
    if (pending || !connected) return;
    setPending(true); setFailure('');
    try { close(); }
    catch (cause) { setPending(false); setFailure(cause.message || 'The council could not be closed.'); }
  };
  return <>
    {confirming ? <InlineActionConfirm label="Confirm council dissolution" confirmLabel="DISSOLVE COUNCIL"
      busy={pending} onConfirm={dissolve} onCancel={() => setConfirming(false)}>
      Close this council and stop its current turn? Its record remains available to reopen.
    </InlineActionConfirm> : <button type="button" className="council-dissolve label-data" disabled={!connected}
      onClick={() => { playSound('menuOpen'); setFailure(''); setConfirming(true); }}>DISSOLVE</button>}
    {failure && <span role="alert">{failure}</span>}
  </>;
};
