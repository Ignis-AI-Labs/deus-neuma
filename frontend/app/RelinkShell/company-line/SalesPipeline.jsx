// SalesPipeline — THE SALES POSITION'S HUB IS ITS PIPELINE (Design note, 2026-11-18: […]; chosen layout: […]). One row to choose the campaign in view
// (ALL, or one), one rail of ten stages in order — each with its count, the stage that waits on the operator marked
// — and under it only the chosen stage, as one sheet. What is not a stage (editing campaigns, everyone the house
// knows, the company's facts, the mailbox, the settings, what the seat reads) sits in one quiet MORE row.
// impure — reads and moves through use-lead-engine.js, the deals through the revenue board.

import { useCallback, useEffect, useState } from 'react';
import { useLeadEngine } from './use-lead-engine.js';
import { getRevenueBoard } from '../../../services/revenue-client.js';
import { STAGES, MORE, ALL, pipelineOf, campaignChoices } from './sales-pipeline-view.js';
import { DiscoverStage, FilterStage, ValidateStage } from './SalesStages.jsx';
import { EmailsStage, SentStage, RepliesStage, ReadyStage } from './SalesStagesOut.jsx';
import { CallsStage } from './SalesCalls.jsx';
import { CostsStage } from './SalesCosts.jsx';
import { WideFinds } from './WideFinds.jsx';
import { LeadRun } from './LeadRun.jsx';
import './SalesPipeline.css';

const VIEW_KEY = 'sales-pipeline:view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || ALL; } catch { return ALL; } };

// The deals are the revenue office's; the rail only counts them.
const useDeals = () => {
  const [deals, setDeals] = useState([]);
  const load = useCallback(() => getRevenueBoard().then((b) => setDeals(b?.deals ?? []), () => {}), []);
  useEffect(() => { load(); }, [load]);
  return deals;
};

const Stage = ({ s, on, onTab }) => (
  <li>
    <button type="button" className={`spl-stage${on ? ' is-on' : ''}${s.you ? ' is-you' : ''}`} data-stage={s.id} aria-current={on ? 'step' : undefined} onClick={() => onTab(s.id)}>
      <span className="spl-stage-n label-data">{s.n} {s.label}</span>
      <span className="spl-stage-head"><b>{s.head}</b>{s.unit ? <span className="spl-stage-unit label-data">{s.unit}</span> : null}</span>
      {s.yours ? <span className="spl-stage-you label-data">● {s.yours}</span> : null}
      {s.lines.map((l) => <span key={l} className="spl-stage-line label-data">{l}</span>)}
    </button>
  </li>
);

/**
 * @param {{position: object, tab: string, onTab: (tab: string) => void, renderOther: (tab: string) => any}} props —
 *   renderOther draws what the hub already has for a tab that is not one of the lead engine's own stages (SETUP,
 *   DEALS, and everything under MORE)
 */
export const SalesPipeline = ({ position, tab, onTab, renderOther }) => {
  const { engine, busy, error, notice, moveSegment, approveList, sendEmails, returnEmail, editEmail, deleteEmails, handCompany, passCompany, sending, stopSending, clearSending, checkEmails, confirmEmails, sendAnyway, readReplyAs, bookCall, cancelCall, setPlan, endPlan, passWide } = useLeadEngine();
  const deals = useDeals();
  const [view, setView] = useState(readView);
  const choices = campaignChoices(engine);
  const shown = choices.some((c) => c.id === view) ? view : ALL;
  const pick = (id) => { setView(id); try { localStorage.setItem(VIEW_KEY, id); } catch { /* private window: kept for this sitting only */ } };
  const stages = pipelineOf({ engine, view: shown, setup: position.setup, deals });
  const stage = STAGES.find((s) => s.id === tab) ?? null;
  const own = engine && ['discover', 'filter', 'validate', 'emails', 'sent', 'replies', 'calls', 'costs', 'ready'].includes(tab);
  const props = { engine, view: shown, busy };
  return (
    <section className="spl" aria-label="the sales pipeline" data-sales-pipeline="">
      <div className="spl-top">
        <div className="spl-campaigns" role="group" aria-label="campaign in view">
          <span className="spl-k label-data">CAMPAIGN</span>
          {choices.map((c) => (
            <button key={c.id} type="button" className={`spl-camp label-data${c.id === shown ? ' is-on' : ''}`} aria-pressed={c.id === shown}
              data-campaign-view={c.id} title={c.company ? `for ${c.company}` : undefined} onClick={() => pick(c.id)}>
              {c.label}{c.you ? <span className="spl-dot" role="img" aria-label="something here waits on you" /> : null}
            </button>
          ))}
          <button type="button" className="spl-camp spl-new label-data" aria-label="OPEN A NEW CAMPAIGN" onClick={() => onTab('campaigns')}>+ NEW</button>
        </div>
        <nav className="spl-more" aria-label="more of this position">
          {MORE.map((m) => (
            <button key={m.id} type="button" className={`spl-more-b label-data${m.id === tab ? ' is-on' : ''}`} aria-current={m.id === tab ? 'page' : undefined}
              data-more={m.id} onClick={() => onTab(m.id)}>{m.label}</button>
          ))}
        </nav>
      </div>
      <ol className="spl-rail" aria-label="the stages, in order">
        {stages.map((s) => <Stage key={s.id} s={s} on={s.id === tab} onTab={onTab} />)}
      </ol>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      {notice ? <p className="spl-notice label-data" role="status" data-engine-notice="">{notice}</p> : null}
      <div className="spl-body" data-stage-body={tab}>
        {stage ? <p className="spl-body-h label-data">{stage.n} {stage.label} — {stage.does}</p> : null}
        {own && ['discover', 'filter', 'validate'].includes(tab) ? <LeadRun engine={engine} view={shown} /> : null}
        {own && (tab === 'discover' || tab === 'filter') ? <WideFinds wide={engine.wide} busy={busy} onPass={passWide} /> : null}
        {own && tab === 'discover' ? <DiscoverStage {...props} onMove={moveSegment} /> : null}
        {own && tab === 'filter' ? <FilterStage {...props} /> : null}
        {own && tab === 'validate' ? <ValidateStage {...props} onList={approveList} onHand={handCompany} onPass={passCompany} /> : null}
        {own && tab === 'ready' ? <ReadyStage {...props} /> : null}
        {own && tab === 'emails' ? <EmailsStage {...props} onSend={sendEmails} onReturn={returnEmail} onEdit={editEmail} onDelete={deleteEmails} sending={sending} onStop={stopSending} onClear={clearSending} onCheck={checkEmails} onConfirm={confirmEmails} onSendAnyway={sendAnyway} /> : null}
        {own && tab === 'sent' ? <SentStage {...props} /> : null}
        {own && tab === 'replies' ? <RepliesStage {...props} busy={busy} onSaid={readReplyAs} /> : null}
        {own && tab === 'calls' ? <CallsStage {...props} onBook={bookCall} onCancel={cancelCall} /> : null}
        {own && tab === 'costs' ? <CostsStage {...props} deals={deals} onPlan={setPlan} onEnd={endPlan} /> : null}
        {own ? null : renderOther(tab)}
      </div>
    </section>
  );
};
