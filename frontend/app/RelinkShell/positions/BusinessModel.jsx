// BusinessModel — the BUSINESS MODEL tab of every position that speaks for a
// company (Design note, 2026-11-15: […]). One block per
// company: the operator who knows the model types it and it stands; the one
// who does not presses WORK IT OUT and the seat's holder asks one question at
// a time and files it, to be approved or returned here. Every seat reads the
// approved model in the company's file. impure — network.

import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../empty-state.jsx';
import { uiSound } from '../../../services/ui-sound.js';
import { getCompanies, saveModel, settleModel } from '../../../services/positions-client.js';
import { Fold } from '../fold/Fold.jsx';
import { announceWaitingChanged } from '../waiting/waiting-changed.js';
import { draftOf, readyToSave, changed, workItOutAsk, rowsFor, modelStats, modelsStats, modelsWait } from './business-model-view.js';

// One company: a line first (its name, where its model stands, how much of it is answered). Open, the model
// reads as text under its questions; the boxes appear only on EDIT, or when nothing is written yet.
const Company = ({ company, fields, names, holder, busy, onSave, onSettle, onHand }) => {
  const shown = company.modelProposal?.model ?? company.model ?? null;
  const [editing, setEditing] = useState(!shown);
  const [draft, setDraft] = useState(() => draftOf(company, fields));
  const [note, setNote] = useState('');
  const waiting = Boolean(company.modelProposal);
  const edited = changed(draft, company, fields);
  return (
    <li className="pos-model-company" data-model-company={company.id} data-model-state={waiting ? 'waiting' : company.model ? 'approved' : 'none'}>
      <Fold id={`model:${company.id}`} level={2} title={company.name} waits={waiting || !company.model} stats={modelStats(company, fields, names)}>
        {company.modelReturned && !company.model ? <p className="cline-move-t">YOU RETURNED THE LAST ONE: {company.modelReturned}</p> : null}
        {editing ? (
          <>
            {fields.map((f) => (
              <label key={f.key} className="pos-model-field">
                <span className="label-data">{f.label}{f.optional ? ' · OPTIONAL' : ''}</span>
                <span className="pos-covers">{f.ask}</span>
                <textarea className="cline-input pos-model-text" rows={rowsFor(draft[f.key])} maxLength={f.max} disabled={busy} value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              </label>
            ))}
            <div className="cline-open">
              <button type="button" className="sec-scan label-data" disabled={busy || !readyToSave(draft, fields) || !edited} aria-label={`SAVE the business model of ${company.name}`} onClick={() => onSave(company, draft)}>{waiting ? 'SAVE WITH MY CHANGES' : 'SAVE'}</button>
              {shown ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`CANCEL the edit of ${company.name}`} onClick={() => { setDraft(draftOf(company, fields)); setEditing(false); }}>CANCEL</button> : null}
            </div>
          </>
        ) : (
          <>
            <dl className="fold-read" data-model-read="">
              {fields.filter((f) => shown[f.key]).map((f) => [<dt key={`${f.key}-k`}>{f.label}</dt>, <dd key={`${f.key}-v`}>{shown[f.key]}</dd>])}
            </dl>
            <div className="cline-open">
              {waiting ? <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`APPROVE the business model of ${company.name}`} onClick={() => onSettle(company, true)}>APPROVE</button> : null}
              <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`EDIT the business model of ${company.name}`} onClick={() => setEditing(true)}>EDIT</button>
            </div>
          </>
        )}
        {holder ? <div className="cline-open"><button type="button" className="sec-scan label-data" disabled={busy} aria-label={`WORK IT OUT WITH ${holder.name} — the business model of ${company.name}`} title={`${holder.name}'s chat opens with the ask drafted; you send it`} onClick={() => onHand(holder, workItOutAsk(company))}>WORK IT OUT WITH {holder.name.toUpperCase()}</button></div> : null}
        {waiting ? (
          <div className="cline-open">
            <input className="cline-input" aria-label={`What should change in the business model of ${company.name}`} placeholder="what should change" maxLength={300} disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="sec-scan cline-danger label-data" disabled={busy || note.trim().length < 3} aria-label={`RETURN the business model of ${company.name}`} onClick={() => { onSettle(company, false, note); setNote(''); }}>RETURN</button>
          </div>
        ) : null}
      </Fold>
    </li>
  );
};

/** @param {{names: Record<string, string>, holder: ?object, onHand: Function, onChanged: Function}} props */
export const BusinessModel = ({ names = {}, holder = null, onHand = () => {}, onChanged = () => {} }) => {
  const [read, setRead] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => getCompanies().then((r) => { setRead(r); setError(null); }, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const move = async (fn, said) => {
    uiSound('activate');
    setBusy(true);
    try {
      setRead(await fn());
      setError(null);
      setNotice(said);
      announceWaitingChanged(); // a model approved or returned leaves WAITING ON YOU at once
      await onChanged(); // the SETUP count is measured again
    } catch (e) {
      setError(e.message); // surfaced, never swallowed
    } finally {
      setBusy(false);
    }
  };
  const companies = read?.companies ?? [];
  return (
    <section className="cline cline-sec" aria-label="business model" data-business-model="">
      <Fold id="company:model" title="BUSINESS MODEL" waits={modelsWait(companies)} stats={modelsStats(companies)}>
      <p className="pos-covers">Write this before any campaign or audience. A stranger asks one thing: what are you bringing me. Answer with a result they can check. Every member who speaks for a company reads its approved model at the top of each turn.</p>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      {notice ? <p className="cline-move-t" role="status" data-model-notice="">{notice}</p> : null}
      {read && !companies.length ? <EmptyState title="NO COMPANY YET"><small>Add one in MARKETING, BRAND.</small></EmptyState> : null}
      <ul className="cline-list" aria-label="companies">
        {companies.map((c) => (
          // Keyed by what stands and waits: when either changes (a save, an approval, a member's filing) the form starts from it again.
          <Company key={`${c.id}:${JSON.stringify([c.model, c.modelProposal])}`} company={c} fields={read.fields} names={names} holder={holder} busy={busy} onHand={onHand}
            onSave={(company, draft) => move(() => saveModel(company.id, draft), `The business model of ${company.name} is saved and stands.`)}
            onSettle={(company, approve, note) => move(() => settleModel(company.id, approve, note, company.modelProposal?.id), approve ? `The business model of ${company.name} is approved.` : `The business model of ${company.name} went back.`)} />
        ))}
      </ul>
      </Fold>
    </section>
  );
};
