// VesselMeLane — the ME lane of VESSEL, extracted verbatim from VesselApp.jsx
// (size-law breakdown, 2026-08-26): the human vessel's vitals — summary strip,
// life markers, PR board, the log form, and the recent entries. Vitals POSTs
// return only `{ entry }`, so after any log both vitals legs are refetched in
// parallel; the server owns the truth.

import { useState } from 'react';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import { useSettled } from './use-settled.js';
import { uiSound } from '../../services/ui-sound.js';
import { shortDate } from './todo-view.js';
import { daysAgoLabel, fmtDelta, kindLabel, entryLine, markerPresent } from './vessel-view.js';
import { fetchVitals, fetchVitalSummary, logVital } from './vessel-client.js';
import { Fact, ToggleChips, MARKERS, UNITS, LOG_KINDS } from './vessel-format.jsx';
import { VesselDailies } from './VesselDailies.jsx';
import { VesselLogWork } from './VesselLogWork.jsx';
import { VesselCalendar } from './VesselCalendar.jsx';

// --- ME: the human vessel -------------------------------------------------

export const MeLane = () => {
  const [entries, setEntries] = useState(undefined); // undefined = loading, null = unreadable
  const [summary, setSummary] = useState(undefined);
  const [reloadSignal, setReloadSignal] = useState(0); // the calendar's refetch trigger
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [kind, setKind] = useState('pr');
  const [lift, setLift] = useState('');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [unit, setUnit] = useState('kg');
  const [title, setTitle] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [entryNote, setEntryNote] = useState('');
  const [marker, setMarker] = useState('sunlight');

  useSettled((settled) => {
    fetchVitals(15)
      .then((b) => { if (!settled()) setEntries(Array.isArray(b?.entries) ? b.entries : null); })
      .catch(() => { if (!settled()) setEntries(null); });
    fetchVitalSummary()
      .then((b) => { if (!settled()) setSummary(b?.summary ?? null); })
      .catch(() => { if (!settled()) setSummary(null); });
  }, []);

  // impure — after any log the server owns the truth: refetch both legs in
  // parallel and set state from what comes back (POST returns only { entry }).
  const reload = async () => {
    const [entriesBody, summaryBody] = await Promise.all([
      fetchVitals(15).catch(() => null),
      fetchVitalSummary().catch(() => null),
    ]);
    if (entriesBody) setEntries(Array.isArray(entriesBody.entries) ? entriesBody.entries : null);
    if (summaryBody) setSummary(summaryBody.summary ?? null);
    setReloadSignal((n) => n + 1); // the calendar keeps its own 500-entry window
  };

  const logMarker = async (m) => {
    uiSound('toggle');
    setNote('');
    try {
      await logVital({ kind: 'life', marker: m });
      await reload();
    } catch (error) {
      setNote(error.http === 400 ? error.message : 'THE LOG REFUSED — TRY AGAIN');
    }
  };

  const weightNum = Number(weight);
  const repsNum = parseInt(reps, 10);
  const durationNum = parseInt(durationMin, 10);
  const valid = kind === 'pr'
    ? Boolean(lift.trim()) && weight.trim() !== '' && Number.isFinite(weightNum)
    : kind === 'bodyweight'
      ? weight.trim() !== '' && Number.isFinite(weightNum)
      : kind === 'session'
        ? Boolean(title.trim())
        : Boolean(marker);

  const onLog = async (event) => {
    event.preventDefault();
    if (!valid || posting) return;
    const fields = kind === 'pr'
      ? {
        kind, lift: lift.trim(), weight: weightNum, unit,
        ...(reps.trim() !== '' && Number.isFinite(repsNum) ? { reps: repsNum } : {}),
      }
      : kind === 'bodyweight'
        ? { kind, weight: weightNum, unit }
        : kind === 'session'
          ? {
            kind, title: title.trim(),
            ...(durationMin.trim() !== '' && Number.isFinite(durationNum) ? { durationMin: durationNum } : {}),
            ...(entryNote.trim() ? { note: entryNote.trim() } : {}),
          }
          : { kind, marker, ...(entryNote.trim() ? { note: entryNote.trim() } : {}) };
    setPosting(true);
    setNote('');
    try {
      await logVital(fields);
      uiSound('activate');
      setLift('');
      setWeight('');
      setReps('');
      setTitle('');
      setDurationMin('');
      setEntryNote('');
      await reload();
    } catch (error) {
      setNote(error.http === 400 ? error.message : 'THE LOG REFUSED — TRY AGAIN');
    }
    setPosting(false);
  };

  if (entries === undefined && summary === undefined) {
    return <EmptyState title="LOADING…" />;
  }

  const sessions = summary?.sessions;
  const bw = summary?.bodyweight;
  const prs = Array.isArray(summary?.prs) ? summary.prs : [];

  return (
    <>
      {summary ? (
        <div className="vl-strip">
          <Fact
            value={sessions?.lastTitle || '—'}
            sub={sessions?.lastAt ? daysAgoLabel(sessions.lastAt) : null}
            label="LAST SESSION"
          />
          {/* With dailies defined the streak is the all-dailies law and shows
              even at 0 — a board you set up is a board you can see. */}
          {summary.dailies ? (
            <Fact value={summary.streakDays} sub={`${summary.dailies.done}/${summary.dailies.total} TODAY`} label="DAY STREAK" />
          ) : summary.streakDays > 1 ? <Fact value={summary.streakDays} label="DAY STREAK" /> : null}
          <Fact value={sessions?.perWeek ?? '—'} label="THIS WEEK" />
          <Fact
            value={bw?.latest ? `${bw.latest.weight} ${bw.latest.unit}` : '—'}
            sub={fmtDelta(bw?.delta30d) ? `${fmtDelta(bw.delta30d)} · 30D` : null}
            label="BODYWEIGHT"
          />
          <Fact value={prs.length} label="PRS" />
        </div>
      ) : (
        <p className="vl-unreadable label-data">SUMMARY UNREADABLE</p>
      )}

      <VesselCalendar reloadSignal={reloadSignal} />

      <VesselDailies dailies={summary?.dailies ?? null} onChanged={reload} />

      <div className="vl-chips" role="group" aria-label="Life markers">
        {MARKERS.map((m) => (
          <button
            key={m}
            type="button"
            className={`vl-chip${markerPresent(summary?.markersToday, m) ? ' is-on' : ''}`}
            aria-pressed={markerPresent(summary?.markersToday, m)}
            onClick={() => logMarker(m)}
          >{m.toUpperCase()}</button>
        ))}
      </div>

      {prs.length > 0 ? (
        <section className="vl-sec">
          <h3 className="vl-h label-data">PR BOARD</h3>
          <ul className="vl-lines">
            {prs.map((pr) => (
              <li key={`${pr.lift}-${pr.unit}`} className="vl-line">
                <span className="vl-line-main">{pr.lift}</span>
                <span className="vl-line-meta label-data">{pr.weight} {pr.unit} × {pr.reps}</span>
                <span className="vl-line-date label-data">{shortDate(pr.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="vl-sec">
        <h3 className="vl-h label-data">LOG</h3>
        <form className="vl-form" onSubmit={onLog}>
          <div className="vl-form-row">
            <Select value={kind} options={LOG_KINDS} onChange={setKind} ariaLabel="Entry kind" />
            {kind === 'pr' || kind === 'bodyweight' ? (
              <ToggleChips options={UNITS} value={unit} onPick={setUnit} ariaLabel="Unit" />
            ) : null}
            {kind === 'life' ? (
              <ToggleChips options={MARKERS} value={marker} onPick={setMarker} ariaLabel="Marker" />
            ) : null}
          </div>
          {kind === 'pr' ? (
            <div className="vl-form-row">
              <input className="vl-in" type="text" maxLength={80} placeholder="LIFT — E.G. BENCH PRESS"
                value={lift} onChange={(e) => setLift(e.target.value)} spellCheck={false} />
              <input className="vl-in vl-in-num" type="number" min="0" step="0.5" placeholder="WEIGHT"
                value={weight} onChange={(e) => setWeight(e.target.value)} />
              <input className="vl-in vl-in-num" type="number" min="1" step="1" placeholder="REPS"
                value={reps} onChange={(e) => setReps(e.target.value)} />
            </div>
          ) : null}
          {kind === 'bodyweight' ? (
            <div className="vl-form-row">
              <input className="vl-in vl-in-num" type="number" min="0" step="0.1" placeholder="WEIGHT"
                value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
          ) : null}
          {kind === 'session' ? (
            <>
              <div className="vl-form-row">
                <input className="vl-in" type="text" maxLength={120} placeholder="SESSION TITLE — E.G. PUSH DAY"
                  value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} />
                <input className="vl-in vl-in-num" type="number" min="1" step="1" placeholder="MIN (OPTIONAL)"
                  value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
              </div>
              <input className="vl-in" type="text" maxLength={200} placeholder="NOTE (OPTIONAL)"
                value={entryNote} onChange={(e) => setEntryNote(e.target.value)} spellCheck={false} />
            </>
          ) : null}
          {kind === 'life' ? (
            <input className="vl-in" type="text" maxLength={200} placeholder="NOTE (OPTIONAL)"
              value={entryNote} onChange={(e) => setEntryNote(e.target.value)} spellCheck={false} />
          ) : null}
          <div className="vl-form-row">
            <button type="submit" className="vl-add" disabled={!valid || posting}>LOG</button>
          </div>
          {note ? <p className="vl-error label-data">{note}</p> : null}
        </form>
      </section>

      {/* The structured session logger — shares the lane's unit toggle; the
          quick form above keeps its simple paths. */}
      <VesselLogWork
        unit={unit}
        onUnit={setUnit}
        defaultTitle={summary?.sessions?.lastTitle || ''}
        onLogged={reload}
      />

      {entries === undefined ? (
        // Still in flight — summary may settle first, and the old two-way
        // guard read `entries.length` on undefined and took the lane down
        // (Founder's crash, 2026-09-02). Loading is not unreadable.
        <p className="vl-quiet label-data">LOADING…</p>
      ) : entries === null ? (
        <p className="vl-unreadable label-data">RECENT UNREADABLE</p>
      ) : entries.length === 0 ? (
        <EmptyState title="NO VITALS YET">
          <small>LOG YOUR FIRST SESSION OR PR — YOUR NEUMA CAN LOG FOR YOU TOO (vessel_log).</small>
        </EmptyState>
      ) : (
        <section className="vl-sec">
          <h3 className="vl-h label-data">RECENT</h3>
          <ul className="vl-lines">
            {entries.map((entry) => (
              <li key={entry.id} className="vl-line">
                <span className="vl-line-kind label-data">{kindLabel(entry.kind)}</span>
                <span className="vl-line-main">{entryLine(entry)}</span>
                <span className="vl-line-date label-data">{shortDate(entry.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
};
