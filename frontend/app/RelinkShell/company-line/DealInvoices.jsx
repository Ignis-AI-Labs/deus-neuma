// DealInvoices — a won deal is billed from here (Design note, 2026-11-21: […]).
// The won deals as a sheet; a deal's row opens onto its invoices and the form that issues one: what each line bills,
// when it falls due, and which ways it can be paid — BY CARD (your own Stripe account makes the invoice its payment
// link) and IN CRYPTO (your own address), each offered only when you have set it up. An open invoice is emailed to
// the buyer from the house mailbox on your press, voided with why, and marked PAID by the house itself: by card when
// Stripe says so, in crypto when the money lands.
// impure — reads and writes through the revenue routes.
import { useCallback, useEffect, useState } from 'react';
import { Sheet } from '../sheet/Sheet.jsx';
import { getInvoices, issueDealInvoice, sendDealInvoice, voidDealInvoice, checkInvoices } from '../../../services/revenue-client.js';

const day = (iso) => String(iso ?? '').slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const standing = (v) => (v.status === 'paid' ? `PAID ${v.paid?.card ? 'BY CARD' : 'IN CRYPTO'} · ${day(v.paid?.at)}` : v.status === 'void' ? 'VOID' : v.overdue ? `OVERDUE · WAS DUE ${v.due}` : `OPEN · DUE ${v.due}`);
const waysWords = (v) => [v.byCard ? (v.card ? 'CARD' : 'CARD (LINK NOT MADE YET)') : null, v.payTo ? 'CRYPTO' : null].filter(Boolean).join(' + ');

// One invoice of the deal: where it stands, how it is paid, and what can still be done with it.
const InvoiceLine = ({ v, busy, act }) => {
  const [to, setTo] = useState(v.buyerContact ?? '');
  const [why, setWhy] = useState('');
  return (
    <li className="cline-inv" data-invoice={v.id} data-invoice-status={v.status}>
      <p className="cline-move-t"><b>{v.number}</b> · {v.total} {v.currency} · {standing(v)} · PAID BY {waysWords(v) || '—'}{v.sent?.length ? ` · SENT TO ${v.sent.at(-1).to} ON ${day(v.sent.at(-1).at)}` : ' · NOT SENT YET'}</p>
      {v.card?.url ? <p className="cline-move-t">CARD LINK{v.card.live ? '' : ' (STRIPE TEST MODE)'}: <a className="cline-link" href={v.card.url} target="_blank" rel="noreferrer noopener">{v.card.url}</a></p> : null}
      {v.status === 'open' ? (
        <div className="cline-open">
          <input className="cline-input" type="email" aria-label={`The buyer's address ${v.number} is sent to`} placeholder="buyer's email address" disabled={busy} value={to} onChange={(e) => setTo(e.target.value)} />
          <button type="button" className="sec-scan label-data" disabled={busy || !/^\S+@\S+\.\S+$/.test(to.trim())} data-invoice-send="" onClick={() => act(() => sendDealInvoice(v.id, to.trim()))}>{v.sent?.length ? 'SEND AGAIN' : 'SEND TO THE BUYER'}</button>
          <input className="cline-input" aria-label={`Why ${v.number} is void`} placeholder="why it is void" maxLength={300} disabled={busy} value={why} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" className="sec-scan cline-danger label-data" disabled={busy || why.trim().length < 5} data-invoice-void="" onClick={() => act(() => voidDealInvoice(v.id, why.trim()))}>VOID</button>
        </div>
      ) : null}
      {v.status === 'void' && v.voided?.reason ? <p className="cline-move-t">VOID: {v.voided.reason}</p> : null}
    </li>
  );
};

// The form that issues one invoice for a deal.
const IssueForm = ({ deal, ways, left, busy, act }) => {
  const cardCan = Boolean(ways?.card?.ready);
  const cryptoCan = Boolean(ways?.crypto);
  const [lines, setLines] = useState([{ what: '', amount: '' }]);
  const [due, setDue] = useState(inDays(14));
  const [note, setNote] = useState('');
  const [card, setCard] = useState(true);
  const [crypto, setCrypto] = useState(true);
  const set = (i, key, value) => setLines((was) => was.map((l, n) => (n === i ? { ...l, [key]: value } : l)));
  const filled = lines.filter((l) => l.what.trim().length >= 3 && Number(l.amount) > 0);
  const total = Math.round(filled.reduce((sum, l) => sum + Number(l.amount), 0) * 100) / 100;
  const byCard = cardCan && card;
  const inCrypto = cryptoCan && crypto;
  const ready = filled.length > 0 && filled.length === lines.filter((l) => l.what.trim() || l.amount).length && (byCard || inCrypto) && total <= left + 1e-9 && /^\d{4}-\d{2}-\d{2}$/.test(due);
  const issue = () => act(async () => {
    const done = await issueDealInvoice(deal.id, { lines: filled.map((l) => ({ what: l.what.trim(), amount: Number(l.amount) })), due, ...(note.trim() ? { note: note.trim() } : {}), card: byCard, crypto: inCrypto });
    setLines([{ what: '', amount: '' }]);
    setNote('');
    return done;
  });
  if (!cardCan && !cryptoCan) {
    return (
      <p className="cline-move-t" data-invoice-ways="none">
        TO BILL THIS DEAL, SET AT LEAST ONE WAY TO BE PAID. BY CARD: ATTACH YOUR STRIPE KEY UNDER SETTINGS, API, PAYMENTS, THEN TURN ON CARD PAYMENTS UNDER CONNECTIONS{ways?.card?.on === false ? '' : ' (IT IS ON; THE KEY IS MISSING)'}.
        IN CRYPTO: SET THE ADDRESS INVOICES ARE PAID TO IN TREASURY.
      </p>
    );
  }
  return (
    <div className="cline-deal" data-invoice-form={deal.id}>
      <p className="cline-h label-data">NEW INVOICE — {left} {deal.value.currency} OF THIS DEAL IS NOT BILLED YET</p>
      {lines.map((l, i) => (
        <div className="cline-open" key={i}>
          <input className="cline-input" aria-label={`Line ${i + 1}: what it bills`} placeholder="what this line bills" maxLength={200} disabled={busy} value={l.what} onChange={(e) => set(i, 'what', e.target.value)} />
          <input className="cline-input cline-deal-n" type="number" min="0" step="0.01" aria-label={`Line ${i + 1}: its amount in ${deal.value.currency}`} placeholder="amount" disabled={busy} value={l.amount} onChange={(e) => set(i, 'amount', e.target.value)} />
          {lines.length > 1 ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`Remove line ${i + 1}`} onClick={() => setLines((was) => was.filter((_, n) => n !== i))}>REMOVE</button> : null}
        </div>
      ))}
      <div className="cline-open">
        <button type="button" className="sec-scan label-data" disabled={busy || lines.length >= 20} onClick={() => setLines((was) => [...was, { what: '', amount: '' }])}>ADD A LINE</button>
        <label className="cline-check label-data">DUE <input className="cline-input" type="date" aria-label="The date the invoice falls due" disabled={busy} value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <input className="cline-input" aria-label="A note printed on the invoice (optional)" placeholder="note on the invoice (optional)" maxLength={600} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="cline-open" role="group" aria-label="The ways this invoice can be paid">
        <label className="cline-check label-data"><input type="checkbox" disabled={busy || !cardCan} checked={byCard} onChange={(e) => setCard(e.target.checked)} /> BY CARD (STRIPE){cardCan ? '' : ' — NOT SET UP'}</label>
        <label className="cline-check label-data"><input type="checkbox" disabled={busy || !cryptoCan} checked={inCrypto} onChange={(e) => setCrypto(e.target.checked)} /> IN CRYPTO{cryptoCan ? '' : ' — NO ADDRESS SET'}</label>
        <button type="button" className="sec-scan label-data" disabled={busy || !ready} data-invoice-issue="" onClick={issue}>ISSUE THE INVOICE{total ? ` · ${total} ${deal.value.currency}` : ''}</button>
      </div>
      {total > left + 1e-9 ? <p className="cline-move-t" role="status">THAT IS MORE THAN IS LEFT TO BILL ON THIS DEAL ({left} {deal.value.currency}).</p> : null}
    </div>
  );
};

/** @param {{won: object[], deliveries: object[]}} props */
export const WonDeals = ({ won, deliveries = [] }) => {
  const [board, setBoard] = useState({ invoices: [], ways: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [said, setSaid] = useState(null);
  const read = useCallback(() => getInvoices().then((b) => setBoard({ invoices: b?.invoices ?? [], ways: b?.ways ?? null }), () => {}), []);
  useEffect(() => { read(); }, [read]);
  const act = async (fn) => {
    setBusy(true); setError(null); setSaid(null);
    try {
      const done = await fn();
      if (done?.invoices) setBoard({ invoices: done.invoices, ways: done.ways ?? board.ways });
      if (done?.cardProblem) setSaid(`THE INVOICE IS ISSUED, WITHOUT ITS CARD LINK YET: ${String(done.cardProblem).toUpperCase()}. IT IS ASKED FOR AGAIN WHEN YOU SEND IT.`);
      else if (done?.to) setSaid(`SENT TO ${String(done.to).toUpperCase()}.`);
      else if (Array.isArray(done?.paid)) setSaid(done.paid.length ? `PAID: ${done.paid.join(', ')}.` : 'STRIPE SAYS NOTHING NEW IS PAID.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const of = (dealId) => board.invoices.filter((v) => v.dealId === dealId);
  const billed = (dealId) => Math.round(of(dealId).filter((v) => v.status !== 'void').reduce((s, v) => s + v.total, 0) * 1e6) / 1e6;
  const openCard = board.invoices.some((v) => v.status === 'open' && v.card);
  if (!won.length) return null;
  return (
    <>
      <Sheet label="won deals" rows={won} rowKey={(d) => d.id} rowName={(d) => d.buyer} rowAttrs={(d) => ({ 'data-deal-id': d.id })}
        detailLabel={() => 'its invoices, and bill it'}
        detail={(d) => (
          <div className="cline-deal" data-deal-invoices={d.id}>
            {of(d.id).length ? <ol className="cline-deal-notes" aria-label={`the invoices of the deal with ${d.buyer}, newest first`}>{of(d.id).map((v) => <InvoiceLine key={v.id} v={v} busy={busy} act={act} />)}</ol> : null}
            {Math.round((d.value.amount - billed(d.id)) * 1e6) / 1e6 > 0
              ? <IssueForm deal={d} ways={board.ways} left={Math.round((d.value.amount - billed(d.id)) * 1e6) / 1e6} busy={busy} act={act} />
              : <p className="cline-move-t">THE WHOLE DEAL IS BILLED.</p>}
          </div>
        )}
        columns={[{ head: 'BUYER', cell: (d) => d.buyer }, { head: 'STAGE', cell: () => 'WON', tone: () => 'on' }, { head: 'VALUE', cell: (d) => `${d.value.amount} ${d.value.currency}` },
          { head: 'BILLED', sort: (d) => billed(d.id), cell: (d) => (of(d.id).length ? `${billed(d.id)} ${d.value.currency}` : 'NOT BILLED'), tone: (d) => (of(d.id).length ? undefined : 'alert') },
          { head: 'PAID', sort: (d) => of(d.id).filter((v) => v.status === 'paid').length, cell: (d) => { const all = of(d.id).filter((v) => v.status !== 'void'); return all.length ? `${all.filter((v) => v.status === 'paid').length} OF ${all.length}` : null; }, tone: (d) => (of(d.id).some((v) => v.overdue) ? 'alert' : of(d.id).some((v) => v.status === 'paid') ? 'on' : undefined) },
          { head: 'DELIVERED', cell: (d) => {
            const sent = deliveries.filter((p) => p.dealId === d.id);
            return sent.length ? sent.map((p) => <span key={p.id} data-delivery={p.id}>{p.name}: <a className="cline-link" href={p.link} target="_blank" rel="noreferrer noopener">{p.link}</a> </span>) : null;
          } }]} />
      {openCard ? <div className="cline-open"><button type="button" className="sec-scan label-data" disabled={busy} data-invoice-check="" onClick={() => act(checkInvoices)}>ASK STRIPE NOW</button><span className="cline-move-t">THE HOUSE ASKS STRIPE EVERY 10 MINUTES WHETHER AN OPEN CARD INVOICE WAS PAID, AND TELLS YOU WHEN ONE IS.</span></div> : null}
      {said ? <p className="cline-move-t" role="status" data-invoice-said="">{said}</p> : null}
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
    </>
  );
};
