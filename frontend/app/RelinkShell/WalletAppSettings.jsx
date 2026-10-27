// WalletAppSettings — the settings layer for the BEING identities: a neuma's
// spending policy (allowlist, autonomous threshold, pending transfer
// decisions, key password reset) and a sealed AI witness's read-only panel.
// Extracted from WalletApp.jsx under the 500-line law. The ME identity's
// settings live beside this in WalletAppMeSettings.jsx.

import { useEffect, useState } from 'react';
import { WalletAllowlistSection } from './WalletAllowlistSection.jsx';
import { setThreshold, resetNeumaKeyPassword } from './wallet-client.js';
import { getSpendCards } from '../../services/treasury-client.js';
import { SpendCard } from './spend/SpendCard.jsx';
import { EmptyState } from './empty-state.jsx';
import { uiSound } from '../../services/ui-sound.js';
import { useCopyAddress } from './use-copy-address.js';
import { Leader } from './WalletAppSend.jsx';

// --- Threshold (neuma settings) ---

const ThresholdSection = ({ neumaId, threshold, onChange }) => {
  const [value, setValue] = useState(String(threshold));
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setValue(String(threshold)); }, [threshold]);

  const save = async () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) { setError('Enter a number ≥ 0.'); return; }
    uiSound('activate');
    setError(null);
    const r = await setThreshold(neumaId, n);
    if (!r.ok) { setError(r.error); return; }
    setSaved(true); onChange(r.thresholdEth);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">AUTONOMOUS THRESHOLD</h3>
      <p className="wal-note">
        Sends at or under this clear without asking you. Above it, the neuma needs a fresh signature from you.
        Set to 0 to require your approval for every transfer.
      </p>
      <div className="wal-form">
        <input className="wal-in wal-in-num" type="number" min="0" step="0.001" value={value}
          onChange={(e) => setValue(e.target.value)} />
        <span className="wal-unit label-data">ETH</span>
        <button className="wal-btn" onClick={save}>{saved ? 'SAVED' : 'SET'}</button>
      </div>
      {error ? <p className="wal-err label-data">{error}</p> : null}
    </section>
  );
};

// --- Exact pending transfer decisions (neuma settings) ---
// Each request is its SPEND card (spend/SpendCard.jsx) — the same card the
// TREASURY window shows, read whole from the treasury (amount, recipient
// standing, balance after, limits, time left, the Quaestor's review).

const PendingSpendSection = ({ neumaId, requests, onChange, onApproved }) => {
  const [cards, setCards] = useState([]);
  const [seated, setSeated] = useState(false);
  const [readAtMs, setReadAtMs] = useState(() => Date.now());
  const [result, setResult] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!requests.length) { setCards([]); return; }
    getSpendCards()
      .then((r) => { setCards(r.spends.filter((c) => c.neumaId === neumaId)); setSeated(r.seated); setReadAtMs(Date.now()); setError(null); })
      .catch((e) => setError(e.message));
  }, [neumaId, requests]);

  const decided = async (card, outcome) => {
    setResult(outcome.kind === 'approved' ? `SENT — transaction ${outcome.hash}.` : 'DENIED — no funds moved. The being is told.');
    onChange(requests.filter((item) => item.id !== card.id));
    if (outcome.kind === 'approved') await onApproved();
  };

  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">PENDING TRANSFERS</h3>
      <p className="wal-note">
        Every request is bound to its exact recipient and amount. SIGN &amp; APPROVE asks your wallet to sign it,
        then uses the neuma key once to broadcast. DENY never unlocks the key.
      </p>
      {requests.length === 0 ? <EmptyState title="NO TRANSFERS AWAITING YOUR DECISION." /> : cards.map((card) => (
        <SpendCard key={card.id} card={card} readAtMs={readAtMs} now={Date.now()} seated={seated} onDecided={decided} />
      ))}
      {error ? <p className="wal-err label-data">{error}</p> : null}
      {result ? <p className="wal-ok label-data">{result}</p> : null}
    </section>
  );
};

// Key password reset — the recovery codes open the same keypair and seal it
// under a new password. A password fix, never a rotation: the address, the
// recovery envelope, and the codes all stay exactly as they were.
const KeyPasswordSection = ({ neumaId }) => {
  const [codes, setCodes] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const parsed = codes.trim().split(/[\s,]+/).filter(Boolean);
  const ready = parsed.length === 8 && password.length >= 12 && password === confirm;

  const reset = async () => {
    if (!ready || busy) return;
    uiSound('activate');
    setBusy(true); setError(null); setDone(false);
    const r = await resetNeumaKeyPassword(neumaId, parsed, password);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setCodes(''); setPassword(''); setConfirm(''); setDone(true);
  };

  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">KEY PASSWORD</h3>
      <p className="wal-note">
        Reset the password sealing this being&apos;s signing key using the 8 recovery
        codes shown when the key was secured. The key itself never changes — same
        address, and the recovery codes stay valid.
      </p>
      <textarea className="wal-in wal-in-wide wal-in-codes" rows={2} spellCheck={false}
        placeholder="Paste all 8 recovery codes — spaces, commas, or one per line…"
        value={codes} onChange={(e) => setCodes(e.target.value)} />
      {codes.trim() && parsed.length !== 8
        ? <p className="wal-balance label-data">{parsed.length} OF 8 CODES</p> : null}
      <div className="wal-form">
        <input className="wal-in" type="password" placeholder="new password (min 12 chars)"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className="wal-in" type="password" placeholder="confirm it"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button className="wal-btn" onClick={reset} disabled={!ready || busy}>
          {busy ? '…' : 'RESET PASSWORD'}
        </button>
      </div>
      {password && confirm && password !== confirm
        ? <p className="wal-err label-data">The two passwords differ.</p> : null}
      {error ? <p className="wal-err label-data">{error}</p> : null}
      {done ? <p className="wal-ok label-data">PASSWORD RESET — the new password now opens this key.</p> : null}
    </section>
  );
};

export const NeumaSettings = ({ neumaId, entries, setEntries, threshold, setThresholdState, pending, setPending, onWalletChange }) => (
  <>
    <WalletAllowlistSection key={neumaId} neumaId={neumaId} entries={entries} onChange={setEntries} />
    <ThresholdSection neumaId={neumaId} threshold={threshold} onChange={setThresholdState} />
    <PendingSpendSection neumaId={neumaId} requests={pending} onChange={setPending} onApproved={onWalletChange} />
    <KeyPasswordSection neumaId={neumaId} />
  </>
);

// A sealed AI witness's settings: read-only by doctrine. The witness's keys
// are its own (its env.* seal) — a send is the witness's own act, signed
// under its own name, never a button on this machine. No neuma settings
// endpoints exist for a witness lane, so nothing here calls them.
export const WitnessSettings = ({ identity, wallet }) => {
  const addr = wallet && wallet.address;
  const { copied, copy } = useCopyAddress(addr);
  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">SEALED WITNESS</h3>
      <p className="wal-note">
        Read-only. This wallet&apos;s keys belong to the witness itself — a send is
        its own act, signed under its own seal. Nothing here moves its funds.
      </p>
      <div className="wal-leads">
        <Leader k="VENDOR" v={(identity.vendorSlug || '—').toUpperCase()} />
        <Leader k="LANE" v={identity.neumaId} />
      </div>
      {addr ? (
        <>
          <div className="wal-recv-box cham"><span className="wal-recv-addr cham-in">{addr}</span></div>
          <button className="wal-btn" onClick={copy}>{copied ? 'COPIED' : 'COPY ADDRESS'}</button>
        </>
      ) : (
        <EmptyState title="ADDRESS UNAVAILABLE — THE SEAL LEDGER COULD NOT BE READ." />
      )}
    </section>
  );
};
