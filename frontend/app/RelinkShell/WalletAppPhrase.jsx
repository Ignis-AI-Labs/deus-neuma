// RECOVERY SECRET — the operator's own wallet, in the WALLET window. A key made
// here reveals with the password this computer keeps; a wallet the operator made
// or imported reveals with its password. The main process asks first in a window
// the page cannot click, and the secret leaves the screen when hidden. Desktop only.
import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';

const wallet = () => (typeof window !== 'undefined' ? window.neuma?.wallet : null);
const isPrivateKey = (secret) => /^0x[0-9a-fA-F]{64}$/.test(secret);

export const RecoveryPhraseSection = () => {
  const [secret, setSecret] = useState(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (!wallet()?.revealMade) return null;

  // impure — ask the main process for the active wallet's recovery secret
  const show = async () => {
    setError('');
    try {
      const revealed = needsPassword
        ? await wallet().reveal(null, password)
        : await wallet().revealMade(null);
      setPassword('');
      setSecret(String(revealed));
      uiSound('open');
    } catch (cause) {
      const message = String(cause?.message || cause);
      if (!needsPassword && /not made for you/.test(message)) { setNeedsPassword(true); return; }
      uiSound('deny');
      setError(/cancelled/i.test(message) ? '' : message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  const words = secret && !isPrivateKey(secret) ? secret.split(' ') : null;
  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">RECOVERY SECRET</h3>
      <p className="wal-note">
        {isPrivateKey(secret)
          ? 'This private key restores your imported wallet on another machine. Anyone who sees it controls the wallet.'
          : 'The 24 words that restore your wallet on another machine. Anyone who sees them controls it — show them only where no one is watching.'}
      </p>
      {secret ? (
        <>
          <div className="wallet-picker-mnemonic">
            {words ? words.map((word, i) => (
              <span key={i} className="mnemonic-word"><span className="mnemonic-index">{i + 1}</span>{word}</span>
            )) : <code className="mnemonic-word">{secret}</code>}
          </div>
          <button type="button" className="wal-btn" onClick={() => { setSecret(null); setNeedsPassword(false); }}>HIDE</button>
        </>
      ) : (
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
      )}
    </section>
  );
};
