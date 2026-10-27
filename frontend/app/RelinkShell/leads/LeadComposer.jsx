// LeadComposer — capture a lead by hand (the beings capture through their
// leads/add intent). Folded behind + LEAD until pressed: an unused form is
// noise on the ledger (LESS TEXT 4, folded and marked so).
//
// impure — the ledger's capture, sound.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { captureLead } from '../../../services/leads-client.js';
import { Select } from '../Select.jsx';

const EMPTY = Object.freeze({ name: '', contact: '', channelId: 'other', source: '' });

/**
 * @param {{lanes: Array<{value: string, label: string}>, onChanged: () => Promise<void>}} props
 */
export const LeadComposer = ({ lanes, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const capture = async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await captureLead(draft);
      setDraft(EMPTY);
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <button type="button" className="settings-set lead-add" aria-expanded="false" title="capture a lead by hand"
        onClick={() => { uiSound('toggle'); setOpen(true); }}>
        + LEAD
      </button>
    );
  }
  return (
    <div className="settings-realm lead-composer">
      <div className="settings-control">
        <input className="settings-input" placeholder="Who they are"
          value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={busy} />
        <input className="settings-input" placeholder="How to reach them"
          value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} disabled={busy} />
      </div>
      <div className="settings-control">
        <Select fill ariaLabel="Lead lane" value={draft.channelId} onChange={(v) => setDraft({ ...draft, channelId: v })}
          disabled={busy} options={lanes} />
        <input className="settings-input" placeholder="Where this lead came from"
          value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} disabled={busy} />
        <button type="button" className="settings-set" disabled={busy || (!draft.name.trim() && !draft.contact.trim())} onClick={capture}>
          CAPTURE
        </button>
        <button type="button" className="settings-set" disabled={busy} onClick={() => { uiSound('toggle'); setOpen(false); }}>CLOSE</button>
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
