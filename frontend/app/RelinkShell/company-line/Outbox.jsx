// Outbox — the emails the sales seat staged, lined up for the operator's review (Design note, 2026-11-16: […]). One fold at the top of LEADS, open while anything waits. A sheet, one email a line: who it
// is for, its campaign, its subject, its length, who wrote it. Pressing a row opens the whole email, exactly
// as it would leave, with EDIT (change the words in place), SEND THIS ONE and RETURN (with what should
// change). Above the sheet: tick the ones that are right and SEND CHECKED, or SEND ALL. Nothing here has been
// sent until one of those is pressed. The words are outbox-view.js.

import { useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { outboxStats, waitingDrafts, draftFor, wordCount, editReady, sendingView, SEND_STATE_WORDS, checkOf, checkCell, missingCheckers, wantsConfirming, isConfirmedLive } from './outbox-view.js';
import { emailedBefore, emailKind, EMAIL_KINDS } from './sales-pipeline-view.js';

// unconfirmed: its address was not confirmed live by any database — a first email to it is refused at send unless the
// operator SENDS IT ANYWAY (pressed twice), knowing it may bounce (2026-11-19, a stored "verified" that hard-bounced).
const Email = ({ draft, busy, onSend, onReturn, onEdit, onDelete = null, unconfirmed = false, onSendAnyway = null }) => {
  const [edit, setEdit] = useState(null); // {subject, text} while the operator changes the words
  const [note, setNote] = useState('');
  const [sure, setSure] = useState(false); // DELETE asks twice
  const [risk, setRisk] = useState(false); // SEND ANYWAY asks twice
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
      {draft.footer ? <pre className="cline-out-text cline-out-footer" data-outbox-footer="" title="Added under every sales email: the way to stop them, and where your company receives post. The mail program's own unsubscribe button works too.">{draft.footer}</pre> : null}
      {draft.promise ? <p className="cline-move-t">IT PROMISES: {draft.promise}</p> : null}
      <div className="cline-open">
        <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SEND THIS ONE — to ${draft.to.join(', ')}`} onClick={() => onSend([draft.id])}>SEND THIS ONE</button>
        <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`EDIT the email to ${draft.to.join(', ')}`} onClick={() => setEdit({ subject: draft.subject, text: draft.text })}>EDIT</button>
        <input className="cline-input" aria-label={`What should change in the email to ${draft.to.join(', ')}`} placeholder="What should change" disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="sec-scan cline-danger label-data" disabled={busy || note.trim().length < 5} aria-label={`RETURN the email to ${draft.to.join(', ')} to be rewritten`} onClick={() => { onReturn(draft, note.trim()); setNote(''); }}>RETURN</button>
        {unconfirmed && onSendAnyway ? (
          <button type="button" className="sec-scan cline-danger label-data" disabled={busy} data-send-anyway={draft.id}
            title="No database confirmed this address live. If it is a first email, a send stops on it; this sends it anyway — it may bounce, and a bounce hurts the mailbox's name."
            aria-label={`${risk ? 'PRESS AGAIN — IT MAY BOUNCE' : 'SEND ANYWAY — NOT CONFIRMED'} — the email to ${draft.to.join(', ')}`}
            onClick={() => { if (risk) onSendAnyway(draft); setRisk(!risk); }}>{risk ? 'PRESS AGAIN — IT MAY BOUNCE' : 'SEND ANYWAY — NOT CONFIRMED'}</button>
        ) : null}
        {onDelete ? (
          <button type="button" className="sec-scan cline-danger label-data" disabled={busy} aria-label={`${sure ? 'PRESS AGAIN TO DELETE' : 'DELETE'} the email to ${draft.to.join(', ')}`}
            onClick={() => { if (sure) onDelete([draft.id]); setSure(!sure); }}>{sure ? 'PRESS AGAIN TO DELETE' : 'DELETE'}</button>
        ) : null}
      </div>
    </div>
  );
};

// THE BATCH ON ITS WAY (Design note, 2026-11-19: […]): one line saying where it stands, a bar filling as each goes, STOP while it
// runs, and each email in the batch with where it stands — SENT, SENDING…, WAITING, or NOT SENT and why.
const Sending = ({ sending, leads, onStop, onClear }) => {
  const view = sendingView(sending);
  if (!view) return null;
  const reasonOf = (id) => sending.results?.[id]?.reason ?? null;
  return (
    <div className="cline-out-sending" data-outbox-sending={view.running ? 'running' : 'done'}>
      <div className="cline-fact-bar">
        <span className="label-data" role="status" aria-live="polite" data-outbox-progress="">{view.words}</span>
        {view.running
          ? <button type="button" className="sec-scan cline-danger label-data" aria-label="STOP — the email being sent finishes; the rest stay in the outbox, unsent" onClick={onStop}>STOP</button>
          : <button type="button" className="sec-scan label-data" aria-label="DONE — put this batch away" onClick={onClear}>DONE</button>}
      </div>
      <div className="cline-out-meter" role="progressbar" aria-label="emails sent of this batch" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.sent + view.refused}>
        <span style={{ width: `${Math.round(view.share * 100)}%` }} />
      </div>
      <Sheet label="this batch, as it goes" rows={sending.rows} rowKey={(d) => d.id} rowName={(d) => `the email for ${draftFor(d, leads).name}`}
        rowAttrs={(d) => ({ 'data-send-state': view.stateOf(d.id), ...(view.stateOf(d.id) === 'sending' ? { 'data-waits': '1' } : {}) })}
        columns={[
          { head: 'STATE', cell: (d) => SEND_STATE_WORDS[view.stateOf(d.id)], tone: (d) => ({ sent: 'on', refused: 'alert', sending: 'alert' }[view.stateOf(d.id)] ?? null) },
          { head: 'FOR', cell: (d) => draftFor(d, leads).name },
          { head: 'TO', cell: (d) => d.to.join(', '), exact: true },
          { head: 'SUBJECT', cell: (d) => d.subject, title: (d) => d.subject },
          { head: 'WHY NOT SENT', cell: (d) => reasonOf(d.id), tone: () => 'alert' },
        ]} />
    </div>
  );
};

/** @param {{outbox: ?{review: boolean, drafts: object[]}, leads: object[], names?: object, busy: boolean, onSend: Function, onReturn: Function, onEdit: Function, sending?: ?object, onStop?: Function, onClear?: Function, checks?: object, checkers?: string[], onCheck?: Function}} props
 *  checkers: the address-checking databases attached (Hunter, Tomba, Apollo) */
export const Outbox = ({ outbox, leads = [], busy: idle, onSend, onReturn, onEdit, onDelete = null, sending = null, onStop = () => {}, onClear = () => {}, checks = {}, checkers = [], onCheck = null, onConfirm = null, onSendAnyway = null }) => {
  const [sureAll, setSureAll] = useState(false); // DELETE CHECKED asks twice
  const [ticked, setTicked] = useState([]);
  // While a batch is on its way, nothing else in the outbox is pressed, and its emails stand in the batch, not below.
  const running = Boolean(sending && !sending.done);
  const busy = idle || running;
  const drafts = outbox?.drafts ?? [];
  const waiting = waitingDrafts(drafts).filter((d) => !(running && sending.ids.includes(d.id)));
  const all = waiting.map((d) => d.id);
  const checked = ticked.filter((id) => all.includes(id));
  // Not checked yet — or standing only on a provider's stored "verified", which a live check outranks.
  const unchecked = waiting.filter((d) => { const c = checkOf(checks, d); return !c || c.live === false; }).map((d) => d.id);
  // LOCK IT IN: the emails whose address some attached database has not checked yet.
  const notEvery = waiting.filter((d) => (d.to ?? []).some((a) => missingCheckers(checks?.[String(a).toLowerCase()], checkers).length)).map((d) => d.id);
  // CONFIRM OR FIND: the emails whose address no database confirmed and that are not settled yet.
  const toConfirm = waiting.filter((d) => wantsConfirming(checkOf(checks, d))).map((d) => d.id);
  const toggle = (id) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  if (!outbox || (!drafts.length && !outbox.review && !sending)) return null;
  const onList = (d) => leads.some((l) => d.to.includes(String(l.contact ?? '').toLowerCase()));
  // What each email is to its person — the first ever, a follow-up, or a reply — read once a row (sales-pipeline-view.js).
  const kinds = new Map(waiting.map((d) => [d.id, emailKind(d, drafts, leads)]));
  const kindOf = (d) => kinds.get(d.id) ?? emailKind(d, drafts, leads);
  const day = (at) => String(at ?? '').slice(0, 10);
  const columns = [
    { head: 'FOR', cell: (d) => draftFor(d, leads).name },
    { head: 'KIND', sort: (d) => ['first', 'follow-up', 'reply'].indexOf(kindOf(d).kind), cell: (d) => EMAIL_KINDS[kindOf(d).kind],
      tone: (d) => (kindOf(d).kind === 'reply' ? 'on' : null), attrs: (d) => ({ 'data-email-kind': kindOf(d).kind }),
      title: (d) => { const k = kindOf(d); return k.kind === 'reply' ? `Answering their email of ${day(k.lastIn.at)}` : k.kind === 'follow-up' ? `Writing again: emailed ${day(k.lastOut.at)}, and they have not answered since` : 'The first email this person ever gets from the house'; } },
    { head: 'OK', check: true, cell: (d) => <input type="checkbox" className="cline-fact-tick" aria-label={`Send the email to ${d.to.join(', ')}`} disabled={busy} checked={checked.includes(d.id)} onChange={() => toggle(d.id)} /> },
    { head: 'TO', cell: (d) => d.to.join(', '), exact: true },
    // An email to someone not on the lead list belongs to no campaign: said in alert, never a bare dash.
    { head: 'CAMPAIGN', cell: (d) => (onList(d) ? draftFor(d, leads).campaign : 'NOT ON THE LEAD LIST'), tone: (d) => (onList(d) ? null : 'alert'), title: (d) => (onList(d) ? draftFor(d, leads).audience : 'This address is not a lead: move its company\'s lead to this person, or file them, so the email belongs to a campaign') },
    { head: 'SUBJECT', cell: (d) => d.subject, title: (d) => d.subject },
    // EVERY ADDRESS IS CHECKED BEFORE IT IS SENT (Design note, 2026-11-19: what its check said, before the operator presses send.
    { head: 'ADDRESS CHECK', sort: (d) => { const c = checkOf(checks, d); return c ? (c.settled ? -0.5 : ['invalid', 'disposable', 'unknown', 'accept_all', 'webmail', 'valid'].indexOf(c.status)) : -1; },
      cell: (d) => checkCell(checkOf(checks, d), checkers).words,
      tone: (d) => checkCell(checkOf(checks, d), checkers).tone,
      attrs: (d) => ({ 'data-address-check': checkOf(checks, d)?.settled ? 'settled' : checkOf(checks, d)?.status ?? 'none', 'data-confirmed-by': (checkOf(checks, d)?.confirmedBy ?? []).length }),
      title: (d) => checkCell(checkOf(checks, d), checkers).title },
    // Someone already emailed: the date, in alert — the server will not send a second first email (a follow-up says so).
    // Every email that went to them before shows, a reply included (2026-11-19: a "Re:" to Blockchain Capital read "—" because they wrote last).
    { head: 'ALREADY EMAILED', sort: (d) => kindOf(d).lastOut?.at ?? null,
      cell: (d) => { const b = kindOf(d).lastOut; return b ? `YES · ${day(b.at)}` : null; },
      tone: (d) => (emailedBefore(d, drafts, leads) && !d.followUp ? 'alert' : null),
      title: (d) => { const b = kindOf(d).lastOut; return b ? `Last emailed ${String(b.at).slice(0, 16).replace('T', ' ')}${b.subject ? ` — "${b.subject}"` : ''}${emailedBefore(d, drafts, leads) && !d.followUp ? '. Sending this would email them a second first email: delete it, or have it rewritten as a follow-up.' : ''}` : null; } },
    { head: 'WORDS', cell: (d) => wordCount(d.text) },
    { head: 'CHANGED BY YOU', cell: (d) => (d.edited ? 'YES' : null) },
    { head: 'REWRITTEN', cell: (d) => (d.revised ? `${d.revised}×` : null), title: () => 'Your sales member rewrote this email in place' },
    { head: 'STAGED', cell: (d) => String(d.at ?? '').slice(0, 16).replace('T', ' ') },
  ];
  return (
    <div data-outbox="">
      <Fold id="leads:outbox" title="OUTBOX — EMAILS WAITING FOR YOUR REVIEW" waits={waiting.length > 0} stats={outboxStats(drafts)}>
        <p className="cline-move-t">{outbox.review
          ? 'Your sales member writes each email and stages it here. Nothing leaves until you send it. Turn this off in SETTINGS when you want approved lists to go by themselves.'
          : 'REVIEW FIRST is off: emails to leads on a list you approved go by themselves. Anything your sales member stages still waits here.'}</p>
        <Sending sending={sending} leads={leads} onStop={onStop} onClear={onClear} />
        {waiting.length ? (
          <>
            <div className="cline-fact-bar" data-outbox-bar="">
              <label className="cline-fact-all label-data"><input type="checkbox" className="cline-fact-tick" disabled={busy} checked={checked.length === all.length} onChange={(e) => setTicked(e.target.checked ? all : [])} /> CHECK ALL · {checked.length} OF {all.length} CHECKED</label>
              <button type="button" className="sec-scan label-data" disabled={busy || !checked.length} aria-label={`SEND CHECKED (${checked.length}) — they leave now from the house mailbox`} onClick={() => { onSend(checked); setTicked([]); }}>SEND CHECKED ({checked.length})</button>
              <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`SEND ALL (${all.length}) — every waiting email leaves now`} onClick={() => { onSend(all); setTicked([]); }}>SEND ALL ({all.length})</button>
              {onCheck && unchecked.length ? (
                <button type="button" className="sec-scan label-data" disabled={busy} aria-label={`CHECK ADDRESSES (${unchecked.length}) — each address not yet checked is asked now, before anything is sent`} onClick={() => onCheck(unchecked)}>CHECK ADDRESSES ({unchecked.length})</button>
              ) : null}
              {onConfirm && toConfirm.length ? (
                <button type="button" className="sec-scan label-data" disabled={busy} data-confirm-addresses=""
                  title="For each address no database confirmed: every database checks it, then the same person is looked for and any other address found is checked. A confirmed one replaces it (the lead and the email move to it). If nothing confirms it, it is marked NO DATABASE CAN CONFIRM, and nobody asks again."
                  aria-label={`FIND CONFIRMED ADDRESSES (${toConfirm.length}) — every database checks each address no database confirmed, then the person is looked for`} onClick={() => onConfirm(toConfirm)}>FIND CONFIRMED ADDRESSES ({toConfirm.length})</button>
              ) : null}
              {onCheck && checkers.length > 1 && notEvery.length ? (
                <button type="button" className="sec-scan label-data" disabled={busy} data-check-every=""
                  title={`Every database attached (${checkers.join(', ')}) that has not checked an address yet checks it now. Each spends its own credits; one check is usually enough.`}
                  aria-label={`CHECK WITH EVERY DATABASE (${notEvery.length}) — ${checkers.join(', ')}, each that has not checked the address yet`} onClick={() => onCheck(notEvery, { every: true })}>CHECK WITH EVERY DATABASE ({notEvery.length})</button>
              ) : null}
              {onDelete ? (
                <button type="button" className="sec-scan cline-danger label-data" disabled={busy || !checked.length} aria-label={`${sureAll ? 'PRESS AGAIN TO DELETE' : 'DELETE CHECKED'} (${checked.length}) — never sent, off the list`}
                  onClick={() => { if (sureAll) { onDelete(checked); setTicked([]); } setSureAll(!sureAll); }}>{sureAll ? `PRESS AGAIN TO DELETE (${checked.length})` : `DELETE CHECKED (${checked.length})`}</button>
              ) : null}
            </div>
            <Sheet label="emails waiting for your review" columns={columns} rows={waiting} rowKey={(d) => d.id} rowName={(d) => `the email for ${draftFor(d, leads).name}`}
              rowAttrs={(d) => ({ 'data-outbox-id': d.id })} detailLabel={() => 'read it whole, change it, send it, return it or delete it'}
              detail={(d) => <Email draft={d} busy={busy} onSend={onSend} onReturn={onReturn} onEdit={onEdit} onDelete={onDelete} unconfirmed={!isConfirmedLive(checkOf(checks, d))} onSendAnyway={onSendAnyway} />} />
          </>
        ) : running ? null : <p className="cline-move-t" data-outbox-empty="">NO EMAIL WAITS FOR YOU</p>}
      </Fold>
    </div>
  );
};
