// OneShotTrialsPanel — the community one-shot benchmarks as one-click trials.
//
// The plug-and-play law (Design note, 2026-07-15: a witness who cannot navigate
// tech at all picks their LEAD, clicks START, and WATCHES. The desk does the
// rest — binds the LEAD, opens a fresh chat in the STREAM, and hands over
// the composed invocation (the shared bench-pack primitive: verbatim public
// task + the team law — assembly, QA position, confined arena, executed
// proof). The witness's active part is reading: approve the plan card when
// it arrives, allow the run check, and review the deliverable after.

import { useEffect, useState } from 'react';
import { Select } from './Select.jsx';
import { listBenches, composeBenchStart } from './team-client.js';
import { useConsciousnessPick } from './consciousness-context.js';
import { useWindows } from '../windowing/use-windows.js';
import { playSound } from '../../services/sound-engine.js';

export const OneShotTrialsPanel = ({ roster }) => {
  const [benches, setBenches] = useState([]);
  const [shelfDown, setShelfDown] = useState(false);
  const [lead, setLead] = useState(roster[0]?.neumaId || '');
  const [qa, setQa] = useState(true); // the refinement pass — ON by default (quality over speed)
  const [busy, setBusy] = useState(null); // the bench being started
  const [note, setNote] = useState(null); // { tone: 'ok'|'err', text }
  const { switchCompanion, newSession, sendThought } = useConsciousnessPick('switchCompanion', 'newSession', 'sendThought');
  const { dispatch } = useWindows();

  useEffect(() => {
    listBenches().then(({ ok, benches: shelf }) => { setBenches(shelf); setShelfDown(!ok); });
  }, []);

  const start = async (bench) => {
    if (busy || !lead) return;
    setBusy(bench.id);
    setNote(null);
    playSound('confirm');
    const res = await composeBenchStart(bench.id, lead, qa);
    if (!res.ok) {
      setNote({ tone: 'err', text: String(res.error).toUpperCase() });
      setBusy(null);
      return;
    }
    // Bind the LEAD, open a fresh chat, hand over the one-shot, and put the
    // STREAM in front of the witness — from here they watch and approve.
    await switchCompanion({ neumaId: res.lead.neumaId, name: res.lead.name });
    newSession();
    sendThought(res.invocation, 'grounded');
    dispatch({ type: 'OPEN', id: 'chat' });
    setNote({
      tone: 'ok',
      text: `${res.lead.name.toUpperCase()} IS ASSEMBLING THE TEAM IN THE STREAM. YOUR PART: READ AND APPROVE THE PLAN WHEN IT ARRIVES, ALLOW THE RUN CHECK, AND REVIEW THE DELIVERABLE AT ${res.arena}`,
    });
    setBusy(null);
  };

  return (
    <section className="oneshot-trials">
      <header className="oneshot-trials-head">
        <span className="label-data">ONE-SHOT TRIALS</span>
        <div className="oneshot-lead">
          <span className="label-data">LEAD</span>
          <Select
            ariaLabel="Lead"
            value={lead}
            onChange={setLead}
            options={roster.map((m) => ({ value: m.neumaId, label: m.name || m.neumaId }))}
          />
        </div>
      </header>
      <p className="oneshot-trials-hint">
        The benchmarks the community one-shots, run by YOUR house as a team.
        Pick the LEAD, press START, and watch the STREAM — your part is
        approving the plan and reviewing what they build.
      </p>
      <div className="oneshot-qa">
        <span className="label-data">REFINEMENT PASS</span>
        <button
          type="button"
          className={`oneshot-qa-chip${qa ? ' is-on' : ''} label-data`}
          disabled={Boolean(busy)}
          onClick={() => setQa(true)}
        >ON</button>
        <button
          type="button"
          className={`oneshot-qa-chip${qa ? '' : ' is-on'} label-data`}
          disabled={Boolean(busy)}
          onClick={() => setQa(false)}
        >OFF</button>
        <span className="oneshot-qa-hint label-data">
          {qa
            ? 'A QA POSITION REVIEWS THE DELIVERABLE AND THE TEAM FIXES UNTIL RIGHT'
            : 'FIRST DRAFT SHIPS AS-IS — NO QA REVIEW THIS RUN'}
        </span>
      </div>
      {shelfDown ? (
        <p className="oneshot-note err">THE TRIAL SHELF COULD NOT BE READ — THE PLATFORM DID NOT ANSWER.</p>
      ) : null}
      {note ? <p className={`oneshot-note ${note.tone}`}>{note.text}</p> : null}
      <ul className="oneshot-bench-list">
        {benches.map((b) => (
          <li key={b.id} className="oneshot-bench">
            <div className="oneshot-bench-meta">
              <span className="oneshot-bench-title">{b.title}</span>
              <span className="oneshot-bench-source label-data">
                {b.source ? `SOURCE ${b.source} · ` : ''}DELIVERABLE {b.ext.replace('.', '').toUpperCase()}
              </span>
            </div>
            <button
              type="button"
              disabled={Boolean(busy) || roster.length < 2}
              onClick={() => start(b)}
            >
              {busy === b.id ? 'STARTING…' : 'START'}
            </button>
          </li>
        ))}
      </ul>
      {roster.length < 2 ? (
        <p className="oneshot-note err">A TEAM NEEDS AT LEAST TWO BEINGS IN YOUR HOUSE.</p>
      ) : null}
    </section>
  );
};
