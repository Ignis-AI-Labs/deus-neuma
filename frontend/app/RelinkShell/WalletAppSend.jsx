// WalletAppSend — the SEND layer of the wallet window: the dotted-leader
// readout row (Leader), the post-send on-chain receipt (TxReceipt), and the
// send form itself (SendLayer). Extracted from WalletApp.jsx under the
// 500-line law; Leader is exported because the witness settings readout
// (WalletAppSettings.jsx) speaks the same data line.

import { useState } from 'react';
import { loadWallet, sendEth, networkStatus } from './wallet-client.js';
import { allocAmount, allocFraction, trimEth } from './wallet-tx.js';
import { explorerTxUrl, explorerName, fetchTxBreakdown } from './wallet-receipt.js';
import { formatAddress } from '../../utils/format.js';
import { uiSound } from '../../services/ui-sound.js';
import { useSettled } from './use-settled.js';
import { useCopyAddress } from './use-copy-address.js';

// Dotted-leader readout row — the codex data line. Every value it shows is a
// real read; '…' means "still reading", never a decoration.
export const Leader = ({ k, v, tone }) => (
  <div className="wal-lead">
    <span className="wal-lead-k label-data">{k}</span>
    <span className="wal-lead-dots" aria-hidden="true" />
    <span className={`wal-lead-v label-data${tone ? ` ${tone}` : ''}`}>{v}</span>
  </div>
);

// The full post-send breakdown, read back from the chain through our own RPC
// and re-read until the receipt lands. Complete by doctrine: value, gas used,
// effective price, fee, total debit, block, nonce, endpoints, network — and
// the road to the same record on Basescan. Capital never gets a partial readout.
const TxReceipt = ({ hash }) => {
  const [bd, setBd] = useState(null);
  const [net, setNet] = useState(null);
  const { copied, copy } = useCopyAddress(hash);

  useSettled((settled) => {
    networkStatus().then((s) => { if (!settled()) setNet(s.network); });
  }, []);

  // Poll every 3s until confirmed/reverted (Base confirms in seconds; the cap
  // only bounds a dead RPC). The status honestly stays PENDING until the
  // receipt exists — no optimistic "done".
  useSettled((settled) => {
    let tries = 0;
    const read = async () => {
      const b = await fetchTxBreakdown(hash);
      if (settled()) return;
      setBd(b);
      if (b.status === 'pending' && ++tries < 40) setTimeout(read, 3000);
    };
    read();
  }, [hash]);

  const s = bd ? bd.status : 'pending';
  const words = s === 'success' ? '«CONFIRMED» — SETTLED ON CHAIN'
    : s === 'reverted' ? '«REVERTED» — THE CHAIN REFUSED IT'
    : '«PENDING» — AWAITING CONFIRMATION';
  return (
    <section className={`wal-rcpt cham is-${s}`} aria-label="Transaction breakdown">
      <div className="wal-rcpt-in cham-in">
        <div className="wal-rcpt-bar">
          <span className="wal-rcpt-status label-data">{words}</span>
          <a className="wal-rcpt-link label-data" href={explorerTxUrl(net && net.key, hash)}
            target="_blank" rel="noreferrer">{explorerName(net && net.key)} ↗</a>
        </div>
        <button className="wal-hash" onClick={copy} title="Copy transaction hash">
          {hash}
          <span className="wal-copy-hint label-data">{copied ? 'COPIED' : 'COPY'}</span>
        </button>
        <div className="wal-leads">
          <Leader k="VALUE" v={bd && bd.valueEth != null ? `${bd.valueEth} ETH` : '…'} />
          <Leader k="GAS USED" v={bd && bd.gasUsed != null ? Number(bd.gasUsed).toLocaleString() : '…'} />
          <Leader k="GAS PRICE" v={bd && bd.gasPriceGwei != null ? `${bd.gasPriceGwei} GWEI` : '…'} />
          <Leader k="NETWORK FEE" v={bd && bd.feeEth != null ? `${bd.feeEth} ETH` : '…'} />
          <Leader k="TOTAL DEBIT" v={bd && bd.totalEth != null ? `${bd.totalEth} ETH` : '…'} tone="hot" />
          <Leader k="BLOCK" v={bd && bd.block != null ? bd.block.toLocaleString() : '…'} />
          <Leader k="NONCE" v={bd && bd.nonce != null ? String(bd.nonce) : '…'} />
          <Leader k="FROM" v={bd && bd.from ? formatAddress(bd.from) : '…'} />
          <Leader k="TO" v={bd && bd.to ? formatAddress(bd.to) : '…'} />
          <Leader k="NETWORK" v={net ? net.label.toUpperCase() : '…'} />
        </div>
      </div>
    </section>
  );
};

// MAX leaves this much ETH untouched for gas — sending the literal full
// balance always dies at sign time. Stated on the instrument, not hidden.
const GAS_RESERVE_ETH = 0.0002;
const ALLOC_CHIPS = [
  { label: '25%', fraction: 0.25 },
  { label: '50%', fraction: 0.5 },
  { label: '75%', fraction: 0.75 },
  { label: 'MAX', fraction: 1 },
];

export const SendLayer = ({ wallet, identities, onSent }) => {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState(null);
  const [house, setHouse] = useState([]);

  const bal = wallet && wallet.balance != null ? Number(wallet.balance) : null;
  const frac = allocFraction(amount, bal);
  const remaining = bal != null && Number(amount) > 0 ? bal - Number(amount) : null;

  // The house as recipients: each neuma's address, one tap. Sending resources
  // to your own beings is THE send this wallet exists for.
  useSettled((settled) => {
    const kin = (identities || []).filter((i) => i.kind === 'neuma');
    Promise.all(kin.map(async (i) => {
      const w = await loadWallet(i.neumaId);
      return w && w.address ? { label: i.label, address: w.address } : null;
    })).then((rows) => { if (!settled()) setHouse(rows.filter(Boolean)); });
  }, [identities]);

  // sendEth runs the authoritative (balance-aware) validation, so the layer
  // just dispatches and surfaces the result — no duplicated form checks.
  const submit = async () => {
    uiSound('activate');
    setError(null); setHash(null); setBusy(true);
    const r = await sendEth({ to, amountEth: amount, balanceEth: wallet && wallet.balance });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setHash(r.hash);
    if (onSent) onSent();
  };

  const allocate = (fraction) => {
    uiSound('tick');
    setAmount(allocAmount(bal, fraction, GAS_RESERVE_ETH));
  };

  return (
    <section className="wal-sec wal-send">
      <p className="wal-note">
        Send ETH from your wallet. Nothing moves until your wallet asks you to
        confirm — the signature is the act.
      </p>

      <h3 className="wal-h label-data">TO</h3>
      {house.length > 0 ? (
        <div className="wal-house" role="group" aria-label="House recipients">
          {house.map((h) => (
            <button key={h.address}
              className={`wal-chip label-data${to === h.address ? ' is-active' : ''}`}
              onClick={() => { uiSound('tick'); setTo(h.address); }}>
              {h.label}
            </button>
          ))}
        </div>
      ) : null}
      <input className="wal-in wal-in-wide" placeholder="0x recipient address" value={to}
        onChange={(e) => setTo(e.target.value)} spellCheck={false} />

      <h3 className="wal-h label-data">AMOUNT</h3>
      <div className="wal-send-display" aria-live="polite">
        <span className="wal-send-num">{amount || '0'}</span>
        <span className="wal-send-unit label-data">ETH</span>
        <span className="wal-send-alloc label-data">{`ALLOC ${Math.round(frac * 100)}%`}</span>
      </div>
      <div className="wal-alloc">
        <div className="wal-chiprow" role="group" aria-label="Balance allocation presets">
          {ALLOC_CHIPS.map((c) => (
            <button key={c.label}
              className={`wal-chip label-data${bal > 0 && amount === allocAmount(bal, c.fraction, GAS_RESERVE_ETH) ? ' is-active' : ''}`}
              onClick={() => allocate(c.fraction)} disabled={!(bal > 0)}>
              {c.label}
            </button>
          ))}
        </div>
        <input type="range" className="wal-slider" min="0" max="1000" step="1"
          value={Math.round(frac * 1000)}
          onChange={(e) => setAmount(allocAmount(bal, Number(e.target.value) / 1000, GAS_RESERVE_ETH))}
          disabled={!(bal > 0)}
          style={{ '--alloc': `${frac * 100}%` }}
          aria-label="Balance allocation slider" />
        <div className="wal-ticks label-data" aria-hidden="true">
          <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
        </div>
      </div>
      <div className="wal-leads">
        <Leader k="BALANCE" v={bal != null ? `${trimEth(bal)} ETH` : '—'} />
        <Leader k="REMAINING AFTER" v={remaining != null ? `${trimEth(remaining)} ETH` : '—'}
          tone={remaining != null && remaining < GAS_RESERVE_ETH ? 'warn' : undefined} />
        <Leader k="GAS RESERVE (MAX)" v={`${GAS_RESERVE_ETH} ETH`} />
      </div>

      <div className="wal-form">
        <input className="wal-in wal-in-num" type="number" min="0" step="0.0001" placeholder="amount"
          value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span className="wal-unit label-data">ETH</span>
        <button className="wal-btn" onClick={submit} disabled={busy}>{busy ? 'CONFIRM IN WALLET…' : 'SEND'}</button>
      </div>
      {error ? <p className="wal-err label-data">{error}</p> : null}
      {hash ? <TxReceipt hash={hash} /> : null}
    </section>
  );
};
