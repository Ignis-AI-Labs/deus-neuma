// RunSchedule — THE DAILY LEAD RUN (Design note, 2026-11-22: […]). One audience a line: whether the house starts its run by itself each
// day, how many leads it goes for, the most credits that day's run may spend, and the hour it may start from. It is
// off until turned on. A run it starts is the same run the START button starts: emails it writes wait for review —
// nothing is sent by it.
// impure — reads and sets the schedule through the revenue routes.
import { useEffect, useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { getRunSchedule, setRunSchedule } from '../../../services/revenue-client.js';

const hourWords = (h) => `${String(h).padStart(2, '0')}:00`;

// One audience's setting, edited under its row.
const Setting = ({ row, busy, onSet }) => {
  const [leads, setLeads] = useState(row.leads);
  const [credits, setCredits] = useState(row.credits);
  const [hour, setHour] = useState(row.hour);
  const send = (on) => onSet({ segment: row.id, on, leads, credits, hour });
  return (
    <div className="spl-run-row" data-schedule-edit={row.id}>
      <label className="spl-run-f label-data">LEADS A DAY <input className="cline-input spl-run-n" type="number" min="1" max="200" value={leads} disabled={busy} onChange={(e) => setLeads(e.target.value)} aria-label={`How many leads a day for ${row.name}`} /></label>
      <label className="spl-run-f label-data">CREDIT LIMIT A DAY <input className="cline-input spl-run-n" type="number" min="0" max="1000" value={credits} disabled={busy} onChange={(e) => setCredits(e.target.value)} aria-label={`The most credits a day's run may spend for ${row.name}`} /></label>
      <label className="spl-run-f label-data">FROM HOUR (0–23) <input className="cline-input spl-run-n" type="number" min="0" max="23" value={hour} disabled={busy} onChange={(e) => setHour(e.target.value)} aria-label={`The hour of the day from which the run of ${row.name} may start`} /></label>
      <button type="button" className="sec-scan label-data" disabled={busy} data-schedule-on="" onClick={() => send(true)}>{row.on ? 'SAVE' : 'TURN ON — RUN IT EVERY DAY'}</button>
      {row.on ? <button type="button" className="sec-scan label-data" disabled={busy} data-schedule-off="" onClick={() => send(false)}>TURN OFF</button> : null}
    </div>
  );
};

/** @param {{audiences: Array<{id: string, name: string}>}} props - the approved audiences on show */
export const RunSchedule = ({ audiences = [] }) => {
  const [schedule, setSchedule] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let on = true; getRunSchedule().then((r) => { if (on) setSchedule(r?.schedule ?? []); }, () => {}); return () => { on = false; }; }, []);
  if (!audiences.length) return null;
  const rows = audiences.map((a) => ({ on: false, leads: 25, credits: 100, hour: 9, startedDay: null, held: null, ...schedule.find((s) => s.segmentId === a.id), id: a.id, name: a.name }));
  const onSet = async (setting) => { setBusy(true); setError(null); try { setSchedule((await setRunSchedule(setting))?.schedule ?? []); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const running = rows.filter((r) => r.on);
  return (
    <Fold id="lead-run-daily" title="DAILY RUNS" level={2} stats={[running.length ? `${running.length} AUDIENCE${running.length === 1 ? '' : 'S'} RUN EVERY DAY` : 'ALL OFF', ...(running.length ? [`${running.reduce((n, r) => n + Number(r.leads), 0)} LEADS A DAY ASKED FOR`] : [])]}>
      <Sheet label="the daily lead runs" rows={rows} rowKey={(r) => r.id} rowName={(r) => r.name} rowAttrs={(r) => ({ 'data-schedule': r.id, 'data-schedule-state': r.on ? 'on' : 'off' })}
        detail={(r) => <Setting key={`${r.id}:${r.on}:${r.leads}:${r.credits}:${r.hour}`} row={r} busy={busy} onSet={onSet} />} detailLabel={() => 'set its daily run'}
        columns={[
          { head: 'AUDIENCE', cell: (r) => r.name },
          { head: 'EVERY DAY', cell: (r) => (r.on ? 'ON' : 'OFF'), tone: (r) => (r.on ? 'on' : undefined) },
          { head: 'LEADS', cell: (r) => (r.on ? r.leads : null) },
          { head: 'CREDIT LIMIT', cell: (r) => (r.on ? r.credits : null) },
          { head: 'FROM', cell: (r) => (r.on ? hourWords(r.hour) : null) },
          { head: 'LAST STARTED', cell: (r) => r.startedDay },
          { head: 'HELD', cell: (r) => (r.held ? `${r.held.day}: ${r.held.why}` : null), tone: (r) => (r.held ? 'alert' : undefined), wrap: true },
        ]} />
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      <p className="spl-note label-data">A DAILY RUN IS THE SAME RUN AS START ABOVE, BEGUN BY THE HOUSE ONCE A DAY WHILE THE DESK IS OPEN: IT GATHERS NOTHING NEW ITSELF, SPENDS UNDER YOUR MONTHLY RULE AND ITS OWN DAILY LIMIT, AND STAGES EMAILS FOR YOUR REVIEW. NOTHING IS SENT BY IT. PAUSING THE HOUSE CLOCK HOLDS EVERY ONE.</p>
    </Fold>
  );
};
