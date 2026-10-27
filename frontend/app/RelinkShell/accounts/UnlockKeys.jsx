// UnlockKeys — KEYS LOCKED's own fixes (house-unlock.js): UNLOCK opens one
// hidden field for the key the house's keys file was sealed with. The key
// goes up once, is never kept here (the field clears on every answer), and
// on success every account and platform reads again at once. START FRESH,
// when that key is gone: the locked file steps aside (kept read-only) and
// every platform's keys are pasted again — asked once before it acts.
//
// impure — one request, the house's shared accounts read, the overview's re-read.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { unlockHouseKeys, startFreshKeys } from '../../../services/social-accounts-client.js';
import { InlineActionConfirm } from '../InlineActionConfirm.jsx';
import { loadHouseAccounts } from './use-house-accounts.js';
import './unlock-keys.css';

/** @param {{onUnlocked?: () => void}} props */
export const UnlockKeys = ({ onUnlocked }) => {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [fresh, setFresh] = useState(false);
  const reread = async () => {
    await loadHouseAccounts({ force: true });
    window.dispatchEvent(new Event('neuma:campaigns-changed'));
    onUnlocked?.();
  };
  const startFresh = async () => {
    setBusy(true);
    setError(null);
    try {
      await startFreshKeys();
      uiSound('open');
      setFresh(false);
      await reread();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlockHouseKeys(key);
      uiSound('open');
      setOpen(false);
      await reread();
    } catch (err) {
      setError(err.message);
    } finally {
      setKey('');
      setBusy(false);
    }
  };

  if (fresh) {
    return (
      <span className="unlock-keys">
        <InlineActionConfirm label="Start fresh" confirmLabel="START FRESH" busy={busy} onConfirm={startFresh}
          onCancel={() => setFresh(false)}>
          the locked file is kept read-only; you paste every platform&rsquo;s keys again
        </InlineActionConfirm>
        {error ? <span className="unlock-keys-err" role="alert">{error}</span> : null}
      </span>
    );
  }
  if (!open) {
    return (
      <span className="unlock-keys">
        <button type="button" className="settings-set door-btn" data-unlock-keys title="open the keys file with the key it was sealed with — it is sealed again under this desk's key"
          onClick={() => { uiSound('toggle'); setOpen(true); }}>
          UNLOCK
        </button>
        <button type="button" className="settings-set" data-start-fresh title="the old key is gone: set the locked file aside (kept read-only) and paste every platform's keys again"
          onClick={() => { uiSound('toggle'); setFresh(true); }}>
          START FRESH
        </button>
      </span>
    );
  }
  return (
    <form className="unlock-keys" data-unlock-form onSubmit={submit}>
      <input type="password" className="unlock-keys-field" value={key} onChange={(e) => setKey(e.target.value)}
        autoComplete="off" spellCheck={false} aria-label="the key the keys file was sealed with" placeholder="old key"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the form opens to be typed into
        autoFocus />
      <button type="submit" className="settings-set door-btn" disabled={!key || busy}>{busy ? 'UNLOCKING…' : 'UNLOCK'}</button>
      <button type="button" className="settings-set" disabled={busy} onClick={() => { setOpen(false); setKey(''); setError(null); }}>CANCEL</button>
      {error ? <span className="unlock-keys-err" role="alert">{error}</span> : null}
    </form>
  );
};
