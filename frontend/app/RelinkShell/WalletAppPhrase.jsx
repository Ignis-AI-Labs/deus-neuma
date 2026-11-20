// RECOVERY SECRET — the operator's own wallet, in the WALLET window. A key made
// here reveals with the password this computer keeps; a wallet the operator made
// or imported reveals with its password. The main process asks first in a window
// the page cannot click, and shows the secret in that same window: it never reaches
// this page. Desktop only.
import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';

const wallet = () => (typeof window !== 'undefined' ? window.neuma?.wallet : null);

export const RecoveryPhraseSection = () => {
  const [shown, setShown] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (!wallet()?.revealMade) return null;

  // impure — ask the main process for the active wallet's recovery secret
  const show = async () => {
    setError('');
    try {
      setShown(false);
      await (needsPassword ? wallet().reveal(null, password) : wallet().revealMade(null));
      setPassword('');
      setShown(true);
      uiSound('open');
    } catch (cause) {
      const message = String(cause?.message || cause);
      if (!needsPassword && /not made for you/.test(message)) { setNeedsPassword(true); return; }
      uiSound('deny');
      setError(/cancelled/i.test(message) ? '' : message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">RECOVERY SECRET</h3>
      <p className="wal-note">
        The 24 words, or the private key, that restore your wallet on another machine. Anyone who sees them
        controls it. They are shown in the wallet's own window, never on this page.
      </p>
      {shown ? <p className="wal-note" role="status">Shown in the wallet's own window, and gone when you closed it.</p> : null}
      <div className="wal-form">
        {needsPassword ? (
          <input
            className="wal-in wal-in-wide"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your wallet password"
            autoComplete="current-password"
            aria-label="Wallet password"
          />
        ) : null}
        <button type="button" className="wal-btn" onClick={show} disabled={needsPassword && !password}>SHOW</button>
        {error ? <p className="wal-err">{error}</p> : null}
      </div>
    </section>
  );
};
