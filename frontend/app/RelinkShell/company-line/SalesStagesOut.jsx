// SalesStagesOut — the back of the line, one sheet a stage (Design note, 2026-11-18: […]).
// EMAILS: what the seat staged for the operator to read and send (the outbox itself), and how many leads are still
// to write. SENT: everyone written to and what is due on them. REPLIES: everyone who answered, and what was
// promised them. Pure rendering over sales-pipeline-view.js.

import { useEffect, useState } from 'react';
import { Sheet } from '../sheet/Sheet.jsx';
import { Fold } from '../fold/Fold.jsx';
import { getLeadMail } from '../../../services/revenue-client.js';
import { Outbox } from './Outbox.jsx';
import { rowStatus, sourceWords } from './people-view.js';
import { UPKEEP_WORDS } from './lead-engine-view.js';
import { draftsIn, sentRows, replyRows, closedRows, saidLabel, pipelineOf, messagesOf, channelOf, answerOf, isAutoReply, ALL } from './sales-pipeline-view.js';
import { foundByWords } from './sales-sources-view.js';

const day = (at) => (at ? String(at).slice(0, 10) : '—');
const campaignColumn = (view) => (view === ALL ? [{ head: 'CAMPAIGN', cell: (l) => l.origin?.campaign ?? 'NO CAMPAIGN' }] : []);
const dueWords = (u) => (u ? String(UPKEEP_WORDS[u.kind] ?? u.kind).split(' — ').at(-1) : '—');
const when = (at) => (at ? String(at).slice(0, 16).replace('T', ' ') : '—');

/** Every message with one person, opened under their row: which way it went, through what, when, and its words whole. */
// `shown` is the place in the thread of a message already drawn above it (their latest reply, in REPLIES): it is not drawn twice.
const Thread = ({ engine, lead, shown = -1 }) => {
  const messages = messagesOf(engine, lead).filter((_, i) => i !== shown);
  if (!messages.length) return shown >= 0 ? null : <p className="spl-detail label-data">NO MESSAGE IS RECORDED ON THIS LEAD YET</p>;
  return (
    <ol className="spl-thread" aria-label={`messages with ${lead.name || lead.contact}`} data-thread={lead.id}>
      {messages.map((m, i) => (
        <li key={`${m.at}:${i}`} className={`spl-msg is-${m.way}`} data-message-way={m.way} data-message-channel={m.channel ?? ''}>
          <p className="spl-msg-h label-data">{m.way === 'out' ? 'SENT' : 'THEY WROTE'} · {sourceWords(m.channel)} · {when(m.at)}{m.from ? ` · FROM ${m.from}` : ''}</p>
          {m.subject ? <p className="spl-msg-subject">Subject: {m.subject}</p> : null}
          {m.text ? <div className="spl-msg-text">{m.text}</div> : (m.note ? <p className="spl-msg-note">{m.note}</p> : null)}
          {m.promise ? <p className="spl-msg-note label-data">PROMISED: {m.promise}</p> : null}
        </li>
      ))}
    </ol>
  );
};
const outCount = (engine, l) => messagesOf(engine, l).filter((m) => m.way === 'out').length;
const lastOut = (engine, l) => [...messagesOf(engine, l)].reverse().find((m) => m.way === 'out')?.at ?? null;

/** EMAILS — the outbox for the campaign in view; and what is still to be written, which is the seat's. */
export const EmailsStage = ({ engine, view, busy, onSend, onReturn, onEdit, onDelete, sending = null, onStop, onClear, onCheck = null, onConfirm = null, onSendAnyway = null }) => {
  const toWrite = pipelineOf({ engine, view }).find((s) => s.id === 'emails').lines[0];
  return (
    <>
      <p className="spl-note label-data" data-emails-to-write="">{toWrite} — YOUR SALES MEMBER WRITES THEM AND STAGES EACH HERE</p>
      <Outbox outbox={engine.outbox ? { ...engine.outbox, drafts: draftsIn(engine, view) } : null} leads={engine.leads ?? []} busy={busy} onSend={onSend} onReturn={onReturn} onEdit={onEdit} onDelete={onDelete} sending={sending} onStop={onStop} onClear={onClear} checks={engine.checks ?? {}} checkers={engine.checkers ?? []} onCheck={onCheck} onConfirm={onConfirm} onSendAnyway={onSendAnyway} />
    </>
  );
};

const leadColumns = (view, extra) => [
  { head: 'PERSON', cell: (l) => l.name || l.contact },
  { head: 'ADDRESS', cell: (l) => l.contact, exact: true },
  ...campaignColumn(view),
  // A bounce is said as one, in alert, with when: the address is dead and the right one is still to find.
  { head: 'STATUS', cell: (l) => (l.bounced ? `BOUNCED · ${day(l.bounced.at)}` : rowStatus(l)), tone: (l) => (l.bounced ? 'alert' : null),
    title: (l) => (l.bounced ? `${l.bounced.address} bounced: your sales member finds the right address (the same person, or the next one up), moves the lead to it, and it is checked before anything is sent` : null) },
  { head: 'FOUND BY', cell: (l) => foundByWords(l), title: () => 'the partner that found the company, and the one that gave the address' },
  ...extra,
];

/** SENT — everyone written to who has not answered: through what, how many times, when last, what is due; each row opens to the messages whole. */
export const SentStage = ({ engine, view }) => (
  <Sheet label="written to" rows={sentRows(engine, view)} rowKey={(l) => l.id} rowName={(l) => l.name || l.contact} rowAttrs={(l) => ({ 'data-lead-id': l.id, ...(l.bounced ? { 'data-waits': '1', 'data-bounced': '1' } : {}) })}
    detail={(l) => <Thread engine={engine} lead={l} />} detailLabel={(l) => `the messages sent to ${l.name || l.contact}`}
    empty={<p className="spl-empty label-data">NOBODY WRITTEN TO YET</p>}
    columns={leadColumns(view, [
      { head: 'CHANNEL', cell: (l) => sourceWords(channelOf(engine, l)), attrs: (l) => ({ 'data-channel': channelOf(engine, l) ?? '' }) },
      { head: 'MESSAGES', sort: (l) => outCount(engine, l), cell: (l) => String(outCount(engine, l)) },
      { head: 'LAST SENT', cell: (l) => day(lastOut(engine, l) ?? l.updatedAt) },
      { head: 'DUE', cell: (l) => dueWords(l.due), tone: (l) => (l.due ? 'alert' : null) },
    ])} />
);

// THEIR REPLY FIRST (Design note, 2026-11-19: […]): their latest message, word for word — kept by the mailbox watch,
// or, for one it recorded before it kept the words, read once from the mailbox (wherever it has been moved since) and
// kept on the lead — then everything that went between. It never waits without end: a read that fails says why, with
// TRY AGAIN; one that finds no words says so (Design note, 2026-11-19: […]).
export const TheirReply = ({ message }) => {
  const [read, setRead] = useState(null); // {words, text, subject, folder} | {error}
  const [tries, setTries] = useState(0);
  const want = message && !message.text && message.uid;
  useEffect(() => {
    if (!want) return undefined;
    let live = true;
    getLeadMail(message.uid).then((m) => { if (live) setRead(m); }).catch((e) => { if (live) setRead({ error: e.message || 'the mailbox did not answer' }); });
    return () => { live = false; };
  }, [want, message?.uid, tries]);
  if (!message) return null;
  const words = message.text ?? (read?.words || null);
  const subject = message.subject ?? (read?.subject || null);
  const auto = isAutoReply({ subject, text: words });
  const moved = read?.folder && read.folder !== 'INBOX' ? ` · FOUND IN ${read.folder}` : '';
  const again = () => { setRead(null); setTries((n) => n + 1); };
  return (
    <div className="spl-msg is-in spl-their-reply" data-their-reply={message.uid ?? ''} data-read={words ? 'words' : read?.error ? 'failed' : read ? 'empty' : want ? 'reading' : 'note'}>
      <p className="spl-msg-h label-data">THEIR REPLY · {sourceWords(message.channel)} · {when(message.at)}{moved}{auto ? ' · AN AUTOMATIC REPLY, NOT THEM YET' : ''}</p>
      {subject ? <p className="spl-msg-subject">Subject: {subject}</p> : null}
      {words ? <div className="spl-msg-text">{words}</div>
        : read?.error ? (
          <p className="spl-msg-note">Their email could not be read from the mailbox: {read.error}{' '}
            <button type="button" className="sec-scan label-data" onClick={again}>TRY AGAIN</button>
          </p>
        )
          : read ? <p className="spl-msg-note">Their email was read, and it holds no words of its own.</p>
            : want ? <p className="spl-msg-note label-data">READING THEIR EMAIL FROM THE MAILBOX…</p> : <p className="spl-msg-note">{message.note}</p>}
      {read?.text && read.text.trim() !== String(read.words ?? '').trim() ? (
        <details className="spl-msg-note"><summary className="label-data">THE WHOLE EMAIL, WITH WHAT IT QUOTED</summary><div className="spl-msg-text">{read.text}</div></details>
      ) : null}
    </div>
  );
};
// Their latest reply stands first, once; the thread under it is everything ELSE that went between
// (Design note, 2026-11-20: […]). Over it: what the reply was read as,
// in their own sentence, and the presses that say otherwise — the rules are fixed and a person has the last word.
const SAID_PRESSES = Object.freeze([['wants', 'THEY WANT SOMETHING'], ['open', 'NOT SURE — KEEP IN REPLIES'], ['no', 'THEY SAID NO'], ['gone', 'THEY HAVE LEFT'], ['auto', 'AUTOMATIC REPLY']]);
export const Replied = ({ engine, lead, busy = false, onSaid = null }) => {
  const all = messagesOf(engine, lead);
  const at = all.map((m) => m.way).lastIndexOf('in');
  const said = lead.said ?? null;
  return (
    <>
      <div className="spl-said" data-said={said?.says ?? 'unread'}>
        <p className="spl-said-h label-data">READ AS <b>{saidLabel(said)}</b>{said?.by === 'operator' ? ' · SAID BY YOU' : said ? ' · BY THE FIXED RULES' : ''}</p>
        {said?.why && said.by !== 'operator' ? <p className="spl-msg-note">Because they wrote: “{said.why}”</p> : null}
        {said?.forward?.length ? <p className="spl-msg-note">Their notice points to: <span className="sheet-exact">{said.forward.join(' · ')}</span></p> : null}
        {onSaid ? (
          <p className="spl-said-set">
            <span className="label-data">IF THAT IS WRONG:</span>
            {SAID_PRESSES.filter(([says]) => says !== (said?.says ?? 'open')).map(([says, words]) => (
              <button key={says} type="button" className="sec-scan label-data" disabled={busy} data-said-set={says} onClick={() => onSaid(lead, says)}>{words}</button>
            ))}
          </p>
        ) : null}
      </div>
      <TheirReply message={at >= 0 ? all[at] : null} />
      <Thread engine={engine} lead={lead} shown={at} />
    </>
  );
};
const ANSWER_WORDS = Object.freeze({ sent: 'SENT', staged: 'STAGED — IN EMAILS', owed: 'OWED' });

// The people whose reply closed them: nothing more is written to them, and they stay on the ledger as contacts.
const Closed = ({ engine, view, says, title, note, busy, onSaid }) => {
  const rows = closedRows(engine, view, says);
  if (!rows.length) return null;
  return (
    <Fold id={`replies-${says}`} title={title} stats={[`${rows.length}`, 'KEPT AS CONTACTS']} level={2}>
      <p className="spl-note label-data">{note}</p>
      <Sheet label={title.toLowerCase()} rows={rows} rowKey={(l) => l.id} rowName={(l) => l.name || l.contact} rowAttrs={(l) => ({ 'data-lead-id': l.id, 'data-closed': says })}
        detail={(l) => <Replied engine={engine} lead={l} busy={busy} onSaid={onSaid} />} detailLabel={(l) => `their reply, and the messages with ${l.name || l.contact}`}
        columns={[
          { head: 'PERSON', cell: (l) => l.name || l.contact },
          { head: 'ADDRESS', cell: (l) => l.contact, exact: true },
          ...campaignColumn(view),
          { head: 'THEIR WORDS', cell: (l) => l.said?.why ?? '—', wrap: true },
          ...(says === 'gone' ? [{ head: 'POINTS TO', cell: (l) => (l.said?.forward?.length ? l.said.forward.join(' · ') : null), exact: true }] : []),
          { head: 'CLOSED', cell: (l) => day(l.updatedAt) },
        ]} />
    </Fold>
  );
};

/** REPLIES — everyone who answered, whoever asked for something first: what their reply says, how long they have waited, where your answer stands, what the house promised. Under it, those who said no and those who have left, kept as contacts. */
export const RepliesStage = ({ engine, view, busy = false, onSaid = null }) => (
  <>
    <Sheet label="replies" rows={replyRows(engine, view)} rowKey={(l) => l.id} rowName={(l) => l.name || l.contact} rowAttrs={(l) => ({ 'data-lead-id': l.id, 'data-said': l.said?.says ?? 'unread' })}
      detail={(l) => <Replied engine={engine} lead={l} busy={busy} onSaid={onSaid} />} detailLabel={(l) => `their reply, and the messages with ${l.name || l.contact}`}
      empty={<p className="spl-empty label-data">NO REPLY WAITS ON YOU</p>}
      columns={leadColumns(view, [
        { head: 'THEY SAID', cell: (l) => saidLabel(l.said), sort: (l) => ['wants', 'open', 'auto'].indexOf(l.said?.says ?? 'open'), tone: (l) => (l.said?.says === 'wants' ? 'on' : l.said?.says === 'auto' ? 'dim' : null),
          title: (l) => (l.said?.why ? `They wrote: "${l.said.why}"` : 'No rule could tell what this reply says: open it and read it') },
        { head: 'CHANNEL', cell: (l) => sourceWords(channelOf(engine, l)), attrs: (l) => ({ 'data-channel': channelOf(engine, l) ?? '' }) },
        { head: 'WAITING', cell: (l) => (l.due?.kind === 'answer' ? `${l.due.hours} H` : '—'), tone: (l) => (l.due?.kind === 'answer' ? 'alert' : null) },
        { head: 'YOUR ANSWER', sort: (l) => ['owed', 'staged', 'sent'].indexOf(answerOf(engine, l).state),
          cell: (l) => { if (l.said?.says === 'auto') return 'NONE OWED'; const a = answerOf(engine, l); return a.state === 'sent' ? `SENT · ${day(a.at)}` : ANSWER_WORDS[a.state]; },
          tone: (l) => (l.said?.says === 'auto' ? 'dim' : answerOf(engine, l).state === 'sent' ? 'on' : 'alert'), attrs: (l) => ({ 'data-answer': answerOf(engine, l).state }),
          title: (l) => { const a = answerOf(engine, l); return a.state === 'staged' ? `Your sales member staged "${a.subject}" — it waits for you in EMAILS, marked REPLY` : null; } },
        { head: 'PROMISED', cell: (l) => l.due?.promised ?? '—' },
      ])} />
    <Closed engine={engine} view={view} says="no" title="SAID NO" busy={busy} onSaid={onSaid}
      note="THEY DECLINED. NOTHING MORE IS WRITTEN TO THEM. EACH STAYS ON YOUR LIST AS A CONTACT, AND IS NOT ON THE DO-NOT-CONTACT LIST." />
    <Closed engine={engine} view={view} says="gone" title="HAVE LEFT" busy={busy} onSaid={onSaid}
      note="THE PERSON IS NO LONGER THERE. NOTHING MORE IS WRITTEN TO THAT ADDRESS. WHERE THEIR OFFICE POINTED TO SOMEONE ELSE, THE ADDRESS IS SHOWN." />
  </>
);
