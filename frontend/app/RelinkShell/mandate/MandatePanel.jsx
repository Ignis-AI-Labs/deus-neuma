// MandatePanel — the CMO's MANDATE in the MARKETING window: where it stands
// and what it means (as marks: MandateStanding.jsx), WITHDRAW always the plainest act,
// RESUME when a tripwire paused it, RENEW when its term runs, each hostile-
// text HOLD with its CLEAR, a SEE IT door on a pause or a hold to what
// tripped it or what it holds, the grant when none stands, and DONE FOR YOU
// beneath. Turning capacity on (grant, resume, renew, clear) answers only at
// this computer's own desk; WITHDRAW answers everywhere.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { withdrawMandate, resumeMandate, renewMandate, clearMandateHold } from '../../../services/mandate-client.js';
import { useMandate } from './use-mandate.js';
import { chipLine, canWithdraw } from './mandate-view.js';
import { MandateGrantForm } from './MandateGrantForm.jsx';
import { DoneForYou } from './DoneForYou.jsx';
import { MandateStanding } from './MandateStanding.jsx';
import { DoorButton } from '../doors/DoorButton.jsx';
import './Mandate.css';

const SEAT_ROW = Object.freeze({ kind: 'marketing', tab: 'seat', reveal: '[data-cmo-row]' });

export const MandatePanel = () => {
  const { view, error, act, refresh } = useMandate();
  const [granting, setGranting] = useState(false);
  const [actError, setActError] = useState(null);
  const head = useRef(null);
  // When the standing changes (granted, paused, withdrawn), its head — and
  // WITHDRAW — comes back into view: the way back stays plainest on screen.
  const standing = view?.standing;
  useEffect(() => { if (standing) head.current?.scrollIntoView?.({ block: 'nearest' }); }, [standing]);
  if (!view) return error ? <p className="settings-err">{error}</p> : null;
  const line = chipLine(view.standing);
  const m = view.mandate;
  const run = (fn) => async () => {
    uiSound('toggle');
    setActError(null);
    try { await act(fn); } catch (err) { setActError(err.message); }
  };
  return (
    <section className="mandate" aria-label="mandate">
      <header className="mandate-head" ref={head} data-tone={line?.tone || 'idle'}>
        <span className="mandate-chip-mark" aria-hidden="true" />
        <b>{line ? line.words : 'NO MANDATE — EVERY ACT ASKS YOU'}</b>
        {canWithdraw(view.standing) ? (
          <span className="mandate-actions">
            <button type="button" className="mandate-withdraw" title="ends it at once: posts not yet sent are cancelled, and the CMO is told plainly" onClick={run(() => withdrawMandate('withdrawn from the MARKETING window'))}>WITHDRAW</button>
            {view.standing === 'paused' ? <button type="button" className="mandate-link" onClick={run(resumeMandate)}>RESUME</button> : null}
            {m?.expiresAt ? <button type="button" className="mandate-link" onClick={run(renewMandate)}>RENEW</button> : null}
          </span>
        ) : view.seat && !granting ? (
          <button type="button" className="mandate-link" onClick={() => { uiSound('open'); setGranting(true); }}>GRANT A MANDATE…</button>
        ) : !view.seat ? (
          // A mandate is the CMO seat's: with no one seated, the next step is the seat — one press to its row.
          <DoorButton door={SEAT_ROW} label="SEAT A CMO" title="a mandate is the CMO seat's — seat a CMO first" />
        ) : null}
      </header>
      {/* Each pause and hold is a door to what tripped it or what it holds (mandate-sources.js): SEE IT. */}
      {view.standing === 'paused' && m?.pause ? (
        <p className="mandate-paused" role="alert">
          <span>PAUSED: {m.pause.reason}</span>
          {view.pauseDoor ? <DoorButton door={view.pauseDoor} label="SEE IT" /> : null}
        </p>
      ) : null}
      {view.holds?.length ? (
        <ul className="mandate-holds" aria-label="held for you">
          {view.holds.map((h) => (
            <li key={h.id} className="mandate-paused" data-hold-id={h.id}>
              <span>HELD: hostile text in {h.origin} — anything drawn from it waits on you.</span>
              {h.door ? <DoorButton door={h.door} label="SEE IT" /> : null}
              <button type="button" className="mandate-link" onClick={run(() => clearMandateHold(h.id))}>CLEAR — I LOOKED</button>
            </li>
          ))}
        </ul>
      ) : null}
      {m && canWithdraw(view.standing) ? <MandateStanding view={view} now={Date.now()} /> : null}
      {actError ? <p className="settings-err" role="alert">{actError}</p> : null}
      {granting && view.seat && !canWithdraw(view.standing)
        ? <MandateGrantForm view={view} act={act} onDone={() => setGranting(false)} /> : null}
      {view.feed.length ? (
        <>
          <p className="mandate-h">DONE FOR YOU</p>
          <DoneForYou rows={view.feed} onChanged={refresh} />
        </>
      ) : null}
    </section>
  );
};
