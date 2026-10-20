// TodoCalendarRegister — the TASKS window's CALENDAR register: the house
// calendar (house-calendar/HouseCalendar.jsx — everything scheduled for the
// operator, every member, the house and the machine) and the subscribe link.
// The ICS feed is the house's deadlines, read-only, in any calendar app.

import { useState } from 'react';
import { apiCall, authHeadersOrNull } from '../../utils/http.js';
import { uiSound } from '../../services/ui-sound.js';
import { HouseCalendar } from './house-calendar/HouseCalendar.jsx';

/** @param {{onOpenList?: (laneId: string) => void}} props — opens a person's list in the LISTS register */
export const TodoCalendarRegister = ({ onOpenList = null }) => {
  const [link, setLink] = useState(''); // the minted subscribe URL, shown once
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // impure — mint (or rotate) the ICS subscribe link. One live token per
  // wallet: minting again kills the old link, which is the whole revocation.
  const mintLink = async () => {
    uiSound('activate');
    setBusy(true);
    setErr('');
    try {
      const { token } = await apiCall('POST', '/api/v1/tasks/calendar-token', { headers: authHeadersOrNull() });
      setLink(`${window.location.origin}/api/v1/tasks/calendar.ics?token=${token}`);
    } catch {
      setErr('COULD NOT MINT THE LINK');
    }
    setBusy(false);
  };

  const revokeLink = async () => {
    uiSound('close');
    setBusy(true);
    setErr('');
    try {
      await apiCall('DELETE', '/api/v1/tasks/calendar-token', { headers: authHeadersOrNull() });
      setLink('');
    } catch {
      setErr('COULD NOT REVOKE THE LINK');
    }
    setBusy(false);
  };

  // the subscribe link rides the calendar itself, pinned under its rail —
  // never a line beneath it that the calendar can overflow onto
  const subscribe = (
    <div className="hcal-ics">
      {link ? (
        <>
          <span className="hcal-ics-note">SUBSCRIBE URL — PASTE INTO YOUR CALENDAR APP. MINTING A NEW ONE KILLS THIS:</span>
          <span className="hcal-ics-url">{link}</span>
          <button type="button" className="hcal-btn" disabled={busy} onClick={revokeLink}>REVOKE</button>
        </>
      ) : (
        <button type="button" className="hcal-btn" disabled={busy} onClick={mintLink}>ICS SUBSCRIBE LINK</button>
      )}
      {err ? <span className="hcal-error">{err}</span> : null}
    </div>
  );

  return <HouseCalendar onOpenList={onOpenList} foot={subscribe} />;
};
