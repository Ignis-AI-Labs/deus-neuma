// YourCalendars — the calendars you keep elsewhere, read into the house calendar (Design note, 2026-11-20: […]).
//
// Paste a calendar's private iCal address and everything on it shows here, each meeting is announced before it
// starts, and a call with someone on your lead list is noted on that lead. It is read only, one way. The address is
// a secret, so it is sent once and never shown again: the list names the calendar and where it is kept.
// impure — network.

import { useCallback, useEffect, useState } from 'react';
import { apiCall, authHeadersOrNull } from '../../../utils/http.js';

const call = (method, path = '', body) => apiCall(method, `/api/v1/tasks/calendars${path}`, { headers: authHeadersOrNull(), ...(body ? { body } : {}) });

/** @param {{onChanged?: () => void}} props — called after a calendar is added or removed, so the calendar reads again */
export const YourCalendars = ({ onChanged = () => {} }) => {
  const [state, setState] = useState(null); // {calendars, on}
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [open, setOpen] = useState(false);
  const load = useCallback(() => call('GET').then(setState).catch(() => setState({ calendars: [], on: false, failed: true })), []);
  useEffect(() => { load(); }, [load]);

  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setSaid('');
    try {
      const done = await call('POST', '', { url: url.trim() });
      setUrl('');
      setSaid(`ADDED "${done.calendar.label}" — ${done.events} ENTRIES READ.${done.on ? '' : ' TURN ON "YOUR CALENDARS" UNDER CONNECTIONS AND IT IS READ EVERY 5 MINUTES.'}`);
      await load();
      onChanged();
    } catch (error) {
      setSaid(String(error?.message || 'COULD NOT ADD THE CALENDAR'));
    }
    setBusy(false);
  };
  const remove = async (calendar) => {
    setBusy(true);
    try { await call('DELETE', `/${encodeURIComponent(calendar.id)}`); setSaid(`"${calendar.label}" IS REMOVED.`); await load(); onChanged(); } catch { setSaid('COULD NOT REMOVE IT'); }
    setBusy(false);
  };

  const calendars = state?.calendars ?? [];
  return (
    <details className="hcal-yours" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="hcal-yours-sum label-data">
        YOUR CALENDARS <b>{calendars.length}</b>
        {calendars.length && state && !state.on ? <span className="hcal-error"> · NOT READ: TURN ON “YOUR CALENDARS” UNDER CONNECTIONS</span> : null}
        {calendars.some((c) => c.lastError) ? <span className="hcal-error"> · ONE COULD NOT BE READ</span> : null}
      </summary>
      <ul className="hcal-yours-list">
        {calendars.map((c) => (
          <li key={c.id}>
            <span className="hcal-yours-name">{c.label}</span>
            <span className="hcal-quiet label-data">{c.host}{c.lastError ? ` · COULD NOT BE READ: ${c.lastError}` : c.lastReadAt ? ' · READ' : ''}</span>
            <button type="button" className="hcal-btn" disabled={busy} onClick={() => remove(c)} aria-label={`Remove the calendar ${c.label}`}>REMOVE</button>
          </li>
        ))}
      </ul>
      <form className="hcal-yours-add" onSubmit={add}>
        <label className="hcal-quiet label-data" htmlFor="hcal-yours-url">ADD ONE — PASTE ITS PRIVATE iCAL ADDRESS (GOOGLE CALENDAR: SETTINGS, THE CALENDAR, “SECRET ADDRESS IN iCAL FORMAT”)</label>
        <span className="hcal-yours-row">
          <input id="hcal-yours-url" type="password" autoComplete="off" spellCheck={false} className="hcal-yours-input" value={url} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" className="hcal-btn" disabled={busy || !url.trim()}>{busy ? 'READING…' : 'ADD'}</button>
        </span>
      </form>
      <p className="hcal-quiet label-data">READ ONLY, ONE WAY. EVERY MEETING SHOWS HERE AND IS ANNOUNCED WHEN IT IS ADDED, AN HOUR BEFORE AND TEN MINUTES BEFORE. THE ADDRESS IS KEPT PRIVATE AND NEVER SHOWN AGAIN.</p>
      {said ? <p className="hcal-quiet label-data" role="status">{said}</p> : null}
    </details>
  );
};
