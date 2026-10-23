// CampaignsSection — the campaign board, inside a platform's MARKETING window.
//
// Campaigns are the organizing spine of the outward-speech machine: the CMO
// designation names the one being holding the marketing position, each
// campaign carries its pillars, cadence, and plans, and the content calendar
// reads the campaign's own slice of the post queue so the witness sees what
// goes out, day by day. Decision law is unchanged — a draft is not egress,
// and the approve/reject calls here are the queue's own.

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { Select } from './Select.jsx';
import {
  getCampaigns, createCampaign, updateCampaign, removeCampaign,
  attachCampaignFile, detachCampaignFile,
  getCmo, setCmo, clearCmo,
} from '../../services/campaigns-client.js';
import {
  getChannelBoard, getPostQueue, approveQueuePost, rejectQueuePost, getRosterForBinding,
} from '../../services/social-channels-client.js';
import { groupQueueByDay, parsePillars } from './campaigns-helpers.js';

// The CMO row — the designation as it stands, and the picker that changes it.
// The roster source is the same one the channel-binding picker reads: a lane
// id here is a neumaId there.
const CmoRow = ({ cmo, roster, onChanged }) => {
  const [laneId, setLaneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await fn();
      setLaneId('');
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const holderName = cmo ? (roster.find((m) => m.neumaId === cmo.laneId)?.name || cmo.laneId) : null;

  return (
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">CHIEF MARKETING OFFICER</span>
        <span className="settings-v">
          <span className="settings-sec-tags">
            {cmo
              ? <span className="settings-tag-ok">HELD BY {holderName} — since {new Date(cmo.designatedAt).toLocaleDateString()}</span>
              : <span className="settings-tag-dim">no CMO designated</span>}
          </span>
        </span>
      </div>
      <div className="settings-control">
        <Select
          fill
          ariaLabel="CMO holder"
          value={laneId}
          onChange={setLaneId}
          disabled={busy || roster.length === 0}
          placeholder="— choose the holder —"
          options={roster.map((m) => ({ value: m.neumaId, label: m.name || m.neumaId }))}
        />
        <button type="button" className="settings-set" disabled={busy || !laneId}
          onClick={() => act(() => setCmo(laneId))}>
          DESIGNATE
        </button>
        {cmo ? (
          <button type="button" className="settings-set is-danger" disabled={busy}
            onClick={() => act(() => clearCmo())}>
            CLEAR
          </button>
        ) : null}
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

// The editor for one campaign — or, with no campaign given, the form that
// opens a new one. Plans are markdown authored as plain text; pillars travel
// as the string[] the ledger keeps. channelId is the SPACE's identity, not a
// form field: a campaign opened inside a platform's space belongs to that
// platform (null = the house-wide bench).
const CampaignEditor = ({ campaign, statuses, channelId = null, onSaved, onDeleted, onCancel }) => {
  const [draft, setDraft] = useState({
    name: campaign?.name || '',
    brand: campaign?.brand || '',
    status: campaign?.status || statuses[0] || 'active',
    pillars: (campaign?.pillars || []).join(', '),
    cadence: campaign?.cadence || '',
    marketingPlan: campaign?.marketingPlan || '',
    funnelPlan: campaign?.funnelPlan || '',
    notes: campaign?.notes || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  const save = async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    const body = {
      name: draft.name.trim(),
      brand: draft.brand.trim(),
      status: draft.status,
      pillars: parsePillars(draft.pillars),
      cadence: draft.cadence.trim(),
      marketingPlan: draft.marketingPlan,
      funnelPlan: draft.funnelPlan,
      notes: draft.notes,
    };
    try {
      const saved = campaign
        ? await updateCampaign(campaign.id, body)
        : await createCampaign({ ...body, ...(channelId ? { channelId } : {}) });
      await onSaved(saved.campaign);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const remove = async () => {
    // A removal is permanent — the campaign's whole record goes with it.
    if (!window.confirm(`Remove campaign "${campaign.name}"? This drops it from the board.`)) return;
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await removeCampaign(campaign.id);
      await onDeleted();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const field = (key, placeholder) => (
    <div className="settings-control">
      <input className="settings-input" placeholder={placeholder}
        value={draft[key]} onChange={set(key)} disabled={busy} />
    </div>
  );

  return (
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">{campaign ? campaign.name : 'NEW CAMPAIGN'}</span>
        <span className="settings-v"><span className="settings-sec-tags">
          {campaign ? <span className="settings-tag-dim">{(campaign.status || '').toUpperCase()}</span> : null}
        </span></span>
      </div>
      {field('name', 'Campaign name')}
      {field('brand', 'Brand it speaks for')}
      <div className="settings-control">
        <Select
          fill
          ariaLabel="Campaign status"
          value={draft.status}
          onChange={(v) => setDraft({ ...draft, status: v })}
          disabled={busy}
          options={statuses.map((s) => ({ value: s, label: s }))}
        />
        <input className="settings-input" placeholder="Cadence — e.g. 1 post/day"
          value={draft.cadence} onChange={set('cadence')} disabled={busy} />
      </div>
      {field('pillars', 'Content pillars, comma-separated')}
      <div className="settings-control">
        <textarea className="settings-input" rows={4} placeholder="Marketing plan (markdown, plain text)"
          value={draft.marketingPlan} onChange={set('marketingPlan')} disabled={busy} />
      </div>
      <div className="settings-control">
        <textarea className="settings-input" rows={4} placeholder="Funnel plan (markdown, plain text)"
          value={draft.funnelPlan} onChange={set('funnelPlan')} disabled={busy} />
      </div>
      <div className="settings-control">
        <textarea className="settings-input" rows={3} placeholder="Notes"
          value={draft.notes} onChange={set('notes')} disabled={busy} />
      </div>
      <div className="settings-control">
        <button type="button" className="settings-set"
          disabled={busy || !draft.name.trim() || !draft.brand.trim()}
          onClick={save}>
          SAVE
        </button>
        {campaign ? (
          <button type="button" className="settings-set is-danger" disabled={busy} onClick={remove}>
            REMOVE
          </button>
        ) : null}
        <button type="button" className="settings-set" disabled={busy} onClick={() => { uiSound('toggle'); onCancel(); }}>
          CLOSE
        </button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

// One queued post on the calendar: when, where, where it stands, its pillar —
// and the witness's decision buttons where a decision is still open.
const CalendarEntry = ({ entry, channels, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const channelName = channels.find((c) => c.id === entry.channelId)?.name || entry.channelId;
  const time = entry.scheduledFor
    ? new Date(entry.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">{time ? `${time} · ` : ''}{channelName}</span>
        <span className="settings-v">
          {(entry.status || '').toUpperCase()}
          <span className="settings-sec-tags">
            {entry.pillar ? <span className="settings-tag-dim">{entry.pillar}</span> : null}
          </span>
        </span>
      </div>
      <p className="settings-note">{entry.text}</p>
      {entry.status === 'draft' ? (
        <div className="settings-control">
          <button type="button" className="settings-set" disabled={busy}
            onClick={() => act(() => approveQueuePost(entry.id))}>
            APPROVE
          </button>
          <button type="button" className="settings-set is-danger" disabled={busy}
            onClick={() => act(() => rejectQueuePost(entry.id))}>
            REJECT
          </button>
        </div>
      ) : null}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

// The campaign's content calendar — its slice of the post queue, grouped by
// day, unscheduled work held under one trailing group.
const CampaignCalendar = ({ campaign, queue, channels, onChanged }) => {
  if (!queue) return <p className="settings-note">Reading the queue…</p>;
  const mine = queue.filter((e) => e.campaignId === campaign.id);
  // THE CALENDAR IS A CLOCK SURFACE — and a reply rides no clock (Founder
  // 2026-08-06). Approving one HERE would fire an immediate send from a card
  // that shows none of the exchange, so replies never render on the
  // calendar: they are counted, and decided in the channel's QUEUE →
  // REPLIES section with the conversation above the copy.
  const replyCount = mine.filter((e) => e.kind === 'reply').length;
  const groups = groupQueueByDay(mine.filter((e) => e.kind !== 'reply'));
  const replyNote = replyCount ? (
    <p className="settings-note">
      {replyCount} {replyCount === 1 ? 'reply rides' : 'replies ride'} this
      campaign — decide them in the channel&apos;s QUEUE, REPLIES section (an
      approved reply sends immediately).
    </p>
  ) : null;
  if (groups.length === 0) {
    return (
      <>
        {replyNote}
        <p className="settings-note">Nothing staged under this campaign yet.</p>
      </>
    );
  }
  return (
    <>
      {replyNote}
      {groups.map((day) => (
        <div key={day.key || 'unscheduled'}>
          <div className="label-data settings-h">{day.label}</div>
          {day.entries.map((entry) => (
            <CalendarEntry key={entry.id} entry={entry} channels={channels} onChanged={onChanged} />
          ))}
        </div>
      ))}
    </>
  );
};

// The campaign board, scoped to ONE space: a platform's own campaigns
// THE CAMPAIGN'S MATERIAL — the files that belong to it.
//
// Design note, 2026-07-27: […]
// Same shape as a project's shared files, read by the same bounded reader, so a
// being working this campaign sees the brief and the approved copy without a
// tool call — and works from THOSE rather than inventing positioning.
//
// Attaching is a READ GRANT, not a bookmark: the content enters a being's turn.
// The backend refuses secret-shaped paths (.env, keys, vault, another being's
// DNA) with a 403, and that refusal is shown here rather than swallowed.
const CampaignMaterial = ({ campaign, onChanged }) => {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const files = campaign.sharedFiles || [];

  const act = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); setPath(''); await onChanged(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="label-data settings-h">MATERIAL — {campaign.name}</div>
      <p className="settings-note">
        Files tied to this campaign are always-on context for whoever works it —
        the brief, the brand voice, the approved copy. Untying never deletes the file.
      </p>
      {err ? <p className="settings-err">{err}</p> : null}
      {files.length === 0
        ? <p className="settings-note">Nothing tied yet — this campaign carries no material.</p>
        : files.map((f) => (
          <div key={f.path} className="settings-provider-row">
            <code>{f.path.split('/').slice(-2).join('/')}</code>
            <span className="settings-sec-tags">
              <span className="settings-tag-dim" title={f.path}>{f.path}</span>
              <button type="button" className="settings-set" disabled={busy}
                onClick={() => { uiSound('toggle'); act(() => detachCampaignFile(campaign.id, f.path)); }}>
                UNTIE
              </button>
            </span>
          </div>
        ))}
      <div className="settings-control">
        <input
          type="text"
          className="settings-input"
          placeholder="/absolute/path/to/brief.md"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button type="button" className="settings-set" disabled={busy || !path.trim()}
          onClick={() => { uiSound('toggle'); act(() => attachCampaignFile(campaign.id, path.trim())); }}>
          TIE FILE
        </button>
      </div>
    </>
  );
};

// (channelId = a catalog id) or the house-wide bench (channelId = null),
// which also carries the CMO designation — one seat, one place to set it.
// Each platform requires its own approach, so its campaigns live in its
// own space (ruling, 2026-07-23).
export const CampaignsSection = ({ channelId = null, calm = null }) => {
  const [campaigns, setCampaigns] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [cmo, setCmoState] = useState(null);
  const [roster, setRoster] = useState([]);
  const [channels, setChannels] = useState([]);
  const [queue, setQueue] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [composing, setComposing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // A successful read always clears a stale error — the board never shows a
  // failure it has already recovered from.
  // A being's act (below) is BACKGROUND news: it waits while the person works
  // the window (calm-gate.js); the first read and their own edits land at once.
  const refresh = async ({ background = false } = {}) => {
    const [board, cmoRes, channelBoard, staged] = await Promise.all([
      getCampaigns(), getCmo(), getChannelBoard(), getPostQueue(),
    ]);
    const apply = () => {
      setCampaigns(board.campaigns);
      setStatuses(board.statuses);
      setCmoState(cmoRes.cmo);
      setChannels(channelBoard.channels || []);
      setQueue(staged.queue);
      setLoadError(null);
    };
    if (!calm) apply();
    else if (background) calm.offer('campaigns', apply);
    else calm.now('campaigns', apply);
  };

  useEffect(() => {
    Promise.all([refresh(), getRosterForBinding().then(setRoster).catch(() => {})])
      .catch((e) => setLoadError(e.message));
  }, []);

  // A BEING declaring a campaign must land on this board without the operator
  // hunting for REFRESH. Before this, a witness created "Umbrae Market Depth"
  // and the panel went on saying […], which
  // is a confident lie about work that had already happened.
  useEffect(() => {
    const onChanged = () => { refresh({ background: true }).catch((e) => setLoadError(e.message)); };
    window.addEventListener('neuma:campaigns-changed', onChanged);
    return () => window.removeEventListener('neuma:campaigns-changed', onChanged);
  }, []);

  // The space's own slice of the bench: a platform space shows its
  // platform's campaigns; the house bench shows the deliberately
  // house-wide ones (no channelId on the record).
  const scoped = campaigns?.filter((c) => (channelId ? c.channelId === channelId : !c.channelId)) ?? null;
  const selected = scoped?.find((c) => c.id === selectedId) || null;

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">CAMPAIGNS</div>
      <p className="settings-note">
        {channelId
          ? 'This platform’s campaigns — each platform requires its own approach, so its campaigns live here, in its own space. Open one to set its pillars and cadence, and read its content calendar below. Nothing goes out without your approval.'
          : 'The house-wide bench — campaigns that deliberately span platforms, and the CMO designation. A campaign that runs on one platform belongs in that platform’s space instead.'}
      </p>

      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!campaigns && !loadError ? <p className="settings-note">Reading the board…</p> : null}

      {channelId ? null : <CmoRow cmo={cmo} roster={roster} onChanged={refresh} />}

      {scoped?.length === 0 ? <p className="settings-note">No campaigns yet — the field is open.</p> : null}
      {scoped?.map((c) => (
        <button key={c.id} type="button"
          className={`settings-provider-row${selectedId === c.id ? ' is-sel' : ''}`}
          onClick={() => { uiSound('toggle'); setSelectedId(selectedId === c.id ? null : c.id); setComposing(false); }}>
          <code>{c.name} · {c.brand}</code>
          <span className="settings-sec-tags">
            <span className={c.status === 'active' ? 'settings-tag-ok' : 'settings-tag-dim'}>
              {(c.status || '').toUpperCase()}
            </span>
            <span className="settings-tag-dim">{(c.pillars || []).length} PILLARS</span>
            {c.cadence ? <span className="settings-tag-dim">{c.cadence}</span> : null}
          </span>
        </button>
      ))}

      <div className="settings-control">
        <button type="button" className="settings-set"
          onClick={() => { uiSound('toggle'); setComposing(!composing); setSelectedId(null); }}>
          {composing ? 'CLOSE' : 'NEW CAMPAIGN'}
        </button>
      </div>

      {composing ? (
        <CampaignEditor
          statuses={statuses}
          channelId={channelId}
          onSaved={async (saved) => { setComposing(false); await refresh(); setSelectedId(saved.id); }}
          onCancel={() => setComposing(false)}
        />
      ) : null}

      {selected ? (
        <>
          <CampaignEditor
            key={selected.id}
            campaign={selected}
            statuses={statuses}
            onSaved={async () => { await refresh(); }}
            onDeleted={async () => { setSelectedId(null); await refresh(); }}
            onCancel={() => setSelectedId(null)}
          />
          <CampaignMaterial campaign={selected} onChanged={refresh} />
          <div className="label-data settings-h">CONTENT CALENDAR — {selected.name}</div>
          <CampaignCalendar campaign={selected} queue={queue} channels={channels} onChanged={refresh} />
        </>
      ) : null}

      <div className="settings-control">
        <button type="button" className="settings-set" onClick={() => refresh().catch((e) => setLoadError(e.message))}>
          REFRESH
        </button>
      </div>
    </section>
  );
};
