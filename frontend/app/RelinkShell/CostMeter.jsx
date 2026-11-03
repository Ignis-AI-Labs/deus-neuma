// CostMeter — the TREASURY window's RUNNING COSTS: what the house costs to
// run. The meter's setting (the operator's electricity rate, the house's
// share of this machine), this month and the last (the GPU's energy as the
// meter read it, the hardware and rent standing that month, the API bills),
// what each figure is missing, and the record of every cost and bill entered,
// each voidable with why. Only the operator enters a figure here, and each
// names its source. Pure rendering; the drafts and the IO live in TreasuryApp.jsx.

import { cash, monthName, totalsWords, energyWords, costWords, fixedWords, billWords, meterWords, formReady } from './cost-meter-view.js';

// One labelled field of a draft form.
const Field = ({ form, field, label, drafts, busy, onDraft, type = 'text', placeholder = '' }) => (
  <label className="tre-field">
    <span className="tre-field-l">{label}</span>
    <input className="tre-input" type={type} aria-label={label} placeholder={placeholder} disabled={busy}
      value={drafts[form]?.[field] ?? ''} onChange={(e) => onDraft(form, field, e.target.value)} />
  </label>
);

const Month = ({ s }) => (
  <div className="tre-cost-month" data-cost-month={s.month}>
    <p className="tre-cost-h">{monthName(s.month)} — {totalsWords(s)}</p>
    <p className="tre-cost-line">{energyWords(s.energy)}</p>
    {s.fixed.map((c) => <p key={c.id} className="tre-cost-line">{fixedWords(c)}</p>)}
    {s.bills.map((b) => <p key={b.id} className="tre-cost-line">{b.provider} API BILL — {cash(b.amount)} {b.currency}</p>)}
    {s.missing.length ? <p className="tre-cost-miss">MISSING: {s.missing.join(' · ')}</p> : null}
  </div>
);

// One entry on the record, with its source and its VOID (a reason first).
const Entry = ({ item, words, drafts, busy, onDraft, onVoid }) => {
  const key = `void:${item.id}`;
  const reason = drafts[key]?.reason ?? '';
  return (
    <li className="tre-cost-entry" data-cost-entry={item.id}>
      <span className="tre-cost-line">{words}</span>
      <span className="tre-cost-src">FROM: <span className="tre-exact">{item.source}</span></span>
      <span className="tre-cost-void">
        <input className="tre-input" aria-label={`Why ${item.id} is wrong`} placeholder="why this entry is wrong" disabled={busy}
          value={reason} onChange={(e) => onDraft(key, 'reason', e.target.value)} />
        <button type="button" className="sec-scan legal-danger" disabled={busy || reason.trim().length < 3} onClick={() => onVoid(item.id, reason)}>VOID</button>
      </span>
    </li>
  );
};

const SetupForm = ({ drafts, busy, onDraft, onSetup }) => (
  <div className="tre-cost-form" data-cost-form="setup">
    <Field form="setup" field="currency" label="Currency" placeholder="USD" drafts={drafts} busy={busy} onDraft={onDraft} />
    <Field form="setup" field="pricePerKwh" label="Your rate per kWh" type="number" placeholder="0.15" drafts={drafts} busy={busy} onDraft={onDraft} />
    <Field form="setup" field="priceSource" label="Where the rate comes from" placeholder="bill: your power company, the month" drafts={drafts} busy={busy} onDraft={onDraft} />
    <Field form="setup" field="sharePct" label="This house's share of the machine (%)" type="number" placeholder="100" drafts={drafts} busy={busy} onDraft={onDraft} />
    <button type="button" className="sec-scan" disabled={busy || !formReady('setup', drafts.setup)} onClick={onSetup}>SET THE RATE</button>
  </div>
);

export const CostMeter = ({ costs, drafts, busy, onDraft, onSetup, onStop, onAddCost, onAddBill, onVoid }) => {
  const { meter } = costs;
  const kind = drafts.cost?.kind === 'monthly' ? 'monthly' : 'hardware';
  return (
    <section className="tre-sec tre-costs" data-treasury-section="costs">
      <p className="tre-h label-data">RUNNING COSTS — THE COST METER</p>
      <p className="tre-cost-line">
        {costs.gpuPowerW === null ? 'GPU POWER DRAW UNREAD' : `${costs.gpuName || 'GPU'} DRAWING ${costs.gpuPowerW} W NOW`}
      </p>
      {!meter ? <p className="tre-cost-miss">THE COST METER COULD NOT BE READ.</p> : (
        <>
          <p className="tre-cost-h" data-cost-meter={meter.on ? 'on' : 'off'}>{meterWords(meter)}</p>
          {meter.on ? <p className="tre-cost-src">RATE FROM: <span className="tre-exact">{meter.setup.priceSource}</span></p> : null}
          <p className="tre-cost-note">
            The meter reads your GPU&apos;s power draw once a minute while this desk runs, and prices it at your rate.
            A minute it did not read is counted as unread, never guessed. Hardware, rent and API bills come from you, each with its source.
          </p>
          <p className="tre-h label-data">{meter.on ? 'CHANGE THE RATE — IT HOLDS FROM THIS MINUTE ON' : 'SET THE RATE'}</p>
          <SetupForm drafts={drafts} busy={busy} onDraft={onDraft} onSetup={onSetup} />
          {meter.on ? <button type="button" className="sec-scan legal-danger tre-cost-stop" disabled={busy} onClick={onStop}>STOP THE METER</button> : null}

          {meter.months.map((s) => <Month key={s.month} s={s} />)}

          <p className="tre-h label-data">ADD A COST — HARDWARE OR MONTHLY</p>
          <div className="tre-cost-form" data-cost-form="cost">
            <div className="tre-cost-kinds" role="radiogroup" aria-label="Kind of cost">
              {[['hardware', 'HARDWARE'], ['monthly', 'MONTHLY']].map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={busy}
                  className={`sec-scan${kind === k ? ' is-on' : ''}`} onClick={() => onDraft('cost', 'kind', k)}>{label}</button>
              ))}
            </div>
            <Field form="cost" field="what" label="What it is" placeholder={kind === 'hardware' ? 'the machine, its GPU' : 'rent, a subscription'} drafts={drafts} busy={busy} onDraft={onDraft} />
            {kind === 'hardware' ? (
              <>
                <Field form="cost" field="price" label="What it cost" type="number" drafts={drafts} busy={busy} onDraft={onDraft} />
                <Field form="cost" field="months" label="Paid off over (months)" type="number" placeholder="36" drafts={drafts} busy={busy} onDraft={onDraft} />
              </>
            ) : (
              <>
                <Field form="cost" field="monthly" label="A month" type="number" drafts={drafts} busy={busy} onDraft={onDraft} />
                <Field form="cost" field="until" label="Until (if it ends)" type="month" drafts={drafts} busy={busy} onDraft={onDraft} />
              </>
            )}
            <Field form="cost" field="currency" label="Currency" placeholder="USD" drafts={drafts} busy={busy} onDraft={onDraft} />
            <Field form="cost" field="since" label={kind === 'hardware' ? 'Bought in' : 'From'} type="month" drafts={drafts} busy={busy} onDraft={onDraft} />
            <Field form="cost" field="source" label="Its receipt or bill" placeholder="receipt: the seller, the date" drafts={drafts} busy={busy} onDraft={onDraft} />
            <button type="button" className="sec-scan" disabled={busy || !formReady('cost', { ...drafts.cost, kind })} onClick={onAddCost}>ADD THE COST</button>
          </div>

          <p className="tre-h label-data">ADD AN API BILL — ONE PROVIDER, ONE MONTH</p>
          <div className="tre-cost-form" data-cost-form="bill">
            <Field form="bill" field="provider" label="Provider" placeholder="Anthropic" drafts={drafts} busy={busy} onDraft={onDraft} />
            <Field form="bill" field="month" label="For the month" type="month" drafts={drafts} busy={busy} onDraft={onDraft} />
            <Field form="bill" field="amount" label="Amount" type="number" drafts={drafts} busy={busy} onDraft={onDraft} />
            <Field form="bill" field="currency" label="Currency" placeholder="USD" drafts={drafts} busy={busy} onDraft={onDraft} />
            <Field form="bill" field="source" label="The bill itself" placeholder="bill: the invoice number, the date" drafts={drafts} busy={busy} onDraft={onDraft} />
            <button type="button" className="sec-scan" disabled={busy || !formReady('bill', drafts.bill)} onClick={onAddBill}>ADD THE BILL</button>
          </div>

          <p className="tre-h label-data">ON THE RECORD — {meter.costs.length + meter.bills.length} ENTRIES</p>
          <ul className="tre-rows">
            {meter.costs.map((c) => <Entry key={c.id} item={c} words={costWords(c)} drafts={drafts} busy={busy} onDraft={onDraft} onVoid={onVoid} />)}
            {meter.bills.map((b) => <Entry key={b.id} item={b} words={billWords(b)} drafts={drafts} busy={busy} onDraft={onDraft} onVoid={onVoid} />)}
          </ul>
        </>
      )}
    </section>
  );
};
