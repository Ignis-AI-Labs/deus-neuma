// SalesCampaigns — CAMPAIGNS under MORE on the sales hub: the campaigns themselves, kept (Design note, 2026-11-15: […]; 2026-11-18: […]). Their counts live on the pipeline's rail, where ALL or one
// campaign is chosen; here each campaign is one row of a sheet — its name, whom it is for, its goal, the audiences
// that serve it, by channel what it brought in — with EDIT, ARCHIVE or REOPEN, and DELETE. Under it: the audiences
// under no campaign (each put under the one it serves) and the form that opens a campaign.
// impure — reads and moves through use-lead-engine.js.

import { useState } from 'react';
import { Select } from '../Select.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { useLeadEngine } from './use-lead-engine.js';
import { channelWords } from './sales-campaign-view.js';
import { useCampaignLinks, CampaignLinkLine } from '../positions/CampaignLinks.jsx';
import { EmailPlan, planState, PLAN_STATE_WORDS } from './EmailPlan.jsx';

const Moves = ({ campaign, busy, onMove, onEdit }) => {
  const [sure, setSure] = useState(false);
  const open = campaign.state === 'open';
  return (
    <span className="spl-acts">
      <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`EDIT ${campaign.name}`} onClick={() => onEdit(campaign)}>EDIT</button>
      {open
        ? <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`ARCHIVE ${campaign.name}`} onClick={() => onMove(campaign, { move: 'archive' }, `"${campaign.name}" is archived.`)}>ARCHIVE</button>
        : <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`REOPEN ${campaign.name}`} onClick={() => onMove(campaign, { move: 'reopen' }, `"${campaign.name}" is open again.`)}>REOPEN</button>}
      <button type="button" className="sec-scan cline-mini cline-danger label-data" disabled={busy} aria-label={`${sure ? 'PRESS AGAIN TO DELETE' : 'DELETE'} ${campaign.name}`}
        onClick={() => { if (sure) onMove(campaign, { move: 'delete' }, `"${campaign.name}" is deleted.`); setSure(!sure); }}>{sure ? 'PRESS AGAIN TO DELETE' : 'DELETE'}</button>
    </span>
  );
};

const Edit = ({ edit, busy, onChange, onSave, onCancel }) => (
  <div className="cline-open" data-campaign-edit="">
    <input className="cline-input" aria-label={`New name for ${edit.campaign.name}`} maxLength={60} disabled={busy} value={edit.name} onChange={(e) => onChange({ ...edit, name: e.target.value })} />
    <input className="cline-input" aria-label={`New goal for ${edit.campaign.name}`} maxLength={300} disabled={busy} value={edit.goal} onChange={(e) => onChange({ ...edit, goal: e.target.value })} />
    <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SAVE ${edit.campaign.name}`} onClick={onSave}>SAVE</button>
    <button type="button" className="sec-scan label-data" disabled={busy} onClick={onCancel}>CANCEL</button>
  </div>
);

const PutUnder = ({ segment, campaigns, busy, onPut }) => {
  const [pick, setPick] = useState('');
  const fits = campaigns.filter((c) => c.state === 'open' && (!segment.company || c.company === segment.company));
  return (
    <span className="spl-acts">
      <Select ariaLabel={`campaign to put ${segment.name} under`} value={pick} onChange={setPick} disabled={busy || !fits.length}
        placeholder={fits.length ? 'put it under a campaign' : 'no open campaign for its company'} options={fits.map((c) => ({ value: c.id, label: c.name }))} />
      <button type="button" className="sec-scan cline-mini label-data" disabled={busy || !pick} aria-label={`ADD ${segment.name} to the campaign`}
        onClick={() => { onPut(segment, fits.find((c) => c.id === pick)); setPick(''); }}>ADD</button>
    </span>
  );
};

export const SalesCampaigns = () => {
  const { engine, busy, error, notice, openCampaign, moveCampaign, putAudience, reviewEmailPlan } = useLeadEngine();
  const links = useCampaignLinks();
  const [draft, setDraft] = useState({ name: '', company: '', goal: '' });
  const [edit, setEdit] = useState(null); // {campaign, name, goal} while one is being renamed
  const campaigns = engine?.campaigns ?? [];
  const segments = (engine?.segments ?? []).filter((s) => s.state !== 'retired');
  const loose = engine?.loose ?? [];
  const companyName = (id) => (engine?.companies ?? []).find((c) => c.id === id)?.name ?? String(id ?? '').toUpperCase();
  const ready = draft.name.trim().length >= 3 && draft.company && draft.goal.trim().length >= 10;
  const onMove = (...args) => moveCampaign(...args).then(links.reload);
  return (
    <section className="cline-sec" aria-label="sales campaigns" data-sales-campaigns="">
      <p className="cline-h label-data">CAMPAIGNS · {campaigns.filter((c) => c.state === 'open').length} OPEN · {campaigns.filter((c) => c.state !== 'open').length} ARCHIVED</p>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      {notice ? <p className="cline-move-t" role="status" data-campaign-notice="">{notice}</p> : null}
      {edit ? <Edit edit={edit} busy={busy} onChange={setEdit} onCancel={() => setEdit(null)}
        onSave={() => { onMove(edit.campaign, { move: 'edit', name: edit.name, goal: edit.goal }, `"${edit.name.trim() || edit.campaign.name}" is saved.`); setEdit(null); }} /> : null}
      <Sheet label="campaigns" rows={campaigns} rowKey={(c) => c.id} rowName={(c) => c.name}
        rowAttrs={(c) => ({ 'data-campaign-id': c.id, 'data-campaign-state': c.state, ...(planState(c) === 'waiting' ? { 'data-waits': '1' } : {}) })}
        detail={(c) => (
          <div className="spl-detail">
            <p className="cline-move-t">GOAL: {c.goal}</p>
            {c.channels.length ? <ul className="cline-ws-src" aria-label={`${c.name} by channel`}>{c.channels.map((ch) => <li key={ch.channel} data-campaign-channel={ch.channel}>{channelWords(ch)}</li>)}</ul> : <p className="cline-move-t">NO LEAD YET — NOTHING TO SHOW BY CHANNEL</p>}
            <CampaignLinkLine campaignKey={`cro:${c.id}`} links={links} />
            <EmailPlan campaign={c} busy={busy} onReview={reviewEmailPlan} />
          </div>
        )} detailLabel={(c) => `the goal, channels and email plan of ${c.name}`}
        empty={<p className="spl-empty label-data">NO CAMPAIGN YET — OPEN THE FIRST ONE BELOW</p>}
        columns={[
          { head: 'CAMPAIGN', cell: (c) => c.name },
          { head: 'FOR', cell: (c) => companyName(c.company) },
          { head: 'STATE', cell: (c) => (c.state === 'open' ? 'OPEN' : 'ARCHIVED'), tone: (c) => (c.state === 'open' ? 'on' : null) },
          // The email formula's variables (email-formula.js): no first email of the campaign until they are locked in.
          { head: 'EMAIL PLAN', cell: (c) => PLAN_STATE_WORDS[planState(c)], tone: (c) => ({ approved: 'on', waiting: 'alert', none: 'alert' }[planState(c)] ?? null), attrs: (c) => ({ 'data-plan-state': planState(c) }) },
          { head: 'AUDIENCES', cell: (c) => segments.filter((s) => s.campaign === c.id).map((s) => s.name).join(' · ') || 'NONE YET', attrs: () => ({ 'data-campaign-audiences': '' }), wrap: true },
          { head: 'CHANGE', cell: (c) => <Moves campaign={c} busy={busy} onMove={onMove} onEdit={(x) => setEdit({ campaign: x, name: x.name, goal: x.goal })} /> },
        ]} />
      {loose.length ? (
        <div data-campaign-loose="">
          <p className="cline-h label-data">AUDIENCES UNDER NO CAMPAIGN · {loose.length}</p>
          <Sheet label="audiences under no campaign" rows={loose} rowKey={(s) => s.id} rowName={(s) => s.name} rowAttrs={(s) => ({ 'data-segment-id': s.id })}
            columns={[
              { head: 'AUDIENCE', cell: (s) => s.name },
              { head: 'FOR', cell: (s) => companyName(s.company) },
              { head: 'PUT UNDER', cell: (s) => <PutUnder segment={s} campaigns={campaigns} busy={busy} onPut={putAudience} /> },
            ]} />
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
    </section>
  );
};
