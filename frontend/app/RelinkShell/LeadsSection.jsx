// LeadsSection — the witness's view of the house lead ledger inside Settings.
//
// The return current of the outreach machine: every prospect the house is
// working, grouped by where it stands. Every change the witness makes here
// lands as one recorded touch on the lead's append-only history — same law
// the beings' lead tools follow. The funnel is recorded, not policed.

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { Select } from './Select.jsx';
import {
  getLeadBoard, captureLead, touchLead, removeLead,
} from '../../services/leads-client.js';

const LANES = ['x', 'telegram', 'discord', 'mastodon', 'bluesky', 'facebook', 'linkedin', 'email', 'other'];

const LeadCard = ({ lead, statuses, onChanged }) => {
  const [status, setStatus] = useState(lead.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // The select tracks the LIVE lead — a server-side move (a neuma's touch,
  // another window) must never be silently overwritten from a stale dropdown.
  useEffect(() => setStatus(lead.status), [lead.id, lead.status]);

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNote('');
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const lastNote = [...(lead.touches || [])].reverse().find((t) => t.note)?.note;

  return (
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">{lead.name || lead.contact}</span>
        <span className="settings-v">
          {(lead.status || '').toUpperCase()}
          <span className="settings-sec-tags">
            {lead.channelId !== 'other' ? <span className="settings-tag-dim">via {lead.channelId}</span> : null}
            {lead.ownerNeumaId
              ? <span className="settings-tag-dim">HELD BY {lead.ownerNeumaId}</span>
              : <span className="settings-tag-dim">unheld</span>}
          </span>
        </span>
      </div>
      {lead.contact && lead.name ? <p className="settings-note">{lead.contact}</p> : null}
      {lastNote ? <p className="settings-note">{lastNote}</p> : null}
      <div className="settings-control">
        <Select
          fill
          ariaLabel="Lead status"
          value={status}
          onChange={setStatus}
          disabled={busy}
          options={statuses.map((s) => ({ value: s, label: s }))}
        />
        <input className="settings-input" placeholder="What happened? (the touch the record keeps)"
          value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        <button type="button" className="settings-set" disabled={busy || (status === lead.status && !note.trim())}
          onClick={() => act(() => touchLead(lead.id, {
            ...(status !== lead.status ? { status } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          }))}>
          TOUCH
        </button>
        <button type="button" className="settings-set is-danger" disabled={busy}
          onClick={() => {
            // A removal is permanent — the whole touch history goes with it.
            if (window.confirm(`Remove lead "${lead.name || lead.contact}"? This drops it and its history from the ledger.`)) {
              act(() => removeLead(lead.id));
            }
          }}>
          REMOVE
        </button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

// Capture a lead by hand — the beings capture through their lead_add tool.
const LeadComposer = ({ onChanged }) => {
  const [draft, setDraft] = useState({ name: '', contact: '', channelId: 'other', source: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const capture = async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await captureLead(draft);
      setDraft({ name: '', contact: '', channelId: 'other', source: '' });
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="settings-realm">
      <div className="settings-control">
        <input className="settings-input" placeholder="Who they are"
          value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={busy} />
        <input className="settings-input" placeholder="How to reach them"
          value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} disabled={busy} />
      </div>
      <div className="settings-control">
        <Select
          fill
          ariaLabel="Lead lane"
          value={draft.channelId}
          onChange={(v) => setDraft({ ...draft, channelId: v })}
          disabled={busy}
          options={LANES.map((l) => ({ value: l, label: l }))}
        />
        <input className="settings-input" placeholder="Where this lead came from"
          value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} disabled={busy} />
        <button type="button" className="settings-set"
          disabled={busy || (!draft.name.trim() && !draft.contact.trim())}
          onClick={capture}>
          CAPTURE
        </button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

export const LeadsSection = () => {
  const [leads, setLeads] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const refresh = async () => {
    const board = await getLeadBoard();
    setLeads(board.leads);
    setStatuses(board.statuses);
  };

  useEffect(() => {
    refresh().catch((e) => setLoadError(e.message));
  }, []);

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">LEADS</div>
      <p className="settings-note">
        The house lead ledger — every prospect being worked, from first
        sighting to won or lost. Your neuma capture and move leads through
        their lead tools; every change lands on the lead&apos;s permanent touch
        history under whoever made it.
      </p>

      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!leads && !loadError ? <p className="settings-note">Reading the ledger…</p> : null}
      {leads?.length === 0 ? <p className="settings-note">No leads yet — the field is open.</p> : null}

      {leads?.map((lead) => (
        <LeadCard key={lead.id} lead={lead} statuses={statuses} onChanged={refresh} />
      ))}
      <LeadComposer onChanged={refresh} />
    </section>
  );
};
