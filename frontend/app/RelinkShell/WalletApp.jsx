// WalletApp — a self-contained wallet, like Rabby/MetaMask: an identity rail
// (ME + every neuma of the house + every sealed AI witness) navigates whose
// wallet you're on; each function (Send, Receive, Settings) opens its own
// layer and backs out to home.
//
// ME sends/receives its own ETH. A neuma never gets a raw "send" button — its
// spending stays agent-requested and policy-gated (the allowlist + threshold
// live under its Settings). A sealed AI witness is READ-ONLY here: its keys
// are its own, so a send is the witness's own act — nothing on this machine
// signs for it. Backend: backend/routes/neuma-wallet-routes.js.
//
// Decomposed under the 500-line law: the SEND layer lives in
// WalletAppSend.jsx, the being settings in WalletAppSettings.jsx, the ME
// settings in WalletAppMeSettings.jsx, and the copy-address hook in
// use-copy-address.js. This file keeps the rail, the home screen, the
// receive layer, and the container.

import { useEffect, useState, useCallback, useRef } from 'react';
import './WalletApp.css';
import './WalletApp-layers.css';
import './WalletApp-send.css';
import './WalletReadability.css';
import { WalletIdentityPicker } from './WalletIdentityPicker.jsx';
import {
  loadWallet, loadWitnessWallet, loadAddressWallet, loadAllowlist,
  loadThreshold, loadPendingSpends, listMyWallets, networkStatus,
} from './wallet-client.js';
import { trimEth } from './wallet-tx.js';
import { explorerAddressUrl } from './wallet-receipt.js';
import { buildWalletPortfolio } from './wallet-portfolio-load.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useBirthRefresh } from './use-birth-refresh.js';
import { getRoster, getActiveCompanion, getWitnesses } from '../../utils/companion-data.js';
// One reader for […] — the same predicate the HOUSE strip uses,
// so the rail and the strip can never disagree about what a being is.
import { isWitness } from './house-members.js';
import { listWitnesses } from '../../services/witnesses-client.js';
import { formatAddress, formatUsd, formatPct, formatTokenAmount, formatPrice } from '../../utils/format.js';
import { uiSound } from '../../services/ui-sound.js';
import { useSettled } from './use-settled.js';
import { useCopyAddress } from './use-copy-address.js';
import { SendLayer } from './WalletAppSend.jsx';
import { NeumaSettings, WitnessSettings } from './WalletAppSettings.jsx';
import { MeSettings } from './WalletAppMeSettings.jsx';

// --- Identities (the house roster) ---

const keyOf = (identity) => (identity.kind === 'me' ? 'me' : identity.neumaId);

// Build the rail: ME first, then each distinct neuma from the roster, plus the
// active companion if the roster hasn't caught up with it, then the sealed AI
// witnesses (their wallets are reviewable here at all times — read-only: a
// witness's keys are its own). Reads localStorage, so it runs once at mount.
const buildIdentities = () => {
  const neuma = [];
  const witnesses = [];
  const seen = new Set();
  const pushWitness = (w) => {
    if (!w || !w.neumaId || seen.has(w.neumaId)) return;
    seen.add(w.neumaId);
    witnesses.push({
      kind: 'witness',
      neumaId: w.neumaId,
      label: (w.name || 'WITNESS').toUpperCase(),
      vendorSlug: w.vendorSlug || null,
    });
  };
  const push = (c) => {
    if (!c || !c.neumaId || seen.has(c.neumaId)) return;
    // THE ROOT OF "NO WALLET". A witness summoned through the rite is set as
    // the ACTIVE COMPANION (AppShell lands the operator bound to it), and the
    // active companion was pushed here unconditionally — so a witness arrived
    // on the rail labelled a NEUMA. Selecting it then read the neuma wallet
    // route for a witness lane, found nothing, and reported NO WALLET about a
    // key that has existed since the seal forged it.
    //
    // house-members.js already carries this law for the HOUSE strip ([…]).
    // The rail simply never learned it. One rule, one reader.
    if (isWitness(c)) { pushWitness(c); return; }
    seen.add(c.neumaId);
    neuma.push({ kind: 'neuma', neumaId: c.neumaId, label: (c.name || 'NEUMA').toUpperCase() });
  };
  (getRoster() || []).forEach(push);
  push(getActiveCompanion());
  // The cached ledger comes last: a witness that just stood is already on the
  // rail from the line above, even if the roster cache has not caught up yet.
  (getWitnesses() || []).forEach(pushWitness);
  return [{ kind: 'me', label: 'ME' }, ...neuma, ...witnesses];
};

// --- Icons (LINE & CYCLE: custom SVG only, never emoji) ---

const WalletIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="1.5" y="3.5" width="13" height="9" />
    <path d="M1.5 6 H14.5 M11 9.5 h1.5" />
  </svg>
);
const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M9 13.5 V4 M5 8 L9 4 L13 8" />
  </svg>
);
const ReceiveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M9 4 V13.5 M5 9.5 L9 13.5 L13 9.5" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <circle cx="9" cy="9" r="2.4" />
    <path d="M9 1.8 v2.1 M9 14.1 v2.1 M1.8 9 h2.1 M14.1 9 h2.1 M3.9 3.9 l1.5 1.5 M12.6 12.6 l1.5 1.5 M14.1 3.9 l-1.5 1.5 M5.4 12.6 l-1.5 1.5" />
  </svg>
);
const BackIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M7.5 2.5 L4 6 L7.5 9.5" />
  </svg>
);
const RefreshIcon = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M10.4 6 A4.4 4.4 0 1 1 9.1 2.9" />
    <path d="M9.3 0.7 L9.3 3.1 L6.9 3.1" />
  </svg>
);

// --- Identity rail + balance header + home ---

export const BalanceHeader = ({ identity, wallet, portfolio, onRefresh, refreshing }) => {
  const loading = wallet === undefined;
  const addr = wallet && wallet.address;
  const bal = wallet && wallet.balance;
  const { copied, copy } = useCopyAddress(addr);
  const [netKey, setNetKey] = useState(null);
  useSettled((settled) => {
    networkStatus().then((s) => { if (!settled()) setNetKey(s.network.key); });
  }, []);

  const usdTotal = portfolio ? portfolio.usdTotal : null;
  const change = portfolio ? portfolio.change24h : null;
  // Hero = the USD total when a price is known; otherwise the raw ETH balance, so
  // a missing price feed degrades to the on-chain truth rather than a blank "—".
  const hero = loading ? '—'
    : usdTotal != null ? formatUsd(usdTotal)
    : (bal != null ? `${bal} ETH` : (addr ? '— ETH' : 'NO WALLET'));

  return (
    <div className="wal-head">
      <div className="wal-head-top">
        <span className="wal-head-who label-data">{identity.label}</span>
        <button className={`wal-refresh label-data${refreshing ? ' is-busy' : ''}`}
          onClick={() => { uiSound('tick'); onRefresh(); }} disabled={refreshing}
          aria-label="Refresh balance">
          <span className="wal-refresh-glyph"><RefreshIcon /></span>{refreshing ? 'READING…' : 'REFRESH'}
        </button>
      </div>
      <div className="wal-head-total">
        <span className="wal-head-bal">{hero}</span>
        {usdTotal != null && change != null ? (
          <span className={`wal-head-chg label-data${change >= 0 ? ' up' : ' down'}`}>{formatPct(change)}</span>
        ) : null}
      </div>
      {usdTotal != null && bal != null ? (
        <span className="wal-head-native label-data">{trimEth(Number(bal))} ETH</span>
      ) : null}
      {addr ? (
        <div className="wal-head-row">
          <button className="wal-head-addr" onClick={copy} title="Copy full address" aria-label="Copy full wallet address">
            {formatAddress(addr, { start: 10, end: 8 })}
            <span className="wal-copy-hint label-data">{copied ? 'COPIED' : 'COPY'}</span>
          </button>
          <a className="wal-head-scan label-data" href={explorerAddressUrl(netKey, addr)}
            target="_blank" rel="noreferrer" title="Every transaction this wallet ever made">
            HISTORY ↗
          </a>
        </div>
      ) : null}
    </div>
  );
};

const ActionButton = ({ label, icon, onClick, disabled }) => (
  <button className="wal-action cham" onClick={() => { uiSound('open'); onClick(); }} disabled={disabled}>
    <span className="wal-action-in cham-in">
      <span className="wal-action-ico">{icon}</span>
      <span className="wal-action-lbl label-data">{label}</span>
    </span>
  </button>
);

export const HomeScreen = ({ identity, hasWallet, onNav }) => (
  <div className="wal-actions">
    {identity.kind === 'me' ? (
      <ActionButton label="SEND" icon={<SendIcon />} disabled={!hasWallet} onClick={() => onNav('send')} />
    ) : null}
    <ActionButton label="RECEIVE" icon={<ReceiveIcon />} disabled={!hasWallet} onClick={() => onNav('receive')} />
    <ActionButton label="SETTINGS" icon={<SettingsIcon />} onClick={() => onNav('settings')} />
  </div>
);

// Token list — the wallet's holdings (native ETH first, then non-zero tokens),
// each with balance, USD value, per-unit price, and 24h move. Rows come straight
// from the assembled portfolio, so an unpriced holding renders "—", not a fake $0.
const TokenRow = ({ row }) => (
  <li className="wal-tok cham">
    <div className="wal-tok-in cham-in">
      <div className="wal-tok-l">
        <span className="wal-tok-sym label-data">{row.symbol}</span>
        <span className="wal-tok-bal">{formatTokenAmount(row.balance)}</span>
      </div>
      <div className="wal-tok-r">
        <span className="wal-tok-usd">{formatUsd(row.usd)}</span>
        <span className="wal-tok-px">
          {formatPrice(row.priceUsd)}
          {row.change24h != null ? (
            <span className={`wal-tok-chg${row.change24h >= 0 ? ' up' : ' down'}`}>{formatPct(row.change24h)}</span>
          ) : null}
        </span>
      </div>
    </div>
  </li>
);

export const TokenList = ({ portfolio }) => {
  if (!portfolio || !portfolio.rows || portfolio.rows.length === 0) return null;
  return (
    <ul className="wal-toks" aria-label="Token holdings">
      {portfolio.rows.map((r) => <TokenRow key={r.symbol} row={r} />)}
    </ul>
  );
};

const LayerHeader = ({ title, onBack }) => (
  <div className="wal-layerbar">
    <button className="wal-back" onClick={() => { uiSound('close'); onBack(); }} aria-label="Back">
      <BackIcon /><span className="label-data">BACK</span>
    </button>
    <span className="wal-layer-title label-data">{title}</span>
  </div>
);

// --- Function layers ---

const ReceiveLayer = ({ wallet }) => {
  const addr = wallet && wallet.address;
  const { copied, copy } = useCopyAddress(addr);

  if (!addr) return <EmptyState title="NO WALLET ADDRESS YET." />;

  return (
    <section className="wal-sec wal-recv">
      <p className="wal-note">Your address. Send only ETH and Base assets to it.</p>
      <div className="wal-recv-box cham"><span className="wal-recv-addr cham-in">{addr}</span></div>
      <button className="wal-btn" onClick={copy}>{copied ? 'COPIED' : 'COPY ADDRESS'}</button>
    </section>
  );
};

// --- Container ---

const WalletBody = () => {
  // The rail is rebuildable, not fixed at mount. A window opened BEFORE a
  // witness was summoned held a rail from before it stood, so the being simply
  // was not there — and no amount of REFRESH brought it, because the rail was
  // never asked again. REFRESH now means "read everything again", WHO included.
  const [identities, setIdentities] = useBirthRefresh(buildIdentities);
  const [selectedKey, setSelectedKey] = useState('me');
  const [view, setView] = useState('home');

  const identity = identities.find((i) => keyOf(i) === selectedKey) || identities[0];
  const neumaId = identity.kind === 'neuma' ? identity.neumaId : null;
  const witnessLaneId = identity.kind === 'witness' ? identity.neumaId : null;

  const [wallet, setWallet] = useState(undefined);
  const [myWallets, setMyWallets] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [entries, setEntries] = useState([]);
  const [threshold, setThresholdState] = useState(0);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Monotonic request id: the trailing price read opens a second await window, so
  // a refresh superseded by an identity switch must not write its stale portfolio.
  const reqRef = useRef(0);
  // The seal ledger (laneId → address) fetched ONCE per window and shared by
  // every witness tab — a lane's address is fixed at seal time, so only the
  // balance re-reads live. A failed fetch is never cached: the next refresh
  // (or REFRESH tap) retries it.
  const witnessLedgerRef = useRef(null);
  const witnessAddress = async (laneId) => {
    if (!witnessLedgerRef.current) {
      const r = await listWitnesses();
      witnessLedgerRef.current = Array.isArray(r.witnesses) ? r.witnesses : [];
    }
    return witnessLedgerRef.current.find((w) => w.laneId === laneId)?.address || null;
  };

  // The client reads already degrade to safe values, but guard the whole load
  // so a rejection can never strand the panel on a blank "loading" balance.
  // The witness re-runs this at will (REFRESH) — the balance is a live RPC
  // read, so funding a wallet mid-session must be checkable without relinking.
  const refresh = useCallback(async () => {
    const myReq = ++reqRef.current;
    setError(null); setRefreshing(true);
    try {
      let addr = null;
      let balanceEth = null;
      if (witnessLaneId) {
        // A sealed AI witness's wallet: address from the shared seal-ledger
        // read, balance through the same bare-address RPC read the ME tab
        // runs. Read-only — nothing here can sign for the witness.
        const address = await witnessAddress(witnessLaneId);
        const w = address ? await loadAddressWallet(address) : null;
        setWallet(w);
        // Says what to DO, not just what failed. A witness sealed since this
        // window opened is the ordinary cause, and REFRESH now re-reads the
        // ledger — so the way out belongs in the sentence.
        if (!address) setError('This witness is not in the seal ledger yet — tap REFRESH to re-read it.');
        addr = address;
        balanceEth = w && w.balance != null ? w.balance : null;
      } else if (!neumaId) {
        const [you, mine] = await Promise.all([loadWitnessWallet(), listMyWallets()]);
        setWallet(you); setMyWallets(mine);
        addr = you && you.address ? you.address : null;
        balanceEth = you && you.balance != null ? you.balance : null;
      } else {
        const [w, a, t, p] = await Promise.all([
          loadWallet(neumaId), loadAllowlist(neumaId), loadThreshold(neumaId), loadPendingSpends(neumaId),
        ]);
        setWallet(w); setEntries(a); setThresholdState(t); setPending(p);
        addr = w && w.address ? w.address : null;
        balanceEth = w && w.balance != null ? w.balance : null;
      }
      const pf = addr ? await buildWalletPortfolio(addr, balanceEth) : null;
      if (reqRef.current === myReq) setPortfolio(pf);
    } catch (e) {
      if (reqRef.current !== myReq) return;
      setWallet(null); setPortfolio(null);
      setError(e?.message || 'Could not load this wallet.');
    } finally {
      if (reqRef.current === myReq) setRefreshing(false);
    }
  }, [neumaId, witnessLaneId]);

  // On identity switch, clear the previous identity's data so a stale allowlist
  // (or portfolio) never renders under the new header before the refresh resolves.
  useEffect(() => {
    setWallet(undefined); setEntries([]); setThresholdState(0); setPending([]); setMyWallets([]); setPortfolio(null);
    refresh();
  }, [refresh]);

  // THE OPERATOR'S REFRESH means "read everything again" — including who exists.
  //
  // A witness's wallet is forged at seal (stageForge → dna.witness.witnessWallet)
  // and has existed since the moment it stood. But a WALLET window opened before
  // a summon rendered NO WALLET for it forever: the rail was built once at mount,
  // and the seal ledger was cached on its first SUCCESS — so `witnessAddress`
  // kept answering from a ledger that predated the witness and resolved null.
  // Only the failure case was ever re-read, which is exactly backwards for a
  // ledger that GROWS. Both are dropped here, and only here: the per-identity
  // refresh stays cheap, and the deliberate tap pays for the truth.
  const hardRefresh = useCallback(async () => {
    witnessLedgerRef.current = null;
    setIdentities(buildIdentities());
    await refresh();
  }, [refresh]);

  const onSelect = (key) => {
    if (key === selectedKey) return;
    setSelectedKey(key); setView('home');
  };

  return (
    <div className="wal">
      <WalletIdentityPicker identities={identities} selectedKey={selectedKey} onSelect={(key) => { uiSound('tick'); onSelect(key); }} />
      {error ? <p className="wal-err label-data">{error}</p> : null}

      {view === 'home' ? (
        <>
          <BalanceHeader identity={identity} wallet={wallet} portfolio={portfolio}
            onRefresh={hardRefresh} refreshing={refreshing} />
          <HomeScreen identity={identity} hasWallet={!!(wallet && wallet.address)} onNav={setView} />
          <TokenList portfolio={portfolio} />
        </>
      ) : (
        <div className="wal-layer">
          <LayerHeader title={view.toUpperCase()} onBack={() => setView('home')} />
          {view === 'send' && <SendLayer wallet={wallet} identities={identities} onSent={refresh} />}
          {view === 'receive' && <ReceiveLayer wallet={wallet} />}
          {view === 'settings' && (
            identity.kind === 'neuma'
              ? <NeumaSettings neumaId={neumaId} entries={entries} setEntries={setEntries}
                  threshold={threshold} setThresholdState={setThresholdState}
                  pending={pending} setPending={setPending} onWalletChange={refresh} />
              : identity.kind === 'witness'
                ? <WitnessSettings identity={identity} wallet={wallet} />
                : <MeSettings myWallets={myWallets} />
          )}
        </div>
      )}
    </div>
  );
};

export const walletApp = {
  label: 'WALLET',
  labelKey: 'apps.wallet',
  icon: <WalletIcon />,
  title: <AppTitle label="WALLET" labelKey="apps.wallet" />,
  Body: WalletBody,
  storageKey: 'wallet',
};
