// CallAdd — the operator books a call onto a lead by hand (Design note, 2026-11-20: a call was verified in the mailbox and
// […]). Who it is with (a lead already on the ledger, found by name or address), when
// (in this machine's own time), what it is called, and where it is joined. It then stands in the sheet above, on the
// house calendar, and is announced before it starts. A call that moved is booked again with its new time.
import { useState } from 'react';

const words = (l) => `${l.name || l.contact} — ${l.contact}`;

/** @param {{leads: object[], busy: boolean, onBook: (lead: object, call: {at: string, title: string, link: string}) => void}} props */
export const CallAdd = ({ leads, busy, onBook }) => {
  const [who, setWho] = useState('');
  const [when, setWhen] = useState('');
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const key = who.trim().toLowerCase();
  const lead = key ? leads.find((l) => words(l).toLowerCase() === key || String(l.contact ?? '').toLowerCase() === key) ?? null : null;
  const at = when && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : null;
  const linkOk = !link.trim() || /^https:\/\/\S+$/.test(link.trim());
  const book = () => { onBook(lead, { at, title: title.trim(), link: link.trim() }); setWho(''); setWhen(''); setTitle(''); setLink(''); };
  return (
    <div className="spl-call-add" data-call-add="">
      <span className="spl-k label-data">ADD A CALL</span>
      <input className="cline-input" list="spl-call-leads" aria-label="Who the call is with: a lead's name or address" placeholder="who — a lead's name or address" disabled={busy} value={who} onChange={(e) => setWho(e.target.value)} />
      <datalist id="spl-call-leads">{leads.map((l) => <option key={l.id} value={words(l)} />)}</datalist>
      <input className="cline-input" type="datetime-local" aria-label="When the call starts, in this computer's time" disabled={busy} value={when} onChange={(e) => setWhen(e.target.value)} />
      <input className="cline-input" aria-label="What the call is" placeholder="what the call is" maxLength={120} disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="cline-input" aria-label="The link the call is joined at (optional)" placeholder="https:// link to join (optional)" disabled={busy} value={link} onChange={(e) => setLink(e.target.value)} />
      <button type="button" className="sec-scan label-data" disabled={busy || !lead || !at || !linkOk} onClick={book}>BOOK THE CALL</button>
      {key && !lead ? <span className="spl-note label-data" role="status">NO LEAD BY THAT NAME OR ADDRESS — A CALL IS BOOKED ONTO A LEAD (ADD THE PERSON UNDER ALL PEOPLE FIRST)</span> : null}
    </div>
  );
};
