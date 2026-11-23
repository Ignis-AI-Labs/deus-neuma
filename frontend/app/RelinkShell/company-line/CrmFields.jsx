// CrmFields — YOUR FIELDS, above the people sheet: what the house keeps on every person beyond what it already keeps
// (a text, a number, a date, or one of a list). A line first (how many); open, each field is a line with REMOVE, and
// one line adds another. Taking a field off never erases what was written in it (backend/services/leads/crm-fields.js).
// impure — network.

import { useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { saveCrmFields } from '../../../services/crm-client.js';

const TYPE_WORDS = Object.freeze({ text: 'TEXT', number: 'NUMBER', date: 'DATE', choice: 'ONE OF A LIST' });
const idOf = (label) => String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(?=[0-9])/, 'f-').slice(0, 40) || 'field';

/** @param {{defs: object[], busy: boolean, onChanged: (defs: object[]) => void}} props */
export const CrmFields = ({ defs, busy, onChanged }) => {
  const [add, setAdd] = useState({ label: '', type: 'text', choices: '' });
  const [said, setSaid] = useState(null);
  const save = async (next) => {
    try { const r = await saveCrmFields(next); onChanged(r.fields); setSaid(null); setAdd({ label: '', type: 'text', choices: '' }); } catch (e) { setSaid(e.message); }
  };
  const fresh = { id: idOf(add.label), label: add.label.trim(), type: add.type, ...(add.type === 'choice' ? { choices: add.choices.split(',').map((c) => c.trim()).filter(Boolean) } : {}) };
  return (
    <Fold id="people:fields" level={2} title="YOUR FIELDS" stats={[`${defs.length} FIELD${defs.length === 1 ? '' : 'S'}`]}>
      <p className="pos-covers">What you want kept on every person, beyond what the house keeps already. Fill them in under each person's row. Taking a field off keeps what was written in it.</p>
      <ul className="cline-list" aria-label="your fields">
        {defs.map((d) => (
          <li key={d.id} className="cline-open" data-crm-field={d.id}>
            <span className="label-data">{d.label.toUpperCase()}</span>
            <span className="cline-move-t">{TYPE_WORDS[d.type]}{d.choices ? `: ${d.choices.join(', ')}` : ''}</span>
            <button type="button" className="sec-scan cline-mini label-data" disabled={busy} aria-label={`REMOVE the field ${d.label}`} onClick={() => save(defs.filter((x) => x.id !== d.id))}>REMOVE</button>
          </li>
        ))}
      </ul>
      <div className="cline-open">
        <input className="cline-input" aria-label="A new field's name" placeholder="a new field, e.g. Budget" maxLength={60} disabled={busy} value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} />
        <select className="cline-input" aria-label="What the new field holds" disabled={busy} value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })}>
          {Object.entries(TYPE_WORDS).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
        </select>
        {add.type === 'choice' ? <input className="cline-input" aria-label="Its choices, a comma between each" placeholder="its choices, a comma between each" disabled={busy} value={add.choices} onChange={(e) => setAdd({ ...add, choices: e.target.value })} /> : null}
        <button type="button" className="sec-scan cline-mini label-data" disabled={busy || !fresh.label || defs.some((d) => d.id === fresh.id)} aria-label="ADD this field" onClick={() => save([...defs, fresh])}>ADD</button>
      </div>
      {said ? <p className="sec-error" role="alert">{said}</p> : null}
    </Fold>
  );
};
