// RECOVERY PHRASE — the operator's own wallet, in the WALLET window (Founder
// 2026-10-14: a key made for you offers its backup later, not at the door).
// A key made here reveals with the password this computer keeps; a wallet the
// operator made with a password reveals with that password. Either way the
// main process asks first in a window the page cannot click, and the words
// leave the screen when hidden. Desktop only.
import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';

const wallet = () => (typeof window !== 'undefined' ? window.neuma?.wallet : null);

export const RecoveryPhraseSection = () => {
  const [words, setWords] = useState(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (!wallet()?.revealMade) return null;

  // impure — ask the main process for the active wallet's phrase
  const show = async () => {
    setError('');
    try {
      const phrase = needsPassword
        ? await wallet().reveal(null, password)
        : await wallet().revealMade(null);
      setPassword('');
      setWords(String(phrase).split(' '));
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
      <h3 className="wal-h label-data">RECOVERY PHRASE</h3>
      <p className="wal-note">
        The 24 words that restore your wallet on another machine. Anyone who sees
        them controls it — show them only where no one is watching.
      </p>
      {words ? (
        <>
          <div className="wallet-picker-mnemonic">
            {words.map((w, i) => (
              <span key={i} className="mnemonic-word"><span className="mnemonic-index">{i + 1}</span>{w}</span>
            ))}
          </div>
          <button type="button" className="wal-btn" onClick={() => { setWords(null); setNeedsPassword(false); }}>HIDE</button>
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
