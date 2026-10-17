// TodoCalendarRegister — the TASKS window's CALENDAR register: the whole
// house's deadlines on the shared month-grid leaf (the desk's third adapter
// over it, after the queue and the vessel), with the lane filter Founder asked
// for (2026-09-20): ALL / ME / HOUSE / WITNESSES / each lane. The subscribe
// link lives here — the ICS feed is this grid, read-only, on his phone.
//
// One fetch (GET /api/v1/tasks/deadlines), then the pure fold in
// tasks-calendar.js. Records carry their lane identity server-side
// (house-deadlines.js); nothing is inferred client-side.

import { useEffect, useState } from 'react';
import { apiCall, authHeadersOrNull } from '../../utils/http.js';
import { buildMonthGrid, dayKeyOf, shiftDayKey } from './month-grid.js';
import { Select } from './Select.jsx';
import { uiSound } from '../../services/ui-sound.js';
import {
  taskDayOfEntry, taskCountSpec, taskCountLanes, taskDayView, taskTotals,
  calendarLaneOptions, filterByLane,
} from './tasks-calendar.js';

const WEEKDAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

const Count = ({ n, tone, letter }) => (
  n > 0 ? <span className={`qcal-n is-${tone}`}>{letter}{n}</span> : null
);

const cellLabel = (cell) => {
  const day = new Date(`${cell.key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const parts = taskCountLanes
    .filter((lane) => cell.counts[lane.key] > 0)
    .map((lane) => lane.label(cell.counts[lane.key]));
  return `${day} — ${parts.length ? parts.join(', ') : 'nothing due'}. Show this day.`;
};

// impure — the one read the register runs on.
const fetchDeadlines = async () => {
  const headers = authHeadersOrNull();
  if (!headers) return null;
  return apiCall('GET', '/api/v1/tasks/deadlines', { headers });
};

export const TodoCalendarRegister = () => {
  const [deadlines, setDeadlines] = useState(undefined); // undefined = loading, null = unreadable
  const [filter, setFilter] = useState('all');
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
  });
  const [dayKey, setDayKey] = useState(null); // null = the month
  const [link, setLink] = useState(''); // the minted subscribe URL, shown once
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let settled = false;
    fetchDeadlines()
      .then((body) => { if (!settled) setDeadlines(Array.isArray(body?.deadlines) ? body.deadlines : null); })
      .catch(() => { if (!settled) setDeadlines(null); });
    return () => { settled = true; };
  }, []);

  const pick = (key) => { uiSound('toggle'); setDayKey(key); setErr(''); };
  const shiftMonth = (delta) => setYm(({ year, monthIndex }) => {
    const next = monthIndex + delta;
    return next < 0 ? { year: year - 1, monthIndex: 11 }
      : next > 11 ? { year: year + 1, monthIndex: 0 }
        : { year, monthIndex: next };
  });
  const goToday = () => {
    const d = new Date();
    setYm({ year: d.getFullYear(), monthIndex: d.getMonth() });
    pick(dayKeyOf(d));
  };

  // impure — mint (or rotate) the ICS subscribe link. One live token per
  // wallet: minting again kills the old link, which is the whole revocation.
  const mintLink = async () => {
    uiSound('activate');
    setBusy(true);
    setErr('');
    try {
      const headers = authHeadersOrNull();
      const { token } = await apiCall('POST', '/api/v1/tasks/calendar-token', { headers });
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
      const headers = authHeadersOrNull();
      await apiCall('DELETE', '/api/v1/tasks/calendar-token', { headers });
      setLink('');
    } catch {
      setErr('COULD NOT REVOKE THE LINK');
    }
    setBusy(false);
  };

  if (deadlines === undefined) {
    return <p className="vl-quiet label-data">READING THE HOUSE…</p>;
  }
  if (deadlines === null) {
    return <p className="vl-error label-data">DEADLINES UNREACHABLE — TRY REOPENING THE WINDOW.</p>;
  }

  const view = filterByLane(deadlines, filter);
  const todayKey = dayKeyOf(new Date());
  const monthLabel = new Date(ym.year, ym.monthIndex, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    .toUpperCase();
  const totals = taskTotals(view);
  const dayDue = dayKey === null ? [] : taskDayView(view, dayKey);
  const options = calendarLaneOptions(deadlines);
  const filterOptions = [
    { value: 'all', label: `ALL HOUSE (${deadlines.length})` },
    { value: 'me', label: `ME (${options.me})` },
    { value: 'house', label: `HOUSE (${options.house})` },
    { value: 'witnesses', label: `WITNESSES (${options.witnesses})` },
    ...options.lanes.map((l) => ({ value: l.laneId, label: `${l.name.toUpperCase()} (${l.count})` })),
  ];

  return (
    <>
      <div className="todo-lane-pick">
        <Select
          ariaLabel="Calendar lane filter"
          value={filter}
          onChange={(v) => { uiSound('tick'); setFilter(v); }}
          options={filterOptions}
        />
      </div>
      {dayKey === null ? (
        <div className="qcal">
          <div className="qcal-head">
            <button type="button" className="vl-chip" aria-label="Previous month"
              onClick={() => shiftMonth(-1)}>‹</button>
            <span className="label-data qcal-month" aria-live="polite">{monthLabel}</span>
            <button type="button" className="vl-chip" aria-label="Next month"
              onClick={() => shiftMonth(1)}>›</button>
            <button type="button" className="vl-chip" onClick={goToday}>TODAY</button>
          </div>
          <p className="todo-scope-note label-data">
            {totals.overdue > 0 ? `${totals.overdue} OVERDUE · ` : ''}{totals.dueToday} DUE TODAY · THE MONTH GRID MARKS THE DAYS
          </p>
          <div className="qcal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((d) => <span key={d} className="qcal-weekday">{d}</span>)}
          </div>
          <div className="qcal-grid">
            {buildMonthGrid(ym.year, ym.monthIndex, view, {
              dayKeyOfEntry: (r) => taskDayOfEntry(r), countSpec: taskCountSpec,
            }).flat().map((cell, i) => (
              cell.date === null ? (
                <span key={`pad-${i}`} className="qcal-cell is-pad" aria-hidden="true" />
              ) : (
                <button
                  key={cell.key}
                  type="button"
                  className={`qcal-cell${cell.today ? ' is-today' : ''}`}
                  aria-label={cellLabel(cell)}
                  onClick={() => pick(cell.key)}
                >
                  <span className="qcal-day">{cell.date}</span>
                  <span className="qcal-counts">
                    {taskCountLanes.map((lane) => (
                      <Count key={lane.key} n={cell.counts[lane.key]} tone={lane.tone} letter={lane.letter} />
                    ))}
                  </span>
                </button>
              )
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="qcal-head">
            <button type="button" className="vl-chip" onClick={() => setDayKey(null)}>MONTH</button>
            <button type="button" className="vl-chip" aria-label="Previous day"
              onClick={() => setDayKey(shiftDayKey(dayKey, -1))}>‹</button>
            <span className="label-data qcal-month" aria-live="polite">{dayKey}</span>
            <button type="button" className="vl-chip" aria-label="Next day"
              onClick={() => setDayKey(shiftDayKey(dayKey, 1))}>›</button>
            <button type="button" className="vl-chip" onClick={goToday}>TODAY</button>
          </div>
          {dayDue.length === 0 ? (
            <p className="vl-quiet label-data">NOTHING DUE THIS DAY.</p>
          ) : (
            <ul className="vl-lines">
              {dayDue.map((r) => (
                <li key={r.id} className="vl-line">
                  <span className="vl-line-kind label-data">{r.source}</span>
                  <span className="vl-line-main">
                    {r.title}
                    {r.dueTime ? <span className="vl-line-meta label-data"> BY {r.dueTime}</span> : null}
                    {r.overdue ? <span className="vl-line-meta label-data"> OVERDUE</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="todo-scope-note label-data">
        {link ? (
          <>
            SUBSCRIBE URL — PASTE INTO YOUR CALENDAR APP. MINTING A NEW ONE KILLS THIS:
            <br /><span style={{ wordBreak: 'break-all' }}>{link}</span>
            <button type="button" className="chats-rename-x" disabled={busy} onClick={revokeLink} style={{ marginLeft: 8 }}>
              REVOKE
            </button>
          </>
        ) : (
          <button type="button" className="chats-rename-go" disabled={busy} onClick={mintLink}>
            CALENDAR SUBSCRIBE LINK (.ICS)
          </button>
        )}
        {err ? <span> {err}</span> : null}
      </div>
    </>
  );
};
