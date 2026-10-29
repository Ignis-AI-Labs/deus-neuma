// CampaignMonth — a campaign's posts on the shared month calendar
// (QueueCalendar.jsx, the queue's own), replacing the campaign page's old
// day-list and its second approve card (campaign plan §5: duplicates cut). A
// day picked lists its posts; each OPENs on its own card in its platform's
// window, where the one decision lives — never a second approve button here.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { QueueCalendar } from '../QueueCalendar.jsx';
import { filterQueueToDay } from '../campaigns-helpers.js';
import { StatusMark } from '../StatusMark.jsx';
import { AccountChip } from '../accounts/AccountChip.jsx';
import { requestWaitingJump } from '../waiting/waiting-jump.js';

const monthOf = (now) => ({ year: new Date(now).getFullYear(), month: new Date(now).getMonth() });

/** @param {{campaign: object, queue: ?object[]}} props */
export const CampaignMonth = ({ campaign, queue }) => {
  const now = Date.now();
  const [cursor, setCursor] = useState(() => monthOf(now));
  const [dayKey, setDayKey] = useState(undefined);
  if (!queue) return <p className="settings-note">Reading the queue…</p>;
  // A reply rides no calendar (ruling, 2026-08-06): it is decided where the exchange is.
  const mine = queue.filter((e) => e.campaignId === campaign.id && e.kind !== 'reply');
  const shift = (n) => { uiSound('toggle'); setCursor(({ year, month }) => { const d = new Date(year, month + n, 1); return { year: d.getFullYear(), month: d.getMonth() }; }); };
  const day = dayKey === undefined ? null : filterQueueToDay(mine, dayKey);
  const open = (e) => {
    uiSound('toggle');
    requestWaitingJump({ where: { app: e.channelId, channelId: e.channelId, entryId: e.id, section: 'posts' } });
  };
  return (
    <>
      <QueueCalendar year={cursor.year} monthIndex={cursor.month} entries={mine} now={now} selectedKey={dayKey ?? null}
        onPick={(k) => { uiSound('toggle'); setDayKey(k); }} onPrevMonth={() => shift(-1)} onNextMonth={() => shift(1)}
        onToday={() => { uiSound('toggle'); setCursor(monthOf(now)); }} />
      {mine.length === 0 ? <p className="settings-note">Nothing staged under this campaign yet.</p> : null}
      {day ? day.map((e) => (
        <div key={e.id} className="settings-provider-row campaign-day-post">
          <AccountChip entry={e} />
          <StatusMark entry={e} named />
          <span className="settings-v" data-own-words>{String(e.text || '').slice(0, 90)}</span>
          <button type="button" className="settings-set" onClick={() => open(e)}>OPEN</button>
        </div>
      )) : null}
    </>
  );
};
