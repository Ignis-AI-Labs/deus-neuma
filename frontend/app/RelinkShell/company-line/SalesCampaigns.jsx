// SalesCampaigns — the CAMPAIGNS tab of the SALES position (Design note, 2026-11-15:
// […]). Each campaign: its goal, its numbers counted from the house's
// own records (gathered → scored → on the lead list → written → replied →
// qualified → won), the same numbers by channel, and the audiences that serve
// it. The operator opens and closes campaigns here and puts each audience
// under one. impure — reads and moves through use-lead-engine.js.

import { useState } from 'react';
import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { useLeadEngine } from './use-lead-engine.js';
import { FUNNEL, funnelOf, channelWords } from './sales-campaign-view.js';

const Funnel = ({ campaign }) => (
  <div className="cline-tiles cline-tiles-flat" data-campaign-funnel="">
    {funnelOf(campaign).map((step) => (
      <div key={step.key} className={`cline-tile${step.loud ? ' is-loud' : ''}`}>
        <b className="cline-tile-n">{step.n}</b>
        <span className="cline-tile-l label-data">{step.label}</span>
      </div>
    ))}
  </div>
);

const Campaign = ({ campaign, loose, busy, onClose, onPut }) => {
  const [pick, setPick] = useState('');
  const open = campaign.state === 'open';
  return (
    <li className="cline-sec" data-campaign-id={campaign.id} data-campaign-state={campaign.state}>
      <p className="cline-h label-data">{campaign.name} · FOR {campaign.company.toUpperCase()} · {open ? 'OPEN' : 'CLOSED'}</p>
      <p className="cline-move-t">GOAL: {campaign.goal}</p>
      <Funnel campaign={campaign} />
      {campaign.channels.length ? (
        <ul className="cline-ws-src" aria-label={`${campaign.name} by channel`}>
          {campaign.channels.map((c) => <li key={c.channel} data-campaign-channel={c.channel}>{channelWords(c)}</li>)}
        </ul>
      ) : <p className="cline-move-t">NO LEAD YET — NOTHING TO SHOW BY CHANNEL</p>}
      <p className="cline-move-t" data-campaign-audiences="">
        AUDIENCES: {campaign.audiences.length ? campaign.audiences.map((a) => `${a.name} (${a.state.toUpperCase()})`).join(' · ') : 'NONE YET'}
      </p>
      {open ? (
        <div className="cline-open">
          {loose.length ? (
            <>
              <Select fill ariaLabel={`audience to put under ${campaign.name}`} value={pick} onChange={setPick} disabled={busy}
                placeholder="put an audience under this campaign" options={loose.map((s) => ({ value: s.id, label: s.name }))} />
              <button type="button" className="sec-scan label-data" disabled={busy || !pick} aria-label={`ADD the audience to ${campaign.name}`}
                onClick={() => { onPut(loose.find((s) => s.id === pick), campaign); setPick(''); }}>ADD</button>
            </>
          ) : null}
          <button type="button" className="sec-scan cline-danger label-data" disabled={busy} aria-label={`CLOSE ${campaign.name}`} onClick={() => onClose(campaign)}>CLOSE</button>
        </div>
      ) : null}
    </li>
  );
};

export const SalesCampaigns = () => {
  const { engine, busy, error, notice, refresh, openCampaign, closeCampaign, putAudience } = useLeadEngine();
  const [draft, setDraft] = useState({ name: '', company: '', goal: '' });
  const campaigns = engine?.campaigns ?? [];
  const loose = engine?.loose ?? [];
  const ready = draft.name.trim().length >= 3 && draft.company && draft.goal.trim().length >= 10;
  return (
    <section className="cline-sec" aria-label="sales campaigns" data-sales-campaigns="">
      <p className="cline-h label-data">CAMPAIGNS — EACH PUSH, WHAT SERVES IT, AND WHAT IT BROUGHT IN</p>
      <button type="button" className="sec-scan label-data" disabled={busy} onClick={refresh}>REFRESH</button>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      {notice ? <p className="cline-move-t" role="status" data-campaign-notice="">{notice}</p> : null}
      {engine && !campaigns.length ? <EmptyState title="NO CAMPAIGN YET" /> : null}
      <ul className="cline-list" aria-label="campaigns">
        {campaigns.map((c) => <Campaign key={c.id} campaign={c} loose={loose.filter((s) => s.company === c.company)} busy={busy} onClose={closeCampaign} onPut={putAudience} />)}
      </ul>
      {loose.length ? <p className="cline-move-t" data-campaign-loose="">UNDER NO CAMPAIGN: {loose.map((s) => s.name).join(' · ')}</p> : null}
      <p className="cline-h label-data">OPEN A CAMPAIGN</p>
      <div className="cline-open" data-campaign-form="">
        <input className="cline-input" aria-label="Campaign name" placeholder="User acquisition" maxLength={60} disabled={busy}
          value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <Select ariaLabel="company the campaign is for" value={draft.company} onChange={(v) => setDraft({ ...draft, company: v })} disabled={busy}
          placeholder="for which company" options={(engine?.companies ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <input className="cline-input" aria-label="What the campaign is meant to bring in" placeholder="What it is meant to bring in" maxLength={300} disabled={busy}
          value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} />
        <button type="button" className="sec-scan label-data" disabled={busy || !ready} aria-label="OPEN the campaign"
          onClick={() => { openCampaign(draft); setDraft({ name: '', company: '', goal: '' }); }}>OPEN</button>
      </div>
      <p className="cline-move-t">{FUNNEL}</p>
    </section>
  );
};
