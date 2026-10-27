// CampaignPage — one campaign's page in the MARKETING window's CAMPAIGNS tab,
// opening on its picture (show-dont-tell-audit.md finding 3): the same
// instruments the BOARD's campaign panel draws (CampaignBody: the KPI dial,
// TIME against the window, the funnel, the subs), then its declared facts as
// chips, what the CMO asks you as a count that brings the asks into view, the
// asks, the log as a count door (CampaignLog.jsx), its material, and its month.
// The declaration's form (CampaignEditor.jsx) opens on EDIT and folds on CLOSE
// or a save; nothing on the page is lost behind it but what a field holds.

import { useRef, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { CampaignBody } from '../marketing-overview/OverviewPanels.jsx';
import { CampaignEditor } from './CampaignEditor.jsx';
import { CampaignAsks } from './CampaignAsks.jsx';
import { CampaignLog } from './CampaignLog.jsx';
import { CampaignMaterial } from './CampaignMaterial.jsx';
import { CampaignMonth } from './CampaignMonth.jsx';
import '../marketing-overview/MarketingOverview.css';
import './campaign-page.css';

/** The declaration's facts the instruments do not draw: the goal, the window, the budget, the angles. Pure. */
const factsOf = (c) => [
  c.goal ? { k: 'goal', text: c.goal.label || c.goal.kind, title: `goal: ${c.goal.kind}${c.goal.label ? ` — ${c.goal.label}` : ''}` } : null,
  c.window ? { k: 'window', text: `${c.window.start || '—'} → ${c.window.end || '—'}`, title: 'the window' } : null,
  c.budget && (c.budget.hours != null || c.budget.money != null)
    ? { k: 'budget', text: [c.budget.hours != null ? `${c.budget.hours}H` : null, c.budget.money != null ? String(c.budget.money) : null].filter(Boolean).join(' · '), title: `budget — a plan; nothing spends it${c.budget.note ? ` · ${c.budget.note}` : ''}` }
    : null,
  ...(c.angles || []).map((a) => ({ k: `angle-${a.id || a.name}`, text: a.name, title: `angle${a.thesis ? `: ${a.thesis}` : ''}${a.audience ? ` → ${a.audience}` : ''}` })),
].filter(Boolean);

/**
 * @param {object} props
 * @param {object} props.campaign
 * @param {?object} props.card - campaignCard (results-fold.js) for this campaign; null until the window's read lands
 * @param {object} props.vocab
 * @param {ReadonlyArray<object>} props.companies
 * @param {ReadonlyArray<object>} props.accounts
 * @param {?object[]} props.queue
 * @param {() => Promise<void>} props.onChanged - re-read the board
 * @param {() => Promise<void>} props.onDeleted
 */
export const CampaignPage = ({ campaign, card, vocab, companies, accounts, queue, onChanged, onDeleted }) => {
  const [editing, setEditing] = useState(false);
  const asksRef = useRef(null);
  const forYou = (campaign.asks || []).filter((a) => a.state === 'open' && a.from === 'cmo').length;
  return (
    <div className="campaign-page" data-campaign-page={campaign.id}>
      <div className="campaign-page-head">
        <b className="campaign-page-name">{campaign.name}</b>
        <span className={campaign.status === 'active' ? 'settings-tag-ok' : 'settings-tag-dim'}>{(campaign.status || '').toUpperCase()}</span>
        {campaign.companyId ? null : <span className="settings-tag-warn">NO COMPANY</span>}
        {forYou ? (
          <button type="button" className="settings-set campaign-page-asks" title={`${forYou} ask(s) from the CMO wait on you`}
            onClick={() => { uiSound('toggle'); asksRef.current?.scrollIntoView?.({ block: 'nearest' }); }}>
            ◇ {forYou}
          </button>
        ) : null}
        <button type="button" className="settings-set campaign-page-edit" aria-expanded={editing}
          onClick={() => { uiSound('toggle'); setEditing(!editing); }}>EDIT</button>
      </div>
      {card ? <div className="mko campaign-picture"><CampaignBody card={card} /></div> : null}
      <div className="campaign-facts">
        {factsOf(campaign).map((f) => <span key={f.k} className="settings-tag-dim" title={f.title}>{f.text}</span>)}
      </div>
      {editing ? (
        <CampaignEditor
          key={campaign.id}
          campaign={campaign}
          vocab={vocab}
          companies={companies}
          accounts={accounts}
          onSaved={async () => { await onChanged(); setEditing(false); }}
          onDeleted={onDeleted}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <div ref={asksRef}><CampaignAsks campaign={campaign} onChanged={onChanged} /></div>
      <CampaignLog log={campaign.log} />
      <CampaignMaterial campaign={campaign} onChanged={onChanged} />
      <div className="label-data settings-h">CALENDAR</div>
      <CampaignMonth campaign={campaign} queue={queue} />
    </div>
  );
};
