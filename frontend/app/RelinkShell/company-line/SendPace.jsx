// SendPace — THIS WEEK'S SENDING (Design note, 2026-11-24: […]). One line
// a campaign of the goal: its share of the week, what was sent this week and today, what is still to go and how many a
// working day that is, and of the people written to this week how many bounced and how many wrote back. It is a
// measure: it sends nothing and holds nothing. The goal is the operator's to set, under the table.
// impure — reads and sets the goal through the revenue routes.
import { useEffect, useState } from 'react';
import { Fold } from '../fold/Fold.jsx';
import { Sheet } from '../sheet/Sheet.jsx';
import { getSendGoal, setSendGoal } from '../../../services/revenue-client.js';
import { paceOf } from './send-pace.js';

const GoalForm = ({ goal, campaigns, busy, onSet }) => {
  const [weekly, setWeekly] = useState(goal?.weekly ?? 500);
  const [picked, setPicked] = useState(() => new Set(goal?.campaigns ?? []));
  const flip = (id) => setPicked((was) => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const share = picked.size ? Math.floor(Number(weekly) / picked.size) : 0;
  return (
    <fieldset className="spl-pace-form" disabled={busy} data-send-goal-form="">
      <legend className="spl-k label-data">THE WEEK'S GOAL</legend>
      <label className="spl-run-f label-data">EMAILS A WEEK <input className="cline-input spl-run-n" type="number" min="0" max="5000" value={weekly} onChange={(e) => setWeekly(e.target.value)} aria-label="How many emails you mean to send in a week" /></label>
      <span className="spl-pace-picks" role="group" aria-label="the campaigns the week's number is split between">
        {campaigns.map((c) => (
          <label key={c.id} className="spl-run-f label-data"><input type="checkbox" checked={picked.has(c.id)} onChange={() => flip(c.id)} /> {c.name}</label>
        ))}
      </span>
      <button type="button" className="sec-scan label-data" disabled={busy || !picked.size || !(Number(weekly) > 0)} data-send-goal-set="" onClick={() => onSet({ weekly: Number(weekly), campaigns: [...picked] })}>
        {picked.size && Number(weekly) > 0 ? `SET IT — ${share} A WEEK FOR EACH OF ${picked.size}` : 'PICK THE CAMPAIGNS'}
      </button>
      {goal ? <button type="button" className="sec-scan label-data" disabled={busy} data-send-goal-off="" onClick={() => onSet({ weekly: 0, campaigns: [] })}>NO GOAL</button> : null}
    </fieldset>
  );
};

/** @param {{engine: object}} props */
export const SendPace = ({ engine }) => {
  const [goal, setGoal] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let on = true; getSendGoal().then((r) => { if (on) setGoal(r?.goal ?? null); }, () => {}); return () => { on = false; }; }, []);
  const campaigns = (engine?.campaigns ?? []).filter((c) => c.state !== 'archived');
  const pace = paceOf(engine, goal);
  const onSet = async (next) => { setBusy(true); setError(null); try { setGoal((await setSendGoal(next))?.goal ?? null); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const t = pace.total;
  const stats = goal
    ? [`${t.sent} OF ${pace.weekly} SENT THIS WEEK`, t.toGo ? `${t.aDay} A DAY TO GET THERE · ${pace.daysLeft} WORKING DAY${pace.daysLeft === 1 ? '' : 'S'} LEFT` : 'GOAL MET', `${t.bounced} BOUNCED · ${t.replied} WROTE BACK`]
    : [`${t.sent} SENT THIS WEEK`, 'NO GOAL SET'];
  return (
    <Fold id="send-pace" title="THIS WEEK'S SENDING" level={2} stats={stats} waits={false}>
      {pace.rows.length ? (
        <Sheet label="this week's sending by campaign" rows={pace.rows} rowKey={(r) => r.id} rowName={(r) => r.name} rowAttrs={(r) => ({ 'data-pace': r.id })}
          columns={[
            { head: 'CAMPAIGN', cell: (r) => r.name },
            { head: 'GOAL', cell: (r) => r.target, sort: (r) => r.target ?? -1 },
            { head: 'SENT THIS WEEK', cell: (r) => r.sent, sort: (r) => r.sent },
            { head: 'TODAY', cell: (r) => r.today, sort: (r) => r.today },
            { head: 'TO GO', cell: (r) => r.toGo, sort: (r) => r.toGo ?? -1, tone: (r) => (r.toGo === 0 ? 'on' : null) },
            { head: 'A DAY TO GET THERE', cell: (r) => (r.toGo ? r.aDay : null), sort: (r) => r.aDay ?? -1 },
            { head: 'BOUNCED', cell: (r) => r.bounced, sort: (r) => r.bounced, tone: (r) => (r.sent >= 20 && r.bounced / r.sent > 0.03 ? 'alert' : null), title: (r) => (r.sent ? `${Math.round((r.bounced / r.sent) * 100)} in 100 of this week's` : null) },
            { head: 'WROTE BACK', cell: (r) => r.replied, sort: (r) => r.replied },
          ]} />
      ) : <p className="spl-empty label-data">NOTHING SENT THIS WEEK YET</p>}
      <GoalForm key={`${goal?.weekly ?? 0}:${(goal?.campaigns ?? []).join(',')}`} goal={goal} campaigns={campaigns} busy={busy} onSet={onSet} />
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      <p className="spl-note label-data">COUNTED FROM WHAT YOUR OUTBOX SENT SINCE MONDAY, UNDER THE CAMPAIGN OF THE PERSON IT WENT TO. BOUNCED TURNS TO ALERT ABOVE 3 IN 100: THAT, OR REPLIES STOPPING WHILE YOU KEEP SENDING, IS THE SIGN TO SEND FEWER. IT SENDS NOTHING AND HOLDS NOTHING.</p>
    </Fold>
  );
};
