// impure — confirm before removing this machine's saved provider credential.
import { useState } from 'react';
import { removeProviderKey } from '../../services/routing.js';
import { uiSound } from '../../services/ui-sound.js';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';

export const ProviderKeyRemoval = ({ provider, busy, onBusy, onError, onChanged }) => {
  const [confirming, setConfirming] = useState(false);
  const remove = async () => {
    uiSound('activate');
    onBusy(true); onError(null);
    try {
      await removeProviderKey(provider.id);
      setConfirming(false);
      await onChanged();
    } catch (error) { onError(error.message); }
    finally { onBusy(false); }
  };
  if (!confirming) return (
    <button type="button" className="settings-set is-danger" disabled={busy}
      onClick={() => { uiSound('open'); onError(null); setConfirming(true); }}>
      REMOVE
    </button>
  );
  return (
    <InlineActionConfirm label="Confirm provider credential removal" confirmLabel="REMOVE" busy={busy}
      onConfirm={remove} onCancel={() => { uiSound('close'); setConfirming(false); }}>
      Remove the saved credential and custom endpoint for {provider.name} from this computer?
      Routes using it may stop working. Environment credentials remain available.
    </InlineActionConfirm>
  );
};
