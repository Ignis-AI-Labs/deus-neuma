// SalesCosts — COSTS: what each lead-data plan costs, what that has bought, and where the line converts (Founder,
// 2026-11-20). One line of the numbers to say out loud; one sheet, a row a partner — the plan, what was paid so far,
// what it gave, and that divided into a lead, a reply, a call and a deal; each row opens to file or end its plan.
// Under it the line as a ladder: each stage against the one before it. The books' own figure stands beside […], so a charge nobody booked shows.
import { useState } from 'react';
import { Sheet } from '../sheet/Sheet.jsx';
import { cash, costRows, costHeadline, conversionRows } from './sales-costs-view.js';

const n = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US'));
const share = (v) => (v === null ? '—' : `${v}%`);

// A plan as the operator files it: the price a month, the credits it includes, the day it began.
const PlanHand = ({ row, busy, onPlan, onEnd }) => {
  const [monthly, setMonthly] = useState(row.monthly ?? '');
  const [credits, setCredits] = useState(row.credits?.included ?? '');
  const [since, setSince] = useState(row.since ?? '');
  const ok = monthly !== '' && Number(monthly) >= 0;
  return (
    <div className="spl-call-hand" data-plan-hand={row.partner}>
      <span className="spl-k label-data">{row.filed ? 'YOUR PLAN' : 'FILE YOUR PLAN'}</span>
      <input className="cline-input" type="number" min="0" step="0.01" aria-label={`What ${row.partner} costs a month`} placeholder="price a month" disabled={busy} value={monthly} onChange={(e) => setMonthly(e.target.value)} />
      <input className="cline-input" type="number" min="0" step="1" aria-label={`The credits a month the ${row.partner} plan includes (optional)`} placeholder="credits a month (optional)" disabled={busy} value={credits} onChange={(e) => setCredits(e.target.value)} />
      <input className="cline-input" type="date" aria-label={`The day the ${row.partner} plan began`} disabled={busy} value={since} onChange={(e) => setSince(e.target.value)} />
      <button type="button" className="sec-scan label-data" disabled={busy || !ok} data-plan-save="" onClick={() => onPlan({ partner: row.partner, monthly: Number(monthly), credits: credits === '' ? null : Number(credits), since: since || null })}>SAVE THE PLAN</button>
      {row.filed ? <button type="button" className="sec-scan label-data" disabled={busy} data-plan-end="" onClick={() => onEnd(row)}>THE PLAN ENDED</button> : null}
    </div>
  );
};

/** @param {{engine: object, view: string, deals?: object[], busy?: boolean, onPlan?: Function, onEnd?: Function}} props */
export const CostsStage = ({ engine, view, deals = [], busy = false, onPlan = null, onEnd = null }) => {
  const head = costHeadline(engine);
  const c = engine?.costs?.currency ?? 'USD';
  return (
    <>
      <p className="spl-body-h label-data">COSTS — WHAT EACH PLAN COSTS, WHAT IT BOUGHT, AND WHERE THE LINE CONVERTS</p>
      {head ? (
        <dl className="spl-costs" data-cost-headline="">
          {head.map((h) => <div key={h.k}><dt className="label-data">{h.k}</dt><dd>{h.v}</dd></div>)}
        </dl>
      ) : <p className="spl-empty label-data" data-cost-headline="none">NO PLAN FILED YET — OPEN A PARTNER BELOW AND SAY WHAT IT COSTS A MONTH</p>}
      <Sheet label="what each lead-data plan costs and bought" rows={costRows(engine)} rowKey={(r) => r.id} rowName={(r) => r.partner} rowAttrs={(r) => ({ 'data-cost-partner': r.partner, 'data-plan': r.filed ? 'filed' : 'none' })}
        detail={(r) => (onPlan && onEnd ? <PlanHand key={`${r.id}:${r.monthly}:${r.since}:${r.credits?.included}`} row={r} busy={busy} onPlan={onPlan} onEnd={onEnd} /> : null)} detailLabel={(r) => `file or change your ${r.partner} plan`}
        columns={[
          { head: 'PARTNER', cell: (r) => r.partner },
          { head: 'PLAN', sort: (r) => r.monthly ?? -1, cell: (r) => (r.filed ? `${cash(r.currency, r.monthly)} / MO` : 'NO PLAN FILED'), tone: (r) => (r.filed ? null : 'alert') },
          { head: 'SINCE', cell: (r) => r.since ?? '—' },
          { head: 'PAID SO FAR', sort: (r) => r.paid ?? -1, cell: (r) => cash(r.currency, r.paid), title: (r) => (r.filed ? `${r.charges} monthly charge(s) of ${cash(r.currency, r.monthly)}` : null) },
          { head: 'IN THE BOOKS', sort: (r) => r.booked ?? -1, cell: (r) => cash(r.currency, r.booked), tone: (r) => (r.unbooked > 0 ? 'alert' : null), title: (r) => (r.unbooked > 0 ? `${cash(r.currency, r.unbooked)} paid is not in the books yet: your accounts member books each charge from its receipt` : 'money out in your books whose memo names this partner') },
          { head: 'CREDITS THIS MONTH', sort: (r) => r.credits.used, cell: (r) => `${n(r.credits.used)}${r.credits.included !== null ? ` OF ${n(r.credits.included)}` : ''}` },
          { head: 'LEADS', sort: (r) => r.leads ?? -1, cell: (r) => n(r.leads) },
          { head: 'A LEAD', sort: (r) => r.perLead ?? Infinity, cell: (r) => cash(r.currency, r.perLead) },
          { head: 'REPLIED', sort: (r) => r.replied ?? -1, cell: (r) => n(r.replied), tone: (r) => (r.replied ? 'on' : null) },
          { head: 'A REPLY', sort: (r) => r.perReply ?? Infinity, cell: (r) => cash(r.currency, r.perReply) },
          { head: 'CALLS', sort: (r) => r.calls ?? -1, cell: (r) => n(r.calls), tone: (r) => (r.calls ? 'on' : null) },
          { head: 'A CALL', sort: (r) => r.perCall ?? Infinity, cell: (r) => cash(r.currency, r.perCall) },
          { head: 'WON', sort: (r) => r.won ?? -1, cell: (r) => n(r.won), tone: (r) => (r.won ? 'on' : null) },
          { head: 'A DEAL', sort: (r) => r.perWon ?? Infinity, cell: (r) => cash(r.currency, r.perWon) },
        ]} />
      <p className="spl-note label-data">PAID SO FAR IS YOUR PLAN&apos;S PRICE, ONCE FOR EACH MONTHLY CHARGE SINCE THE DAY IT BEGAN. A LEAD COUNTS FOR A PARTNER WHEN IT FOUND THE COMPANY OR GAVE THE ADDRESS. — MEANS NONE YET. THE HOUSE&apos;S FIGURES, OVER EVERY CAMPAIGN ({c}).</p>
      <p className="spl-body-h label-data">WHERE IT GOES — EACH STAGE AGAINST THE ONE BEFORE IT</p>
      <Sheet label="how the line converts" rows={conversionRows(engine, view, deals)} rowKey={(r) => r.id} rowName={(r) => r.label} rowAttrs={(r) => ({ 'data-conversion': r.label })}
        columns={[
          { head: 'STAGE', cell: (r) => r.label },
          { head: 'HOW MANY', cell: (r) => n(r.n) },
          { head: 'OF THE STAGE BEFORE', cell: (r) => share(r.ofPrior) },
          { head: 'OF EVERYTHING FOUND', cell: (r) => share(r.ofFound) },
        ]} />
    </>
  );
};
