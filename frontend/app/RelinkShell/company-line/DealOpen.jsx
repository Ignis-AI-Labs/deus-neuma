// DealOpen — the operator opens a deal with their own hand (Design note, 2026-11-21: which company it is for, who the buyer
// is, what it is worth, where it hurts them and what fixing it is worth to them, and the one next step. The same
// record the sales member's act makes. Named by a lead's address, the deal is tied to that lead and the lead is marked
// qualified, so the costs sheet can count it.
// impure — one call to the revenue routes; the screen that holds it reads the board again after.
import { useState } from 'react';
import { openDeal } from '../../../services/revenue-client.js';

const EMPTY = { buyer: '', lead: '', amount: '', currency: 'USD', problem: '', needPayoff: '', nextStep: '' };

/** @param {{companies: Array<{id: string, name: string}>, onOpened: () => void}} props */
export const DealOpen = ({ companies = [], onOpened = () => {} }) => {
  const [company, setCompany] = useState('');
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setF((was) => ({ ...was, [key]: e.target.value }));
  const chosen = companies.find((c) => c.id === company) ?? companies[0] ?? null;
  const amount = Number(f.amount);
  const ready = chosen && f.buyer.trim().length >= 2 && Number.isFinite(amount) && amount >= 0 && f.amount !== '' && /^[A-Za-z]{3}$/.test(f.currency.trim())
    && f.problem.trim().length >= 10 && f.needPayoff.trim().length >= 10 && f.nextStep.trim().length >= 5;
  const press = async () => {
    setBusy(true);
    setError(null);
    try {
      await openDeal({ company: chosen.id, buyer: f.buyer.trim(), ...(f.lead.trim() ? { leadContact: f.lead.trim() } : {}), value: { amount, currency: f.currency.trim().toUpperCase() },
        spin: { problem: f.problem.trim(), needPayoff: f.needPayoff.trim() }, nextStep: f.nextStep.trim() });
      setF(EMPTY);
      onOpened();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (!companies.length) return <p className="cline-move-t" data-deal-open="none">A DEAL IS OPENED FOR ONE OF YOUR COMPANIES — ADD A COMPANY FIRST.</p>;
  return (
    <div className="cline-deal" data-deal-open="">
      <p className="cline-h label-data">OPEN A DEAL</p>
      <div className="cline-open">
        <select className="cline-input cline-deal-pick" aria-label="The company the deal is for" disabled={busy} value={chosen?.id ?? ''} onChange={(e) => setCompany(e.target.value)}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="cline-input" aria-label="The buyer: the company or person the deal is with" placeholder="buyer" maxLength={120} disabled={busy} value={f.buyer} onChange={set('buyer')} />
        <input className="cline-input" aria-label="The lead it came from: their email address (optional)" placeholder="lead's address (optional)" disabled={busy} value={f.lead} onChange={set('lead')} />
        <input className="cline-input cline-deal-n" type="number" min="0" aria-label="What the deal is worth" placeholder="worth" disabled={busy} value={f.amount} onChange={set('amount')} />
        <input className="cline-input cline-deal-n" aria-label="Its currency, three letters" maxLength={3} disabled={busy} value={f.currency} onChange={set('currency')} />
      </div>
      <div className="cline-open">
        <input className="cline-input" aria-label="Where it hurts the buyer" placeholder="where it hurts them" maxLength={600} disabled={busy} value={f.problem} onChange={set('problem')} />
        <input className="cline-input" aria-label="What fixing it is worth to them, in their words" placeholder="what fixing it is worth to them" maxLength={600} disabled={busy} value={f.needPayoff} onChange={set('needPayoff')} />
        <input className="cline-input" aria-label="The one clear next step" placeholder="next step" maxLength={200} disabled={busy} value={f.nextStep} onChange={set('nextStep')} />
        <button type="button" className="sec-scan label-data" disabled={busy || !ready} data-deal-open-press="" onClick={press}>OPEN THE DEAL</button>
      </div>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
    </div>
  );
};
