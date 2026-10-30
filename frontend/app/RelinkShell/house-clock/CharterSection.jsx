// CharterSection — the house charter: read it in plain sentences, approve
// exactly the version on screen, or edit it (saving makes a new version that
// waits for approval again). Pure rendering — the IO lives in the shell
// (HouseClockApp.jsx), the display law in house-clock-view.js. No sound
// imports: the module stays renderable under node.

import { EmptyState } from '../empty-state.jsx';
import { cadenceCapWarning, charterLines, charterStatus, MONEY_OUT, OPTIO_SEAT_NOTE } from './house-clock-view.js';
import { DIAL_STOPS, dialSays } from './involvement-words.js';

const Field = ({ label, hint, children }) => (
  <label className="hclock-field">
    <span className="hclock-field-label label-data">{label}</span>
    {children}
    {hint ? <span className="hclock-field-hint">{hint}</span> : null}
  </label>
);

// The involvement dial: four stops, one lit, what it means beneath — how close
// the operator stands to the house's company work (company line). Every stop
// keeps the floor; the dial changes what is asked, never what is seen.
const DialField = ({ value, busy, onDraft }) => (
  <fieldset className="hclock-seats" data-charter-dial="">
    <legend className="hclock-field-label label-data">YOUR INVOLVEMENT — THE DIAL</legend>
    <div className="hclock-pair" role="radiogroup" aria-label="Your involvement">
      {DIAL_STOPS.map(({ stop }) => (
        <button key={stop} type="button" role="radio" aria-checked={value === stop} disabled={busy}
          className={`hclock-btn label-data${value === stop ? ' is-primary' : ''}`} onClick={() => onDraft('involvement', stop)}>{stop}</button>
      ))}
    </div>
    <p className="hclock-field-hint">{dialSays(value)} Every stop still brings you money out, what only a person can sign, choosing the company, and any incident.</p>
  </fieldset>
);

// The seats: every being of the house, on or off, each with its daily limit —
// and beside the seated Optio's own row, what that office is.
const SeatRows = ({ draft, names, optio, busy, onSeat }) => (
  <fieldset className="hclock-seats">
    <legend className="hclock-field-label label-data">WHO MAY WAKE, AND HOW OFTEN A DAY</legend>
    {Object.keys(draft.seats).length === 0 ? <p className="hclock-muted">This house has no beings yet.</p> : null}
    {Object.entries(draft.seats).map(([laneId, seat]) => (
      <div key={laneId} className="hclock-seat-row">
        <label className="hclock-check">
          <input type="checkbox" checked={seat.on} disabled={busy}
            aria-label={`${names[laneId] || laneId} may wake`}
            onChange={(e) => onSeat(laneId, 'on', e.target.checked)} />
          <span>{names[laneId] || laneId}</span>
        </label>
        <input className="hclock-num" type="number" min="1" max="48" value={seat.cap} disabled={busy || !seat.on}
          aria-label={`${names[laneId] || laneId} wakes a day`}
          onChange={(e) => onSeat(laneId, 'cap', e.target.value)} />
        <span className="hclock-muted">a day</span>
        {laneId === optio ? <p className="hclock-field-hint" data-optio-note="">{OPTIO_SEAT_NOTE}</p> : null}
      </div>
    ))}
  </fieldset>
);

const CharterForm = ({ draft, names, optio, busy, onDraft, onSeat, onSave, onCancel }) => {
  const capWarning = cadenceCapWarning(draft, optio, names);
  return (
    <form className="hclock-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <Field label="GOAL" hint="The house's purpose, in one or two sentences.">
        <textarea className="hclock-input" rows={2} value={draft.goal} disabled={busy}
          onChange={(e) => onDraft('goal', e.target.value)} />
      </Field>
      <Field label="LINES OF WORK" hint="One per line. The Optio may only approve team plans inside these.">
        <textarea className="hclock-input" rows={2} value={draft.linesOfWork} disabled={busy}
          onChange={(e) => onDraft('linesOfWork', e.target.value)} />
      </Field>
      <SeatRows draft={draft} names={names} optio={optio} busy={busy} onSeat={onSeat} />
      <div className="hclock-pair">
        <label className="hclock-check">
          <input type="checkbox" checked={draft.quietOn} disabled={busy} onChange={(e) => onDraft('quietOn', e.target.checked)} />
          <span className="label-data">QUIET HOURS</span>
        </label>
        <input className="hclock-time" type="time" aria-label="Quiet hours start" value={draft.quietStart}
          disabled={busy || !draft.quietOn} onChange={(e) => onDraft('quietStart', e.target.value)} />
        <span className="hclock-muted">to</span>
        <input className="hclock-time" type="time" aria-label="Quiet hours end" value={draft.quietEnd}
          disabled={busy || !draft.quietOn} onChange={(e) => onDraft('quietEnd', e.target.value)} />
        <span className="hclock-muted">— nothing wakes, local time</span>
      </div>
      <div className="hclock-pair">
        <label className="hclock-check">
          <input type="checkbox" checked={draft.cadenceOn} disabled={busy} onChange={(e) => onDraft('cadenceOn', e.target.checked)} />
          <span className="label-data">OPTIO REVIEW EVERY</span>
        </label>
        <input className="hclock-num" type="number" min="1" max="168" aria-label="Optio review every hours" value={draft.cadenceHours}
          disabled={busy || !draft.cadenceOn} onChange={(e) => onDraft('cadenceHours', e.target.value)} />
        <span className="hclock-muted">hours</span>
      </div>
      <div className="hclock-pair">
        <label className="hclock-check">
          <input type="checkbox" checked={draft.teamPlans} disabled={busy} onChange={(e) => onDraft('teamPlans', e.target.checked)} />
          <span className="label-data">THE OPTIO MAY APPROVE TEAM PLANS</span>
        </label>
        <span className="hclock-muted">up to</span>
        <input className="hclock-num" type="number" min="1" max="16" aria-label="Plan members at most" value={draft.maxMembers}
          disabled={busy || !draft.teamPlans} onChange={(e) => onDraft('maxMembers', e.target.value)} />
        <span className="hclock-muted">members and</span>
        <input className="hclock-num" type="number" min="1" max="16" aria-label="Plan steps at most" value={draft.maxSteps}
          disabled={busy || !draft.teamPlans} onChange={(e) => onDraft('maxSteps', e.target.value)} />
        <span className="hclock-muted">steps, a programme of up to</span>
        <input className="hclock-num" type="number" min="2" max="20" aria-label="Programme runs at most" value={draft.maxProgrammeRuns ?? '3'}
          disabled={busy || !draft.teamPlans} onChange={(e) => onDraft('maxProgrammeRuns', e.target.value)} />
        <span className="hclock-muted">runs</span>
      </div>
      <DialField value={draft.involvement} busy={busy} onDraft={onDraft} />
      <Field label="ALLOWED WITHOUT ASKING" hint="Act ids, one per line (e.g. intents/social.post). Money out and file access can never be here.">
        <textarea className="hclock-input label-data" rows={2} value={draft.allow} disabled={busy}
          onChange={(e) => onDraft('allow', e.target.value)} />
      </Field>
      <Field label="ALWAYS COMES TO YOU" hint={`Act ids, one per line. Money out (${MONEY_OUT}) always comes to you, written here or not.`}>
        <textarea className="hclock-input label-data" rows={2} value={draft.escalate} disabled={busy}
          onChange={(e) => onDraft('escalate', e.target.value)} />
      </Field>
      {capWarning ? <p className="hclock-warn label-data" role="status" data-warn="cadence-cap">{capWarning}</p> : null}
      <p className="hclock-muted">Saving makes a new version. Nothing wakes on it until you approve it.</p>
      <div className="hclock-actions">
        <button type="submit" className="hclock-btn is-primary label-data" disabled={busy}>{busy ? 'WORKING…' : 'SAVE'}</button>
        <button type="button" className="hclock-btn label-data" disabled={busy} onClick={onCancel}>CANCEL</button>
      </div>
    </form>
  );
};

/**
 * @param {{charter: ?Object, history: Object[], names: Object<string,string>, draft: ?Object, busy: boolean, optio?: ?string,
 *   onEdit: Function, onDraft: Function, onSeat: Function, onSave: Function, onCancel: Function, onApprove: Function}} p -
 *   optio: the seated Optio's lane (GET /charter readiness)
 */
export const CharterSection = ({ charter, history, names, draft, busy, optio = null, onEdit, onDraft, onSeat, onSave, onCancel, onApprove, approveNote = null }) => {
  if (draft) return <CharterForm draft={draft} names={names} optio={optio} busy={busy} onDraft={onDraft} onSeat={onSeat} onSave={onSave} onCancel={onCancel} />;
  const status = charterStatus(charter);
  // Unread is not "none": no WRITE A CHARTER, no EDIT, until GET /charter has answered.
  const unread = status.key === 'unread';
  return (
    <section className="hclock-sec">
      <p className={`hclock-standing label-data is-${status.key}`}>{status.words}</p>
      <p className="hclock-muted">{status.detail}</p>
      {unread ? null : charter ? (
        <dl className="hclock-lines">
          {charterLines(charter, names).map((l) => (
            <div key={l.label} className="hclock-line">
              <dt className="label-data">{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      ) : <EmptyState title="WRITE A CHARTER TO LET THE HOUSE WAKE ITSELF" />}
      <div className="hclock-actions">
        {status.key === 'pending' ? (
          <button type="button" className="hclock-btn is-primary label-data" data-charter-pending disabled={busy} onClick={() => onApprove(charter.version)}>
            {`APPROVE VERSION ${charter.version}`}
          </button>
        ) : null}
        {status.key === 'pending' && approveNote ? <p className="hclock-muted hclock-approve-note">{approveNote}</p> : null}
        {unread ? null : (
          <button type="button" className="hclock-btn label-data" disabled={busy} onClick={onEdit}>
            {charter ? 'EDIT' : 'WRITE A CHARTER'}
          </button>
        )}
      </div>
      {history?.length ? (
        <p className="hclock-muted">
          {`${history.length} earlier version${history.length === 1 ? '' : 's'} kept: `}
          {history.map((h) => `v${h.version}${h.approvedVersion === h.version ? ' (approved)' : ''}`).join(' · ')}
        </p>
      ) : null}
    </section>
  );
};
