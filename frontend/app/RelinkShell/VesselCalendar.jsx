// VesselCalendar — the ME lane's month and the day under any cell. The month
// is the shared month-grid leaf with the vessel countSpec (S sessions · D
// dailies done · P planned — the .qcal-* grid CSS, domain-free since F4);
// the day view shows the dailies board judged by the law of THAT day (the
// server owns the law — core/vessel/dailies.js; vessel-calendar.js only
// mirrors it for the read), the sessions with their sets, PRs, bodyweight,
// markers, and the planned work with its completion state.
//
// Every write goes through logVital and the whole log is refetched — the
// server owns the truth; a 400 correction rides err.message to the screen,
// never silent. Backfills carry the day's local noon as occurredAt, and a
// restored entry shows its LOGGED date when it was written >1 day late —
// the honesty doctrine: the record never pretends.
//
// The lane fetches only its RECENT page (15), so the calendar fetches the
// full window (500, the route's cap) itself and refetches whenever the
// lane's reloadSignal moves (the lane logged something above).

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { buildMonthGrid, dayKeyOf, shiftDayKey } from './month-grid.js';
import { useSettled } from './use-settled.js';
import { fetchVitals, logVital } from './vessel-client.js';
import { shortDate } from './todo-view.js';
import { entryLine } from './vessel-view.js';
import {
  vesselDayOfEntry, vesselCountSpec, vesselCountLanes, dayView,
  missingDailies, lastSessionTitle, backfillNoonIso, isRestored,
} from './vessel-calendar.js';
import { MonthCalendar } from './MonthCalendar.jsx';

// One exercise as a readable run: […].
const exerciseLine = (ex) => {
  const sets = (Array.isArray(ex?.sets) ? ex.sets : []).map((s) => (
    Number.isFinite(s?.weight) ? `${s.weight} ${s.unit} × ${s.reps}` : `× ${s.reps}`
  ));
  return `${ex?.lift || '—'} — ${sets.join(' · ')}`;
};

// The honesty tag: a restored entry says when it was actually written.
const LoggedTag = ({ entry }) => (
  isRestored(entry)
    ? <span className="vl-line-meta label-data">LOGGED {shortDate(entry.recordedAt)}</span>
    : null
);

// One session with its structured work, in the lane's line idiom.
const SessionBlock = ({ session }) => (
  <li className="vl-line">
    <span className="vl-line-kind label-data">SESSION</span>
    <span className="vl-line-main">
      {entryLine(session)}
      {Array.isArray(session.exercises) ? session.exercises.map((ex, i) => (
        <span key={i} className="vl-line-meta vcal-set label-data">{exerciseLine(ex)}</span>
      )) : null}
    </span>
    <LoggedTag entry={session} />
  </li>
);

export const VesselCalendar = ({ reloadSignal = 0 }) => {
  const [entries, setEntries] = useState(undefined); // undefined = loading, null = unreadable
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
  });
  const [dayKey, setDayKey] = useState(null); // null = the month
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [planTitle, setPlanTitle] = useState('');
  const [planNote, setPlanNote] = useState('');
  const [backfillTitle, setBackfillTitle] = useState('');

  useSettled((settled) => {
    fetchVitals(500)
      .then((b) => { if (!settled()) setEntries(Array.isArray(b?.entries) ? b.entries : null); })
      .catch(() => { if (!settled()) setEntries(null); });
  }, [reloadSignal]);

  // impure — after any write the server owns the truth: refetch the full log.
  const reload = async () => {
    try {
      const body = await fetchVitals(500);
      setEntries(Array.isArray(body?.entries) ? body.entries : null);
    } catch {
      setEntries(null);
    }
  };

  // impure — one POST lane with the lane's busy guard and error law: a 400
  // correction shows verbatim, anything else is a plain refusal.
  const run = async (act) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await act();
      uiSound('activate');
      await reload();
    } catch (error) {
      setErr(error.http === 400 ? error.message : 'THE LOG REFUSED — TRY AGAIN');
    }
    setBusy(false);
  };

  const pick = (key) => {
    uiSound('toggle');
    setDayKey(key);
    setErr('');
  };

  const shiftMonth = (delta) => setYm(({ year, monthIndex }) => {
    const next = monthIndex + delta;
    return next < 0
      ? { year: year - 1, monthIndex: 11 }
      : next > 11
        ? { year: year + 1, monthIndex: 0 }
        : { year, monthIndex: next };
  });

  const goToday = () => {
    const d = new Date();
    setYm({ year: d.getFullYear(), monthIndex: d.getMonth() });
    pick(dayKeyOf(d));
  };

  const backfillDailies = () => run(async () => {
    const occurredAt = backfillNoonIso(dayKey);
    for (const item of missingDailies(entries ?? [], dayKey)) {
      // Sequential: a refusal stops the run with its correction on screen,
      // the entries that landed stay landed (add-only log), and the reload
      // shows exactly which remain missing.
      await logVital({ kind: 'daily', dailyId: item.id, occurredAt });
    }
  });

  const backfillSession = () => run(async () => {
    await logVital({ kind: 'session', title: backfillTitle.trim(), occurredAt: backfillNoonIso(dayKey) });
    setBackfillTitle('');
  });

  const planDay = (event) => {
    event.preventDefault();
    run(async () => {
      await logVital({
        kind: 'planned', title: planTitle.trim(), scheduledFor: dayKey,
        ...(planNote.trim() ? { note: planNote.trim() } : {}),
      });
      setPlanTitle('');
      setPlanNote('');
    });
  };

  const completePlan = (plan) => run(async () => {
    await logVital({
      kind: 'session', title: plan.title, planId: plan.id,
      occurredAt: new Date().toISOString(),
    });
  });

  if (entries === undefined) {
    return (
      <section className="vl-sec">
        <h3 className="vl-h label-data">CALENDAR</h3>
        <p className="vl-quiet label-data">LOADING…</p>
      </section>
    );
  }

  const todayKey = dayKeyOf(new Date());
  return (
    <section className="vl-sec">
      <h3 className="vl-h label-data">CALENDAR</h3>
      {entries === null ? (
        <p className="vl-unreadable label-data">CALENDAR UNREADABLE</p>
      ) : dayKey === null ? (
        <MonthCalendar
          year={ym.year}
          monthIndex={ym.monthIndex}
          weeks={buildMonthGrid(ym.year, ym.monthIndex, entries, { dayKeyOfEntry: vesselDayOfEntry, countSpec: vesselCountSpec })}
          countLanes={vesselCountLanes}
          onPick={pick}
          onPrevMonth={() => shiftMonth(-1)}
          onNextMonth={() => shiftMonth(1)}
          onToday={goToday}
          navClass="vl-chip"
          emptyLabel="nothing logged"
        />
      ) : (
        <VesselDay
          dayKey={dayKey}
          todayKey={todayKey}
          entries={entries}
          busy={busy}
          err={err}
          planTitle={planTitle}
          planNote={planNote}
          backfillTitle={backfillTitle}
          onPlanTitle={setPlanTitle}
          onPlanNote={setPlanNote}
          onBackfillTitle={setBackfillTitle}
          onBackfillDailies={backfillDailies}
          onBackfillSession={backfillSession}
          onPlanDay={planDay}
          onCompletePlan={completePlan}
          onPick={pick}
          onToday={goToday}
        />
      )}
    </section>
  );
};

// The day under one cell — the dailies board by the law of ITS day, the
// planned work with its completion state, the sessions, and the rest of the
// day's record. Actions differ by where the day stands: a past day can be
// restored (LOG FOR THIS DAY), a future day can be planned, a plan that came
// due can be logged done.
const VesselDay = ({
  dayKey, todayKey, entries, busy, err,
  planTitle, planNote, backfillTitle,
  onPlanTitle, onPlanNote, onBackfillTitle,
  onBackfillDailies, onBackfillSession, onPlanDay, onCompletePlan,
  onPick, onToday,
}) => {
  const view = dayView(entries, dayKey);
  const missing = missingDailies(entries, dayKey);
  const past = dayKey < todayKey;
  const future = dayKey > todayKey;
  const dailiesDone = view.dailies.items.filter((i) => i.done).length;
  const extras = [
    ...view.prs.map((e) => ({ entry: e, tag: 'PR' })),
    ...view.bodyweight.map((e) => ({ entry: e, tag: 'BODYWEIGHT' })),
    ...view.markers.map((e) => ({ entry: e, tag: 'MARKER' })),
  ];
  const empty = view.sessions.length === 0 && view.dailies.items.length === 0
    && view.planned.length === 0 && extras.length === 0;

  return (
    <>
      <div className="qcal-head">
        <button type="button" className="vl-chip" onClick={() => onPick(null)}>MONTH</button>
        <button type="button" className="vl-chip" aria-label="Previous day"
          onClick={() => onPick(shiftDayKey(dayKey, -1))}>‹</button>
        <span className="label-data qcal-month" aria-live="polite">{dayKey}</span>
        <button type="button" className="vl-chip" aria-label="Next day"
          onClick={() => onPick(shiftDayKey(dayKey, 1))}>›</button>
        <button type="button" className="vl-chip" onClick={onToday}>TODAY</button>
      </div>

      {view.dailies.items.length > 0 ? (
        <>
          <div className="vl-chips" role="group" aria-label="Dailies in force this day">
            {view.dailies.items.map((item) => (
              <span
                key={item.id}
                className={`vl-chip${item.done ? ' is-on' : past ? ' is-missed' : ''}`}
              >{item.title.toUpperCase()}</span>
            ))}
            <span className="vl-work-tag label-data">{dailiesDone}/{view.dailies.items.length}</span>
          </div>
          {past && missing.length > 0 ? (
            <div className="vl-form-row">
              <button type="button" className="vl-add" disabled={busy} onClick={onBackfillDailies}>
                LOG FOR THIS DAY ({missing.length})
              </button>
            </div>
          ) : null}
        </>
      ) : past ? (
        // No definition stood this day — the session law owns it (≥1 session
        // counts), so the restore is a session, never an invented dailies board.
        <div className="vl-form">
          <p className="vl-quiet label-data">
            NO DAILIES STOOD THIS DAY — IT COUNTS UNDER THE SESSION LAW.
          </p>
          <div className="vl-form-row">
            <input className="vl-in" type="text" maxLength={120}
              placeholder={`SESSION TITLE — E.G. ${(lastSessionTitle(entries) || 'PUSH DAY').toUpperCase()}`}
              value={backfillTitle} onChange={(e) => onBackfillTitle(e.target.value)}
              spellCheck={false} />
            <button type="button" className="vl-add" disabled={!backfillTitle.trim() || busy}
              onClick={onBackfillSession}>LOG FOR THIS DAY</button>
          </div>
        </div>
      ) : null}

      {view.planned.length > 0 ? (
        <ul className="vl-lines">
          {view.planned.map((plan) => (
            <li key={plan.id} className="vl-line">
              <span className="vl-line-kind label-data">PLANNED</span>
              <span className="vl-line-main">{plan.title}{plan.note ? ` — ${plan.note}` : ''}</span>
              {plan.completedBy ? (
                <span className="vl-line-meta label-data">DONE</span>
              ) : !future ? (
                <button type="button" className="vl-add" disabled={busy}
                  onClick={() => onCompletePlan(plan)}>LOG DONE</button>
              ) : (
                <span className="vl-line-meta label-data">OPEN</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {view.sessions.length > 0 ? (
        <ul className="vl-lines">
          {view.sessions.map((session) => <SessionBlock key={session.id} session={session} />)}
        </ul>
      ) : null}

      {extras.length > 0 ? (
        <ul className="vl-lines">
          {extras.map(({ entry, tag }) => (
            <li key={entry.id} className="vl-line">
              <span className="vl-line-kind label-data">{tag}</span>
              <span className="vl-line-main">{entryLine(entry)}</span>
              <LoggedTag entry={entry} />
            </li>
          ))}
        </ul>
      ) : null}

      {empty && !future ? (
        <p className="vl-quiet label-data">NOTHING LOGGED THIS DAY.</p>
      ) : null}

      {future ? (
        <form className="vl-form" onSubmit={onPlanDay}>
          <div className="vl-form-row">
            <input className="vl-in" type="text" maxLength={120}
              placeholder="PLANNED WORK — E.G. LEG DAY"
              value={planTitle} onChange={(e) => onPlanTitle(e.target.value)}
              spellCheck={false} />
          </div>
          <div className="vl-form-row">
            <input className="vl-in" type="text" maxLength={280}
              placeholder="NOTE (OPTIONAL)"
              value={planNote} onChange={(e) => onPlanNote(e.target.value)}
              spellCheck={false} />
            <button type="submit" className="vl-add" disabled={!planTitle.trim() || busy}>PLAN</button>
          </div>
        </form>
      ) : null}

      {err ? <p className="vl-error label-data">{err}</p> : null}
    </>
  );
};
