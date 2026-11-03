// InvoicesSection — the TREASURY window's INVOICES: where the house's invoices
// are paid (the operator's own Ethereum address, set here and nowhere else —
// no being writes payment details), and every invoice the Quaestor issued,
// newest first: open ones with the receipts that may pay them (PAID BY …) and
// a VOID that names why; paid and void ones with what became of them.
// Pure rendering; the drafts and the IO live in TreasuryApp.jsx.

import { invoiceWords, candidateWords, settledWords, standing } from './invoice-view.js';

const Invoice = ({ v, drafts, busy, onDraft, onPaid, onVoid }) => {
  const key = `invoice:${v.id}`;
  const reason = drafts[key]?.reason ?? '';
  return (
    <li className="tre-cost-entry" data-invoice={v.number}>
      <span className={`tre-cost-h${standing(v) === 'OVERDUE' ? ' is-loud' : ''}`}>{invoiceWords(v)}</span>
      {v.lines.map((l, i) => <span key={i} className="tre-cost-line">{l.what} — {l.amount} {v.currency}</span>)}
      {settledWords(v) ? <span className="tre-cost-src">{settledWords(v)}</span> : (
        <>
          {v.candidates.length === 0 ? <span className="tre-cost-src">NO PAYMENT HAS LANDED AT ITS ADDRESS YET</span> : (
            <span className="tre-cost-void">
              {v.candidates.map((c) => (
                <button key={c.key} type="button" className="sec-scan" disabled={busy} onClick={() => onPaid(v.id, c.key)}>{candidateWords(c)}</button>
              ))}
            </span>
          )}
          <span className="tre-cost-void">
            <input className="tre-input" aria-label={`Why ${v.number} is void`} placeholder="why this invoice is void" disabled={busy}
              value={reason} onChange={(e) => onDraft(key, 'reason', e.target.value)} />
            <button type="button" className="sec-scan legal-danger" disabled={busy || reason.trim().length < 5} onClick={() => onVoid(v.id, reason)}>VOID</button>
          </span>
        </>
      )}
    </li>
  );
};

export const InvoicesSection = ({ invoices, drafts, busy, onDraft, onPayTo, onPaid, onVoid }) => {
  const address = drafts.payTo?.address ?? '';
  return (
    <section className="tre-sec tre-costs" data-treasury-section="invoices">
      <p className="tre-h label-data">INVOICES — MONEY IN, ON ETHEREUM</p>
      {!invoices ? <p className="tre-cost-miss">THE INVOICES COULD NOT BE READ.</p> : (
        <>
          {invoices.payTo
            ? <p className="tre-cost-h" data-invoice-wallet="set">PAID TO: <span className="tre-exact">{invoices.payTo.address}</span> ON ETHEREUM · WATCHED FOR MONEY IN</p>
            : <p className="tre-cost-miss" data-invoice-wallet="unset">WHERE INVOICES ARE PAID IS NOT SET — NO INVOICE CAN BE ISSUED UNTIL YOU SET IT</p>}
          <p className="tre-cost-note">
            Only you set where the house is paid; your Quaestor never writes it. Each invoice carries the address you set when it was issued.
            Customers pay USD invoices in USDC, USDT or DAI, and ETH invoices in ether.
          </p>
          <div className="tre-cost-form" data-cost-form="pay-to">
            <label className="tre-field">
              <span className="tre-field-l">Receiving wallet (0x…)</span>
              <input className="tre-input" aria-label="Receiving wallet (0x…)" disabled={busy} value={address} onChange={(e) => onDraft('payTo', 'address', e.target.value)} />
            </label>
            <button type="button" className="sec-scan" disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(address.trim())} onClick={onPayTo}>
              {invoices.payTo ? 'CHANGE WHERE INVOICES ARE PAID' : 'SET WHERE INVOICES ARE PAID'}
            </button>
          </div>
          <p className="tre-h label-data">{invoices.invoices.length} INVOICE{invoices.invoices.length === 1 ? '' : 'S'} — THE QUAESTOR ISSUES THEM FROM DEALS THE MERCATOR WON</p>
          <ul className="tre-rows">
            {invoices.invoices.map((v) => <Invoice key={v.id} v={v} drafts={drafts} busy={busy} onDraft={onDraft} onPaid={onPaid} onVoid={onVoid} />)}
          </ul>
        </>
      )}
    </section>
  );
};
