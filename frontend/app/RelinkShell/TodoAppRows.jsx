// TodoAppRows — the row bodies of the TASKS window: the operator-assigned
// row (RowBody) and the being's own self-taken ledger row (LedgerRow), plus
// the ledger's state mark. Presentational only; extracted from TodoApp.jsx
// under the 500-line law.

import {
  cadenceLabel, isOverdue, resetHint, customDaysLabel, ledgerKind, shortDate, subtaskProgress, timeLabel,
} from './todo-view.js';
import { sizeLabel } from '../../../core/tasks/task-order.js';

// One row's body — title (voice), optional detail (dimmer), and the mono
// metadata the cadence honestly has: a live row's step progress (OPEN/TOTAL,
// only when the task HAS steps), a milestone's due date (ALERT when late),
// a baseline's STANDING tag, a settled row's cadence · status · hint.
export const RowBody = ({ task, today, settled }) => {
  const late = isOverdue(task, today);
  const hint = settled ? resetHint(task) : null;
  const progress = settled ? { open: 0, total: 0 } : subtaskProgress(task);
  const meta = settled ? (
    <span className="todo-row-meta label-data">
      {cadenceLabel(task.cadence)} · {task.status === 'done' ? 'DONE' : 'DROPPED'}
      {hint ? ` · ${hint}` : ''}
    </span>
  ) : task.cadence === 'milestone' && task.dueDate ? (
    <span className={`todo-row-due label-data${late ? ' is-late' : ''}`}>DUE {task.dueDate}</span>
  ) : task.cadence === 'baseline' ? (
    <span className="todo-row-tag label-data">STANDING</span>
  ) : task.cadence === 'custom' && customDaysLabel(task) ? (
    <span className="todo-row-tag label-data">{customDaysLabel(task)}</span>
  ) : null;
  return (
    <span className="todo-row-in cham-in">
      <span className="todo-row-main">
        <span className="todo-row-title">{task.title}</span>
        {task.detail ? <span className="todo-row-detail">{task.detail}</span> : null}
      </span>
      {progress.total > 0 || meta || sizeLabel(task) || task.vessel || (!settled && timeLabel(task)) ? (
        <span className="todo-row-side">
          {!settled && timeLabel(task) ? <span className="todo-row-tag label-data">{timeLabel(task)}</span> : null}
          {progress.total > 0 ? (
            <span className="todo-row-progress label-data">{progress.open}/{progress.total}</span>
          ) : null}
          {/* The sort key, SHOWN — ordering by a size the row never displays
              leaves the operator reading a list they cannot account for. */}
          {sizeLabel(task) ? <span className="todo-row-tag label-data">{sizeLabel(task)}</span> : null}
          {/* A VESSEL daily — settling it marks the operator's vessel log. */}
          {task.vessel === true ? <span className="todo-row-tag label-data">VESSEL</span> : null}
          {meta}
        </span>
      ) : null}
    </span>
  );
};

// The ledger's state mark — a small hairline box: empty for live work, a
// check for done, an ✕ for dropped. A MARK, not a control: the operator never
// settles another's self-authorship, so it carries no click and no SIGNAL
// (settled truth stays in the dimmed register; SIGNAL is ACTIVE's alone).
const LedgerCheck = ({ status }) => (
  <span className="todo-led-check" aria-hidden="true">
    {status === 'done' ? '✓' : status === 'dropped' ? '✕' : ''}
  </span>
);

// One of the being's own self-taken tasks — read-only: self-authorship is
// theirs, never the operator's to settle.
//
// PARITY WITH THE STREAM RAIL (ruling, 2026-08-03). This row used to read the raw
// status while the rail read derived state, so the same task described itself
// two different ways depending on which surface you happened to be looking at.
// It now speaks the one vocabulary: WORKING NOW, INTERRUPTED, the size, the act
// count, and what it is still waiting on.
export const LedgerRow = ({ task, settled, landed = false }) => (
  <li className={`todo-item${settled ? ' is-settled' : ''}${task.blockers?.length ? ' is-blocked' : ''}${landed ? ' is-landed' : ''}`}>
    <div className="todo-row cham is-standing">
      <span className="todo-row-in cham-in">
        <LedgerCheck status={task.status} />
        <span className="todo-row-main">
          <span className="todo-row-title">{task.title}</span>
          {task.detail ? <span className="todo-row-detail">{task.detail}</span> : null}
          {/* The blocker by NAME, under the title where there is room for it —
              […] answered on the row itself. */}
          {!settled && task.blockers?.length > 0 ? (
            <span className="todo-row-detail is-blocked">
              WAITING ON {task.blockers.map((b) => b.title).join(', ')}
            </span>
          ) : null}
        </span>
        <span className="todo-row-side">
          {!settled && task.state === 'in-progress' ? (
            <span className="todo-row-tag label-data is-active">WORKING NOW</span>
          ) : !settled && task.state === 'interrupted' ? (
            // The crash case, said out loud in the window too — an interrupted
            // task that reads like an untouched one gets redone from the start.
            <span className="todo-row-tag label-data is-warn">INTERRUPTED</span>
          ) : null}
          {task.work ? (
            <span className="todo-row-meta label-data">
              {task.work.count} ACT{task.work.count === 1 ? '' : 'S'}
            </span>
          ) : null}
          {task.size ? <span className="todo-row-tag label-data">{task.size}</span> : null}
          <span className="todo-row-tag label-data">{cadenceLabel(ledgerKind(task))}</span>
          {settled ? (
            <>
              <span className="todo-row-tag label-data">{task.status === 'done' ? 'DONE' : 'DROPPED'}</span>
              <span className="todo-row-meta label-data">{shortDate(task.completedAt || task.updatedAt)}</span>
            </>
          ) : null}
        </span>
      </span>
    </div>
  </li>
);
