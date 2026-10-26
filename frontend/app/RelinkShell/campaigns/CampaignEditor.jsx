// CampaignEditor — one campaign's declaration (shape v2, campaign plan §3.1):
// its company, what it is for (goal, KPI target, window), a budget that is a
// planning number, the angles each piece argues, and one sub-campaign per
// account of its company. With no campaign given, the form opens a new one;
// a campaign's own page opens it on EDIT. Section heads are one word, each
// rule on its hover.
// The backend judges the whole body and answers in words; the words show.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { Select } from '../Select.jsx';
import { CompanyPicker } from '../accounts/CompanyPicker.jsx';
import { handleOf } from '../accounts/account-words.js';
import { createCampaign, updateCampaign, removeCampaign } from '../../../services/campaigns-client.js';
import { draftOf, bodyOf } from './campaign-form.js';
import { DoorButton } from '../doors/DoorButton.jsx';

const words = (list) => list.map((v) => ({ value: v, label: v }));

// One account of the company: on or off the campaign, and its cadence.
const SubRow = ({ account, sub, onToggle, onCadence, busy }) => (
  <div className="settings-control campaign-sub" data-account={account.id}>
    <button type="button" className={`settings-set${sub ? ' is-sel' : ''}`} aria-pressed={Boolean(sub)}
      disabled={busy} onClick={() => { uiSound('toggle'); onToggle(); }}>
      {sub ? 'ON' : 'OFF'}
    </button>
    <code>{account.channelName} · {handleOf(account) || account.id}</code>
    {sub ? (
      <input className="settings-input" placeholder="cadence on this account — e.g. 3 posts/week"
        value={sub.cadence} onChange={(e) => onCadence(e.target.value)} disabled={busy} />
    ) : null}
  </div>
);

/**
 * @param {object} props
 * @param {object} [props.campaign]
 * @param {{statuses: string[], goalKinds: string[], kpiMetrics: string[]}} props.vocab
 * @param {ReadonlyArray<object>} props.companies
 * @param {ReadonlyArray<object>} props.accounts
 * @param {string} [props.companyId] - the company a new campaign starts under
 */
export const CampaignEditor = ({ campaign = null, vocab, companies, accounts, companyId = '', onSaved, onDeleted, onCancel }) => {
  const [draft, setDraft] = useState(() => draftOf(campaign, { companyId }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const put = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const set = (key) => (e) => put({ [key]: e.target.value });
  const own = (accounts || []).filter((a) => a.companyId && a.companyId === draft.companyId);

  const toggleSub = (accountId) => setDraft((d) => {
    const subs = { ...d.subs };
    if (subs[accountId]) delete subs[accountId];
    else subs[accountId] = { cadence: '', role: '', angleIds: [] };
    return { ...d, subs };
  });
  const subCadence = (accountId, cadence) => setDraft((d) => ({ ...d, subs: { ...d.subs, [accountId]: { ...d.subs[accountId], cadence } } }));

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const save = () => act(async () => {
    const body = bodyOf(draft, campaign);
    const saved = campaign ? await updateCampaign(campaign.id, body) : await createCampaign(body);
    await onSaved(saved.campaign);
  });

  const remove = () => {
    // A removal is permanent — the campaign's whole record goes with it.
    if (!window.confirm(`Remove campaign "${campaign.name}"? This drops it from the board.`)) return;
    act(async () => { await removeCampaign(campaign.id); await onDeleted(); });
  };

  const input = (key, placeholder, type = 'text') => (
    <input className="settings-input" type={type} placeholder={placeholder} aria-label={placeholder}
      value={draft[key]} onChange={set(key)} disabled={busy} />
  );

  return (
    <div className="settings-realm campaign-editor">
      {/* A campaign's own page heads it already (CampaignPage.jsx); a new one is named here. */}
      {campaign ? null : <div className="settings-row"><span className="settings-k">NEW CAMPAIGN</span></div>}
      <div className="settings-control">{input('name', 'Campaign name')}</div>
      <div className="settings-control">
        <CompanyPicker value={draft.companyId} companies={companies} unsortedLabel="— the company it speaks for —"
          onChange={(v) => put({ companyId: v, subs: {} })} disabled={busy} ariaLabel="campaign company" />
        <Select fill ariaLabel="Campaign status" value={draft.status} onChange={(v) => put({ status: v })}
          disabled={busy} options={words(vocab.statuses)} />
      </div>
      <div className="label-data settings-h" title="what it is for: the goal, its KPI and target, the window">GOAL</div>
      <div className="settings-control">
        <Select fill ariaLabel="Goal" value={draft.goalKind} onChange={(v) => put({ goalKind: v })} disabled={busy}
          placeholder="— goal —" options={[{ value: '', label: 'no goal yet' }, ...words(vocab.goalKinds)]} />
        {input('goalLabel', 'Goal in words — e.g. installs of the Linux build')}
      </div>
      <div className="settings-control">
        <Select fill ariaLabel="KPI" value={draft.kpiMetric} onChange={(v) => put({ kpiMetric: v })} disabled={busy}
          placeholder="— KPI —" options={[{ value: '', label: 'no KPI yet' }, ...words(vocab.kpiMetrics)]} />
        {input('kpiTarget', 'Target', 'number')}
        {input('kpiBy', 'By (day)', 'date')}
      </div>
      <div className="settings-control">
        {input('start', 'Window start', 'date')}
        {input('end', 'Window end', 'date')}
      </div>
      <div className="settings-control" title="a budget is a plan; nothing spends it">
        {input('hours', 'Budget hours', 'number')}
        {input('money', 'Budget money', 'number')}
        {input('budgetNote', 'Budget note')}
      </div>
      <div className="label-data settings-h" title="what each piece argues, and to whom">ANGLES</div>
      <div className="settings-control">
        <textarea className="settings-input" rows={3} aria-label="Angles" disabled={busy}
          placeholder={'one per line: name | thesis | audience\nproof | only the harness changed | developers'}
          value={draft.angles} onChange={set('angles')} />
      </div>
      <div className="label-data settings-h" title="sub-campaigns: one per account of its company">ACCOUNTS</div>
      {!draft.companyId ? <p className="settings-note">Choose the company first — a campaign runs only on its own company&rsquo;s accounts.</p> : null}
      {draft.companyId && !own.length ? <p className="settings-note">NO ACCOUNTS <DoorButton door={{ kind: 'keys', add: true }} /></p> : null}
      {own.map((a) => (
        <SubRow key={a.id} account={a} sub={draft.subs[a.id] || null} busy={busy}
          onToggle={() => toggleSub(a.id)} onCadence={(v) => subCadence(a.id, v)} />
      ))}
      <div className="settings-control">{input('cadence', 'Overall cadence — e.g. 1 post/day')}</div>
      {[['marketingPlan', 'Marketing plan (markdown, plain text)', 4], ['funnelPlan', 'Funnel plan (markdown, plain text)', 4], ['notes', 'Notes', 3]].map(([key, label, rows]) => (
        <div className="settings-control" key={key}>
          <textarea className="settings-input" rows={rows} placeholder={label} aria-label={label}
            value={draft[key]} onChange={set(key)} disabled={busy} />
        </div>
      ))}
      <div className="settings-control">
        <button type="button" className="settings-set" disabled={busy || !draft.name.trim() || !draft.companyId} onClick={save}>SAVE</button>
        {campaign ? <button type="button" className="settings-set is-danger" disabled={busy} onClick={remove}>REMOVE</button> : null}
        <button type="button" className="settings-set" disabled={busy} onClick={() => { uiSound('toggle'); onCancel(); }}>CLOSE</button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
