// Outbox — the emails the sales seat staged, lined up for the operator's review (Design note, 2026-11-16: […]). One fold at the top of LEADS, open while anything waits. A sheet, one email a line: who it
// is for, its campaign, its subject, its length, who wrote it. Pressing a row opens the whole email, exactly
// as it would leave, with EDIT (change the words in place), SEND THIS ONE and RETURN (with what should
// change). Above the sheet: tick the ones that are right and SEND CHECKED, or SEND ALL. Nothing here has been
// sent until one of those is pressed. The words are outbox-view.js.

import { useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { outboxStats, waitingDrafts, draftFor, wordCount, editReady } from './outbox-view.js';

const Email = ({ draft, busy, onSend, onReturn, onEdit }) => {
  const [edit, setEdit] = useState(null); // {subject, text} while the operator changes the words
  const [note, setNote] = useState('');
  if (edit) {
    return (
      <div className="cline-out-mail" data-outbox-edit={draft.id}>
        <input className="cline-input" maxLength={200} aria-label="The email's subject" disabled={busy} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
        <textarea className="cline-input cline-out-text" rows={12} maxLength={6000} aria-label="The email's words" disabled={busy} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
        <div className="cline-open">
          <button type="button" className="sec-scan label-data" disabled={busy || !editReady(edit, draft)} onClick={() => { onEdit(draft, { subject: edit.subject.trim(), text: edit.text.trim() }); setEdit(null); }}>SAVE THE CHANGE</button>
          <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => setEdit(null)}>CANCEL</button>
          <span className="cline-move-t">A changed email is checked against your facts again when you send it.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="cline-out-mail">
      <p className="cline-aud-k label-data">TO {draft.to.join(', ')} · SUBJECT</p>
      <p className="cline-out-subject">{draft.subject}</p>
      <pre className="cline-out-text" data-outbox-text="">{draft.text}</pre>
      {draft.promise ? <p className="cline-move-t">IT PROMISES: {draft.promise}</p> : null}
      <div className="cline-open">
        <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SEND THIS ONE — to ${draft.to.join(', ')}`} onClick={() => onSend([draft.id])}>SEND THIS ONE</button>
        <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`EDIT the email to ${draft.to.join(', ')}`} onClick={() => setEdit({ subject: draft.subject, text: draft.text })}>EDIT</button>
        <input className="cline-input" aria-label={`What should change in the email to ${draft.to.join(', ')}`} placeholder="What should change" disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="sec-scan cline-danger label-data" disabled={busy || note.trim().length < 5} aria-label={`RETURN the email to ${draft.to.join(', ')} to be rewritten`} onClick={() => { onReturn(draft, note.trim()); setNote(''); }}>RETURN</button>
      </div>
    </div>
  );
};

/** @param {{outbox: ?{review: boolean, drafts: object[]}, leads: object[], names?: object, busy: boolean, onSend: Function, onReturn: Function, onEdit: Function}} props */
export const Outbox = ({ outbox, leads = [], busy, onSend, onReturn, onEdit }) => {
  const [ticked, setTicked] = useState([]);
  const drafts = outbox?.drafts ?? [];
  const waiting = waitingDrafts(drafts);
  const all = waiting.map((d) => d.id);
  const checked = ticked.filter((id) => all.includes(id));
  const toggle = (id) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  if (!outbox || (!drafts.length && !outbox.review)) return null;
  const columns = [
    { head: 'FOR', cell: (d) => draftFor(d, leads).name },
    { head: 'OK', cell: (d) => <input type="checkbox" className="cline-fact-tick" aria-label={`Send the email to ${d.to.join(', ')}`} disabled={busy} checked={checked.includes(d.id)} onChange={() => toggle(d.id)} /> },
    { head: 'TO', cell: (d) => d.to.join(', '), exact: true },
    { head: 'CAMPAIGN', cell: (d) => draftFor(d, leads).campaign, title: (d) => draftFor(d, leads).audience },
    { head: 'SUBJECT', cell: (d) => d.subject, title: (d) => d.subject },
    { head: 'WORDS', cell: (d) => wordCount(d.text) },
    { head: 'CHANGED BY YOU', cell: (d) => (d.edited ? 'YES' : null) },
    { head: 'STAGED', cell: (d) => String(d.at ?? '').slice(0, 16).replace('T', ' ') },
  ];
  return (
    <div data-outbox="">
      <Fold id="leads:outbox" title="OUTBOX — EMAILS WAITING FOR YOUR REVIEW" waits={waiting.length > 0} stats={outboxStats(drafts)}>
        <p className="cline-move-t">{outbox.review
          ? 'Your sales member writes each email and stages it here. Nothing leaves until you send it. Turn this off in SETTINGS when you want approved lists to go by themselves.'
          : 'REVIEW FIRST is off: emails to leads on a list you approved go by themselves. Anything your sales member stages still waits here.'}</p>
        {waiting.length ? (
          <>
            <div className="cline-fact-bar" data-outbox-bar="">
              <label className="cline-fact-all label-data"><input type="checkbox" className="cline-fact-tick" disabled={busy} checked={checked.length === all.length} onChange={(e) => setTicked(e.target.checked ? all : [])} /> CHECK ALL · {checked.length} OF {all.length} CHECKED</label>
              <button type="button" className="sec-scan label-data" disabled={busy || !checked.length} aria-label={`SEND CHECKED (${checked.length}) — they leave now from the house mailbox`} onClick={() => { onSend(checked); setTicked([]); }}>SEND CHECKED ({checked.length})</button>
              <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SEND ALL (${all.length}) — every waiting email leaves now`} onClick={() => { onSend(all); setTicked([]); }}>SEND ALL ({all.length})</button>
            </div>
            <Sheet label="emails waiting for your review" columns={columns} rows={waiting} rowKey={(d) => d.id} rowName={(d) => `the email for ${draftFor(d, leads).name}`}
              rowAttrs={(d) => ({ 'data-outbox-id': d.id })} detailLabel={() => 'read it whole, change it, send it or return it'}
              detail={(d) => <Email draft={d} busy={busy} onSend={onSend} onReturn={onReturn} onEdit={onEdit} />} />
          </>
        ) : <p className="cline-move-t" data-outbox-empty="">NO EMAIL WAITS FOR YOU</p>}
      </Fold>
    </div>
  );
};
