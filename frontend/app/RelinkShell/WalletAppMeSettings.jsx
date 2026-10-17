// WalletAppMeSettings — the settings layer for the ME identity: which chain
// the wallet points at, the custom Base RPC, the operator's connected wallets,
// and read-only Ledger account discovery. Extracted from WalletApp.jsx under
// the 500-line law. The being identities' settings live in WalletAppSettings.jsx.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRpcStatus, setRpc, clearRpc, probeRpc, networkStatus, setNetwork,
} from './wallet-client.js';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';
import { EmptyState } from './empty-state.jsx';
import { formatAddress } from '../../utils/format.js';
import { isLedgerSupported, listLedgerAccounts } from '../../services/ledger-client.js';
import { uiSound } from '../../services/ui-sound.js';
import { RecoveryPhraseSection } from './WalletAppPhrase.jsx';

// Which chain the wallet points at — Base mainnet (home) or Base Sepolia
// (testnet-first walks). Desktop: main holds the selection and gates a switch
// behind the trusted confirm window; browser: localStorage (dev path). The
// testnet state is loudly badged so a witness can never mistake which value
// their signature moves.
const NetworkSection = () => {
  const [net, setNet] = useState(null);       // { network, networks }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Component-level ref, not a useSettled guard: choose() (an event handler)
  // reads it after its own awaits, outside this effect's closure.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    networkStatus().then((s) => { if (alive.current) setNet(s); });
    return () => { alive.current = false; };
  }, []);

  const choose = async (key) => {
    if (!net || busy || key === net.network.key) return;
    uiSound('activate');
    setError(null); setBusy(true);
    const r = await setNetwork(key);
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    const s = await networkStatus();
    if (alive.current) setNet(s);
  };

  if (!net) return null;
  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">
        NETWORK
        {net.network.testnet ? <span className="wal-testnet-badge label-data"> · TESTNET</span> : null}
      </h3>
      <p className="wal-note">
        Reads, broadcasts, and signatures all target this chain. Base is home;
        the testnet exists for rehearsing against the Sepolia contracts —
        testnet funds have no real value.
      </p>
      <div className="wal-form">
        {net.networks.map((n) => (
          <button key={n.key}
            className={`wal-btn${n.key === net.network.key ? ' is-active' : ''}`}
            onClick={() => choose(n.key)} disabled={busy}>
            {n.key === net.network.key ? '● ' : ''}{n.label.toUpperCase()}
          </button>
        ))}
      </div>
      {error ? <p className="wal-err label-data">{error}</p> : null}
    </section>
  );
};

// The custom Base RPC. Desktop: the secret URL lives in the main process,
// set/clear gated by a native confirm. Browser: the URL is saved to
// wallet-scoped localStorage (flagged in the note below). Status is masked.
const RpcSection = () => {
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [probe, setProbe] = useState(null); // 'probing' | {ok,chainId,blockNumber,onBase} | {ok:false,error}
  const savedTimer = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const runProbe = useCallback(async () => {
    setProbe('probing');
    const r = await probeRpc();
    if (alive.current) setProbe(r);
  }, []);

  // Load status; if a custom RPC is already active, verify it's live right away.
  // alive guards every post-await setState (save, revert, probe) against unmount.
  useEffect(() => {
    alive.current = true;
    getRpcStatus().then((s) => {
      if (!alive.current) return;
      setStatus(s);
      if (s && s.custom) runProbe();
    });
    return () => { alive.current = false; };
  }, [runProbe]);

  const save = async () => {
    uiSound('activate');
    setError(null); setBusy(true);
    const r = await setRpc(url.trim());
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setUrl(''); setStatus(r.status);
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
    runProbe();
  };

  const revert = async () => {
    uiSound('deny');
    setError(null); setBusy(true);
    const r = await clearRpc();
    if (!alive.current) return;
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setStatus(r.status); setProbe(null); setConfirmPublic(false);
  };

  const isCustom = !!(status && status.custom);
  const endpoint = isCustom ? (status.label || 'custom RPC') : 'public node · selected network';

  let probeText = null;
  let probeCls = 'wal-rpc-probe label-data';
  if (isCustom) {
    if (probe === 'probing') probeText = 'CHECKING…';
    else if (probe && probe.ok) {
      if (!probe.chainAuthoritative) {
        // desktop: main answers eth_chainId statically, so claim liveness only.
        probeText = `LIVE · BLOCK ${probe.blockNumber.toLocaleString()}`;
        probeCls += ' ok';
      } else if (probe.onExpectedChain) {
        probeText = `LIVE · ${probe.expected.label.toUpperCase()} · BLOCK ${probe.blockNumber.toLocaleString()}`;
        probeCls += ' ok';
      } else {
        probeText = `REACHABLE · CHAIN ${probe.chainId} — NOT ${probe.expected.label.toUpperCase()}`;
        probeCls += ' warn';
      }
    } else if (probe) {
      probeText = `UNREACHABLE — ${probe.error}`;
      probeCls += ' warn';
    }
  }

  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">BASE RPC</h3>
      <p className="wal-note">
        Your balance, tokens, and sends all read through this Base RPC. Paste your own
        (e.g. Alchemy) for full token discovery and MEV protection — otherwise a public
        Base node is used.{' '}
        {status?.browser
          ? 'In this browser it is saved to local storage (readable by this site) — the desktop app stores it in your OS keychain.'
          : 'Your URL is stored in your OS keychain and never leaves this machine.'}
      </p>

      <div className={`wal-rpc-state cham${isCustom ? ' is-custom' : ''}`}>
        <div className="wal-rpc-state-in cham-in">
          <span className="wal-rpc-badge label-data">{isCustom ? 'CUSTOM · ACTIVE' : 'PUBLIC'}</span>
          <span className="wal-rpc-endpoint">{status ? endpoint : '…'}</span>
          {probeText ? <span className={probeCls}>{probeText}</span> : null}
        </div>
      </div>

      {status ? (
        <>
          <input className="wal-in wal-in-wide"
            placeholder={isCustom ? 'Replace with another Base RPC…' : 'https://base-mainnet.g.alchemy.com/v2/your-key'}
            value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy || confirmPublic} spellCheck={false} />
          <div className="wal-form">
            <button className="wal-btn" onClick={save} disabled={busy || confirmPublic || !url.trim()}>{busy ? '…' : saved ? 'SAVED' : 'SAVE RPC'}</button>
            {isCustom ? <button className="wal-btn" onClick={() => { uiSound('activate'); runProbe(); }} disabled={probe === 'probing'}>{probe === 'probing' ? 'TESTING…' : 'TEST'}</button> : null}
            {isCustom && confirmPublic ? (
              <InlineActionConfirm label="Confirm public RPC" confirmLabel="USE PUBLIC" busy={busy}
                onConfirm={revert} onCancel={() => { uiSound('close'); setConfirmPublic(false); }}>
                Remove this wallet's custom RPC from this browser? Reads and broadcasts will use
                the public endpoint; any privacy or MEV protection from your custom service may be lost.
              </InlineActionConfirm>
            ) : isCustom ? (
              <button className="wal-btn" disabled={busy} onClick={() => {
                if (!status.browser) { revert(); return; }
                uiSound('open'); setError(null); setConfirmPublic(true);
              }}>USE PUBLIC</button>
            ) : null}
          </div>
          {error ? <p className="wal-err label-data">{error}</p> : null}
        </>
      ) : null}
    </section>
  );
};

// --- Hardware wallet (Ledger) — read-only account discovery (me settings) ---

const LedgerSection = () => {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Only in the desktop app: a Ledger is reached over main-process USB, which a
  // browser tab has no bridge to.
  if (!isLedgerSupported()) return null;

  const connect = async () => {
    uiSound('activate');
    setBusy(true); setError(null); setAccounts(null);
    const r = await listLedgerAccounts({ count: 5 });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setAccounts(r.accounts);
  };

  return (
    <section className="wal-sec">
      <h3 className="wal-h label-data">HARDWARE WALLET — LEDGER</h3>
      <p className="wal-note">
        Read-only. This reads the public addresses already on your Ledger — your
        private keys never leave the device. Unlock it and open the Ethereum app first.
      </p>
      <div className="wal-form">
        <button className="wal-btn" onClick={connect} disabled={busy}>
          {busy ? 'READING…' : 'CONNECT & READ ACCOUNTS'}
        </button>
      </div>
      {error ? <p className="wal-err label-data">{error}</p> : null}
      {accounts ? (
        accounts.length === 0 ? (
          <EmptyState title="NO ACCOUNTS FOUND ON THIS DEVICE." />
        ) : (
          <ul className="wal-list">
            {accounts.map((a) => (
              <li key={a.path} className="wal-row cham">
                <div className="wal-row-in cham-in">
                  <span className="wal-addr">{formatAddress(a.address)}</span>
                  <span className="wal-label">{a.path}</span>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
};

export const MeSettings = ({ myWallets }) => (
  <>
    <NetworkSection />
    <RpcSection />
    <section className="wal-sec">
      <h3 className="wal-h label-data">YOUR WALLETS</h3>
      <p className="wal-note">Every wallet connected to you. The active one signs your sends.</p>
      {myWallets.length === 0 ? (
        <EmptyState title="NO WALLETS DETECTED." />
      ) : (
        <ul className="wal-list">
          {myWallets.map((w) => (
            <li key={w.rdns} className="wal-row cham">
              <div className="wal-row-in cham-in">
                <span className="wal-addr">{w.address ? formatAddress(w.address) : 'LOCKED'}</span>
                <span className="wal-label">{w.name}{w.balance != null ? ` · ${w.balance} ETH` : ''}</span>
                {w.active ? <span className="wal-active label-data">ACTIVE</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
    <RecoveryPhraseSection />
    <LedgerSection />
  </>
);
