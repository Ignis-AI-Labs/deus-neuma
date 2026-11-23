// PersonRecord — under a person's row in LEADS: the operator's own record of them. Their tags (comma between), the
// house's own fields (CrmFields.jsx sets which), and the note that stays on top; SAVE writes one touch on their
// history. When the house sees them twice (the DUPLICATE chip), MERGE INTO folds this lead into the first one, both
// histories kept there (backend/services/leads/lead-record.js). impure — network.

import { useState } from 'react';
import { saveRecord, mergeLeads } from '../../../services/crm-client.js';

const draftOf = (lead) => ({ tags: (lead.tags ?? []).join(', '), about: lead.about ?? '', fields: Object.fromEntries(Object.entries(lead.fields ?? {}).map(([k, v]) => [k, String(v)])) });

const FieldInput = ({ def, value, busy, onChange }) => (def.type === 'choice' ? (
  <select className="cline-input" aria-label={def.label} disabled={busy} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
    <option value="">—</option>
    {def.choices.map((c) => <option key={c} value={c}>{c}</option>)}
  </select>
) : (
  <input className="cline-input" aria-label={def.label} disabled={busy} type={def.type === 'date' ? 'date' : 'text'} inputMode={def.type === 'number' ? 'decimal' : undefined}
    value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
));

/** @param {{lead: object, defs: object[], twin: ?{id: string, name: string}, busy: boolean, onSaved: Function}} props */
export const PersonRecord = ({ lead, defs, twin, busy, onSaved }) => {
  const [draft, setDraft] = useState(() => draftOf(lead));
  const [said, setSaid] = useState(null);
  const [working, setWorking] = useState(false);
  const off = busy || working;
  const run = async (fn, words) => {
    setWorking(true);
    try { await fn(); setSaid(words); await onSaved?.(); } catch (e) { setSaid(e.message); } finally { setWorking(false); }
  };
  const save = () => run(() => saveRecord(lead.id, { tags: draft.tags, about: draft.about, fields: Object.fromEntries(defs.map((d) => [d.id, draft.fields[d.id] ?? ''])) }), 'SAVED');
  return (
    <div className="cline-ppl-record" data-person-record={lead.id}>
      <label className="pos-model-field">
        <span className="label-data">TAGS</span>
        <input className="cline-input" aria-label={`Tags on ${lead.name || lead.contact}, a comma between each`} placeholder="a comma between each" disabled={off} value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
      </label>
      {defs.map((d) => (
        <label key={d.id} className="pos-model-field" data-person-field={d.id}>
          <span className="label-data">{d.label.toUpperCase()}</span>
          <FieldInput def={d} value={draft.fields[d.id]} busy={off} onChange={(v) => setDraft({ ...draft, fields: { ...draft.fields, [d.id]: v } })} />
        </label>
      ))}
      <label className="pos-model-field">
        <span className="label-data">NOTE</span>
        <textarea className="cline-input" rows={2} maxLength={2000} aria-label={`Your note on ${lead.name || lead.contact}`} disabled={off} value={draft.about} onChange={(e) => setDraft({ ...draft, about: e.target.value })} />
      </label>
      <div className="cline-open">
        <button type="button" className="sec-scan cline-mini label-data" disabled={off} aria-label={`SAVE the record of ${lead.name || lead.contact}`} onClick={save}>SAVE</button>
        {twin ? (
          <button type="button" className="sec-scan cline-mini label-data" disabled={off} data-person-merge={twin.id} aria-label={`MERGE INTO ${String(twin.name).toUpperCase()} — the same person, both histories kept on the first`}
            onClick={() => run(() => mergeLeads(twin.id, lead.id), `MERGED INTO ${twin.name}`)}>MERGE INTO {String(twin.name).toUpperCase()}</button>
        ) : null}
        {said ? <span className="cline-move-t" role="status" data-person-record-said="">{said}</span> : null}
      </div>
    </div>
  );
};
