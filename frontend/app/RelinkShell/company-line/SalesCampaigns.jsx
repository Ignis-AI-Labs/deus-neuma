// SalesCampaigns — the CAMPAIGNS tab of the SALES position (Design note, 2026-11-15:
// […]). Each campaign: its goal, its numbers counted from the house's
// own records (gathered → scored → on the lead list → written → replied →
// qualified → won), the same numbers by channel, and the audiences that serve
// it. The operator opens, edits, archives, reopens and deletes campaigns here
// and puts each audience under one; the sales seat has the same hands by act. impure — reads and moves through use-lead-engine.js.

import { useState } from 'react';
import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { useLeadEngine } from './use-lead-engine.js';
import { FUNNEL, funnelOf, channelWords } from './sales-campaign-view.js';
import { segmentRows } from './lead-engine-view.js';
import { LeadAudienceCard } from './LeadAudienceCard.jsx';
import { useCampaignLinks, CampaignLinkLine } from '../positions/CampaignLinks.jsx';

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

const Campaign = ({ campaign, rows, loose, busy, links, onMove, onPut, onSegment, onList, onRead }) => {
  const [pick, setPick] = useState('');
  const [edit, setEdit] = useState(null); // {name, goal} while editing
  const [sure, setSure] = useState(false);
  const open = campaign.state === 'open';
  return (
    <li className="cline-sec" data-campaign-id={campaign.id} data-campaign-state={campaign.state}>
      <p className="cline-h label-data">{campaign.name} · FOR {campaign.company.toUpperCase()} · {open ? 'OPEN' : 'ARCHIVED'}</p>
      <p className="cline-move-t">GOAL: {campaign.goal}</p>
      <Funnel campaign={campaign} />
      {campaign.channels.length ? (
        <ul className="cline-ws-src" aria-label={`${campaign.name} by channel`}>
          {campaign.channels.map((c) => <li key={c.channel} data-campaign-channel={c.channel}>{channelWords(c)}</li>)}
        </ul>
      ) : <p className="cline-move-t">NO LEAD YET — NOTHING TO SHOW BY CHANNEL</p>}
      {rows.length ? (
        <ul className="cline-aud-list is-nested" aria-label={`audiences of ${campaign.name}`} data-campaign-audiences="">
          {rows.map((r) => <LeadAudienceCard key={r.segment.id} row={r} busy={busy} onMove={onSegment} onList={onList} onRead={onRead} mode="nested" />)}
        </ul>
      ) : <p className="cline-move-t" data-campaign-audiences="">NO AUDIENCE YET — THE SALES SEAT FILES ONE UNDER THIS CAMPAIGN</p>}
      <CampaignLinkLine campaignKey={`cro:${campaign.id}`} links={links} />
      {open && loose.length ? (
        <div className="cline-open">
          <Select fill ariaLabel={`audience to put under ${campaign.name}`} value={pick} onChange={setPick} disabled={busy}
            placeholder="put an audience under this campaign" options={loose.map((s) => ({ value: s.id, label: s.name }))} />
          <button type="button" className="sec-scan label-data" disabled={busy || !pick} aria-label={`ADD the audience to ${campaign.name}`}
            onClick={() => { onPut(loose.find((s) => s.id === pick), campaign); setPick(''); }}>ADD</button>
        </div>
      ) : null}
      {edit ? (
        <div className="cline-open" data-campaign-edit="">
          <input className="cline-input" aria-label={`New name for ${campaign.name}`} maxLength={60} disabled={busy} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <input className="cline-input" aria-label={`New goal for ${campaign.name}`} maxLength={300} disabled={busy} value={edit.goal} onChange={(e) => setEdit({ ...edit, goal: e.target.value })} />
          <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SAVE ${campaign.name}`}
            onClick={() => { onMove(campaign, { move: 'edit', name: edit.name, goal: edit.goal }, `"${edit.name.trim() || campaign.name}" is saved.`); setEdit(null); }}>SAVE</button>
          <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => setEdit(null)}>CANCEL</button>
        </div>
      ) : (
        <div className="cline-open">
          <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`EDIT ${campaign.name}`} onClick={() => setEdit({ name: campaign.name, goal: campaign.goal })}>EDIT</button>
          {open
            ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`ARCHIVE ${campaign.name}`} onClick={() => onMove(campaign, { move: 'archive' }, `"${campaign.name}" is archived.`)}>ARCHIVE</button>
            : <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`REOPEN ${campaign.name}`} onClick={() => onMove(campaign, { move: 'reopen' }, `"${campaign.name}" is open again.`)}>REOPEN</button>}
          <button type="button" className="sec-scan cline-danger label-data" disabled={busy} aria-label={`${sure ? 'PRESS AGAIN TO DELETE' : 'DELETE'} ${campaign.name}`}
            onClick={() => { if (sure) onMove(campaign, { move: 'delete' }, `"${campaign.name}" is deleted.`); setSure(!sure); }}>{sure ? 'PRESS AGAIN TO DELETE' : 'DELETE'}</button>
        </div>
      )}
    </li>
  );
};

export const SalesCampaigns = () => {
  const { engine, busy, error, notice, refresh, openCampaign, moveCampaign, putAudience, moveSegment, approveList, readSites } = useLeadEngine();
  const links = useCampaignLinks();
  const rows = segmentRows(engine);
  const known = new Set((engine?.campaigns ?? []).map((c) => c.id));
  const looseRows = rows.filter((r) => !known.has(r.segment.campaign));
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
        {campaigns.map((c) => <Campaign key={c.id} campaign={c} rows={rows.filter((r) => r.segment.campaign === c.id)} loose={loose.filter((s) => s.company === c.company)} busy={busy} links={links}
          onMove={(...args) => moveCampaign(...args).then(links.reload)} onPut={putAudience} onSegment={moveSegment} onList={approveList} onRead={readSites} />)}
      </ul>
      {looseRows.length ? (
        <div data-campaign-loose="">
          <p className="cline-h label-data">AUDIENCES UNDER NO CAMPAIGN · {looseRows.length} — PUT EACH UNDER THE CAMPAIGN IT SERVES, ABOVE</p>
          <ul className="cline-aud-list is-nested" aria-label="audiences under no campaign">
            {looseRows.map((r) => <LeadAudienceCard key={r.segment.id} row={r} busy={busy} onMove={moveSegment} onList={approveList} onRead={readSites} mode="nested" />)}
          </ul>
        </div>
      ) : null}
      <p className="cline-h label-data">OPEN A CAMPAIGN</p>
      <div className="cline-open" data-campaign-form="">
        <input className="cline-input" aria-label="Campaign name" placeholder="User acquisition" maxLength={60} disabled={busy}
          value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <Select ariaLabel="company the campaign is for" value={draft.company} onChange={(v) => setDraft({ ...draft, company: v })} disabled={busy}
          placeholder="for which company" options={(engine?.companies ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <input className="cline-input" aria-label="What the campaign is meant to bring in" placeholder="What it is meant to bring in" maxLength={300} disabled={busy}
          value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} />
        <button type="button" className="sec-scan label-data" disabled={busy || !ready} aria-label="OPEN the campaign"
          onClick={() => { openCampaign(draft).then(links.reload); setDraft({ name: '', company: '', goal: '' }); }}>OPEN</button>
      </div>
      <p className="cline-move-t">{FUNNEL}</p>
    </section>
  );
};
