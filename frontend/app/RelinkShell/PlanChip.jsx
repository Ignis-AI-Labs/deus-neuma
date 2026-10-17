// PlanChip — a being's team plan, put before its operator for the verdict.
//
// Renders a plan segment from the stream-reducer. Pending: the goal, every
// step with its owner / role / dependencies / done-criteria, and the two
// verdicts — APPROVE, or REVISE with notes (the notes ride back to the
// being as the correction). Resolved: what was decided. The card flips only
// when the portal echoes operator:plan_resolved (server truth), matching
// ApprovalChip and AskChip.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import '../../components/ToolActionChip/ToolActionChip.css';

const SETTLED_LABELS = Object.freeze({
  approve: 'APPROVED',
  revise: 'REVISIONS ASKED',
  accept_default: 'ACCEPTED — RUNS UNDER DEFAULT',
  accept_auto: 'ACCEPTED — RUNS UNDER AUTO',
  adjust: 'ADJUSTMENTS ASKED',
  deny: 'DENIED',
  timeout: 'NOT ANSWERED — TIMED OUT',
  interrupted: 'NOT ANSWERED — TURN INTERRUPTED',
  closed: 'NOT ANSWERED — PORTAL CLOSED',
  expired: 'NOT ANSWERED',
});

// The plan's full body — goal, workspace grant, and the position map. One
// shape for both lives of the card: the pending ask and the settled record
// (an operator re-reading history sees exactly what they approved).
// pure — the eye's cadence, as the card says it.
const checkInWords = (minutes) => {
  if (minutes === 0) return 'NO CHECK-INS';
  const m = Number.isFinite(minutes) ? minutes : 60;
  return `CHECK-IN EVERY ${m % 60 ? `${m}M` : `${m / 60}H`}`;
};

const PlanBody = ({ goal, workspace, steps, team = false, clock = '', concurrency = null, checkIn = null }) => (
  <>
    <p className="plan-chip-goal">{goal}</p>
    {workspace ? (
      // What a yes grants, spatially: the ONE directory the team may
      // touch and the space it may fill. Named before the verdict.
      <p className="plan-chip-workspace label-data">
        WORKSPACE {workspace.root} · {Math.round((workspace.budgetBytes || 0) / (1024 * 1024))}MB BUDGET — ALL FILE WORK CONFINED HERE
      </p>
    ) : team ? (
      // A team plan that names no directory still works inside one: the run
      // makes a fresh arena (data/team-arenas/) — said BEFORE the yes.
      <p className="plan-chip-workspace label-data">
        WORKSPACE A FRESH ARENA FOR THIS RUN (MADE AT START) · 512MB BUDGET — ALL FILE WORK CONFINED HERE
      </p>
    ) : null}
    {team && clock ? (
      // How long, and how wide — said BEFORE the yes (#577): a clock counts
      // working time only; with none, the team works until done or stopped.
      <p className="plan-chip-workspace label-data">
        CLOCK {clock.toUpperCase()} · {concurrency ? `${concurrency} PART${concurrency === 1 ? '' : 'S'} AT ONCE` : 'AS MANY AT ONCE AS THE RIG ALLOWS'} · {checkInWords(checkIn)}
      </p>
    ) : null}
    <ol className="plan-chip-steps">
      {steps.map((s) => (
        <li key={s.id} className="plan-chip-step">
          <div className="plan-chip-step-head">
            <span className="plan-chip-step-id">{s.id}</span>
            <span className="plan-chip-step-member">{s.member}</span>
            {s.role ? <span className="plan-chip-step-role">{s.role}</span> : null}
            {s.needs?.length > 0 ? (
              <span className="plan-chip-step-needs">AFTER {s.needs.join(', ')}</span>
            ) : null}
          </div>
          <div className="plan-chip-step-task">{s.task}</div>
          {s.done ? <div className="plan-chip-step-done">DONE WHEN: {s.done}</div> : null}
          {/* Deliverables the platform checks on disk before the step counts as done. */}
          {s.files?.length ? <div className="plan-chip-step-done">DELIVERS: {s.files.join(', ')}</div> : null}
          {s.clock ? <div className="plan-chip-step-done">ITS OWN CLOCK: {s.clock}</div> : null}
        </li>
      ))}
    </ol>
  </>
);

export const PlanChip = ({ segment, onRespond }) => {
  const { id, phase, name, goal, steps, workspace, status, notes, planKind, detail, clock = '', concurrency = null, checkIn = null } = segment;
  const [noting, setNoting] = useState(false); // the ADJUST/REVISE notes line is open
  const [text, setText] = useState('');
  // One verdict per plan — the buttons arm once, then wait for the echo.
  const [sent, setSent] = useState(false);
  // A settled plan stays readable: the operator reopens the record from the
  // stream's history to see the goal, positions, and workspace as approved.
  const [open, setOpen] = useState(false);

  if (phase === 'pending') {
    const chatPlan = planKind === 'chat';
    const rule = (decision, words) => {
      if (sent) return;
      setSent(true);
      uiSound(decision === 'deny' ? 'deny' : 'activate');
      onRespond(id, decision, words?.trim() || '');
    };
    return (
      <div className="tool-chip plan-chip pending">
        <div className="tool-chip-head">
          <span className="tool-chip-tag">{chatPlan ? 'PLAN FOR VERDICT' : 'PLAN FOR APPROVAL'}</span>
          {name ? <span className="tool-chip-name">{name}</span> : null}
        </div>
        <PlanBody goal={goal} workspace={workspace} steps={steps} team={!chatPlan} clock={clock} concurrency={concurrency} checkIn={checkIn} />
        {detail ? <p className="plan-chip-detail">{detail}</p> : null}
        {noting ? (
          <form className="plan-chip-notes" onSubmit={(e) => { e.preventDefault(); rule(chatPlan ? 'adjust' : 'revise', text); }}>
            <input
              type="text"
              value={text}
              disabled={sent}
              placeholder="What should change…"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" disabled={sent}>{chatPlan ? 'SEND ADJUSTMENTS' : 'SEND REVISIONS'}</button>
          </form>
        ) : chatPlan ? (
          // THE CHAT VERDICTS (PLAN MODE): accept and choose the bearing it
          // runs under, adjust with notes, or deny outright — the same flow
          // every harness's planning mode carries.
          <div className="approval-actions">
            <button type="button" disabled={sent} onClick={() => rule('accept_default')}>ACCEPT → DEFAULT</button>
            <button type="button" disabled={sent} onClick={() => rule('accept_auto')}>ACCEPT → AUTO</button>
            <button
              type="button"
              disabled={sent}
              onClick={() => { uiSound('tick'); setNoting(true); }}
            >ADJUST…</button>
            <button type="button" disabled={sent} className="approval-deny" onClick={() => rule('deny')}>DENY</button>
          </div>
        ) : (
          <div className="approval-actions">
            <button type="button" disabled={sent} onClick={() => rule('approve')}>APPROVE</button>
            <button
              type="button"
              disabled={sent}
              className="approval-deny"
              onClick={() => { uiSound('tick'); setNoting(true); }}
            >REVISE…</button>
          </div>
        )}
      </div>
    );
  }

  const approved = ['approve', 'accept_default', 'accept_auto'].includes(status);
  return (
    <div className={`tool-chip resolved plan-chip ${approved ? 'ok' : 'failed'}`}>
      <div className="tool-chip-head">
        <span className="tool-chip-sigil">⟐</span>
        <span className="tool-chip-summary">
          PLAN {name ? `${name} ` : ''}— {SETTLED_LABELS[status] || 'SETTLED'}
          {(status === 'revise' || status === 'adjust') && notes ? `: ${notes}` : ''}
        </span>
        {steps?.length > 0 ? (
          <button
            type="button"
            className="tool-chip-toggle"
            aria-label="Show the plan as it was decided"
            onClick={() => { uiSound('toggle'); setOpen((v) => !v); }}
          >
            {open ? '−' : '+'}
          </button>
        ) : null}
      </div>
      {open ? <PlanBody goal={goal} workspace={workspace} steps={steps} team={planKind !== 'chat'} clock={clock} concurrency={concurrency} checkIn={checkIn} /> : null}
    </div>
  );
};
