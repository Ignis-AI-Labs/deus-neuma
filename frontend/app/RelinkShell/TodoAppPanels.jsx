// TodoAppPanels — the TASKS window's panels and pickers: the day picker and
// cadence dropdown of the add form, the step area under an expanded row, the
// PRESETS panel, the three-standing switch, and one chat's collapsible
// section. Presentational only; extracted from TodoApp.jsx under the
// 500-line law.

import { Select } from './Select.jsx';
import { cadenceLabel, WEEKDAYS } from './todo-view.js';
import { uiSound } from '../../services/ui-sound.js';
import { useOperatorName } from './use-operator-name.js';

const CADENCES = Object.freeze(['daily', 'weekly', 'biweekly', 'monthly', 'custom', 'once', 'baseline', 'milestone']);

// The operator designs their own rhythm: which weekdays a CUSTOM task runs
// (Mon/Wed/Fri, weekends, any set). Chips in week order starting Monday —
// the calendar most lists think in — while the VALUE keeps getDay() indices
// (0 = Sunday) end to end.
const WEEKDAY_CHIPS = Object.freeze([1, 2, 3, 4, 5, 6, 0]);
export const DayPicker = ({ days, onToggle }) => (
  <div className="todo-days" role="group" aria-label="Days of the week">
    {WEEKDAY_CHIPS.map((d) => (
      <button
        key={d}
        type="button"
        className={`todo-day${days.includes(d) ? ' is-on' : ''}`}
        aria-pressed={days.includes(d)}
        onClick={() => { uiSound('toggle'); onToggle(d); }}
      >
        {WEEKDAYS[d].toUpperCase()}
      </button>
    ))}
  </div>
);

// The VESSEL toggle — a daily on the operator's OWN list that IS one of their
// vessel dailies: settling it marks the vessel log (the dailies bridge). A
// hairline chip in the weekday-pick idiom; SIGNAL marks the on state.
export const VesselToggle = ({ on, onToggle }) => (
  <button
    type="button"
    className={`todo-vessel-toggle label-data${on ? ' is-on' : ''}`}
    aria-pressed={on}
    title="A vessel daily — settling it marks your vessel log"
    onClick={() => { uiSound('toggle'); onToggle(); }}
  >
    VESSEL
  </button>
);

// The cadence picker is the shared LINE & CYCLE Select — never a native
// <select> (the OS paints its open panel and it cannot be styled).
export const CadenceDropdown = ({ value, onChange }) => (
  <Select
    ariaLabel="Cadence"
    value={value}
    onChange={onChange}
    options={CADENCES.map((c) => ({ value: c, label: cadenceLabel(c) }))}
  />
);

// The step area under an expanded row — the task's checklist, subordinate to
// its parent card. Checking a step done OR reopening one both ask first —
// list state only ever changes on purpose. The inline form appends; SAVE AS
// PRESET lifts the whole task, steps included, into a reusable bundle. A
// daily on the ME lane also carries its VESSEL toggle here (the edit surface).
export const StepArea = ({ task, draft, adding, stepNote, confirming, onDraft, onAdd, onAskToggle, onConfirmToggle, onCancelToggle, onRemove, onSavePreset, onToggleVessel = null }) => (
  <div className="todo-sub cham">
    <div className="todo-sub-in cham-in">
      {(task.subtasks || []).length > 0 ? (
        <ul className="todo-sub-list">
          {task.subtasks.map((s) => (
            <li key={s.id} className={`todo-sub-item${s.status === 'done' ? ' is-done' : ''}`}>
              {confirming === `sub:${task.id}:${s.id}` ? (
                <div className="todo-sub-confirm">
                  <span className="todo-confirm-label label-data">{s.status === 'done' ? 'REOPEN?' : 'DONE?'}</span>
                  <span className="todo-sub-title">{s.title}</span>
                  <button
                    type="button"
                    className="todo-confirm-yes label-data"
                    onClick={() => onConfirmToggle(s)}
                  >CONFIRM</button>
                  <button
                    type="button"
                    className="todo-x"
                    aria-label="Cancel"
                    title="Cancel"
                    onClick={onCancelToggle}
                  >✕</button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="todo-sub-row"
                    onClick={() => onAskToggle(s)}
                    title={s.status === 'done' ? 'Reopen' : 'Mark done'}
                  >
                    <span className="todo-sub-title">{s.title}</span>
                  </button>
                  <button
                    type="button"
                    className="todo-x"
                    aria-label={`Remove ${s.title}`}
                    title="Remove"
                    onClick={() => onRemove(s)}
                  >✕</button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <form className="todo-sub-form" onSubmit={onAdd}>
        <input
          className="todo-in todo-sub-field"
          type="text"
          maxLength={200}
          placeholder="ADD A STEP"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          spellCheck={false}
        />
        <button type="submit" className="todo-sub-add" disabled={!draft.trim() || adding}>ADD</button>
      </form>
      {stepNote ? <p className="todo-error label-data">{stepNote}</p> : null}
      {onToggleVessel ? (
        <VesselToggle on={task.vessel === true} onToggle={onToggleVessel} />
      ) : null}
      <button type="button" className="todo-sub-preset label-data" onClick={onSavePreset}>
        SAVE AS PRESET
      </button>
    </div>
  </div>
);

// One preset's quiet meta line: the count plus the cadence all its tasks
// share (MIXED when they disagree).
const presetMeta = (preset) => {
  const tasks = Array.isArray(preset?.tasks) ? preset.tasks : [];
  const cadences = new Set(tasks.map((t) => t.cadence));
  const cadence = cadences.size === 1 ? cadenceLabel(tasks[0].cadence) : 'MIXED';
  return `${tasks.length} TASK${tasks.length === 1 ? '' : 'S'} · ${cadence}`;
};

// The PRESETS panel — the built-in catalog, then the wallet's own bundles.
// APPLY instantiates into the lane currently on screen; customs alone carry
// a delete (built-ins are eternal — the backend 404s the ask, so no control
// is offered).
export const PresetsPanel = ({ presets, onApply, onDelete }) => {
  const renderPart = (label, list, deletable) => (
    <div className="todo-presets-part">
      <p className="todo-presets-h label-data">{label}</p>
      {list.length > 0 ? (
        <ul className="todo-presets-list">
          {list.map((p) => (
            <li key={p.id} className="todo-preset">
              <span className="todo-preset-main">
                <span className="todo-preset-name">{p.name}</span>
                <span className="todo-preset-meta label-data">{presetMeta(p)}</span>
              </span>
              <button type="button" className="todo-preset-apply" onClick={() => onApply(p.id)}>APPLY</button>
              {deletable ? (
                <button
                  type="button"
                  className="todo-x"
                  aria-label={`Delete ${p.name}`}
                  title="Delete"
                  onClick={() => onDelete(p.id)}
                >✕</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : deletable ? (
        <p className="todo-presets-empty label-data">SAVE YOUR OWN FROM ANY TASK'S STEPS</p>
      ) : null}
    </div>
  );
  return (
    <div className="todo-presets cham">
      <div className="todo-presets-in cham-in">
        {presets === null ? (
          <p className="todo-presets-h label-data">LOADING…</p>
        ) : (
          <>
            {renderPart('BUILT-IN', presets.builtins, false)}
            {renderPart('YOURS', presets.customs, true)}
          </>
        )}
      </div>
    </div>
  );
};

// The standing switch. THREE STANDINGS, not one wall of chips: a neuma lives in
// the house, a sealed witness stands BESIDE it (docs/protocols/sovereignty-boundary.md),
// and ME is the operator's own life. Sixteen undifferentiated chips said none of
// that and wrapped into three rows (Design note, 2026-08-01, on the screenshot: […]). This costs two lines
// no matter how large the house grows.
export const StandingSwitch = ({ standing, counts, onPick }) => {
  const operatorName = useOperatorName();
  return (
  <nav className="todo-standing" aria-label="Task list standing">
    {[
      { id: 'house', label: 'HOUSE' },
      { id: 'witnesses', label: 'WITNESSES' },
      { id: 'me', label: operatorName },
    ].map((s) => (
      <button
        key={s.id}
        type="button"
        className={`todo-standing-tab${standing === s.id ? ' is-on' : ''}${s.id === 'witnesses' ? ' is-witness' : ''}`}
        aria-pressed={standing === s.id}
        disabled={counts[s.id] === 0}
        title={s.id === 'witnesses' ? 'Sealed peers from outside — they stand beside the house, never in it' : undefined}
        onClick={() => onPick(s.id)}
      >
        {s.label}
        {counts[s.id] > 0 && s.id !== 'me' ? (
          <span className="todo-standing-n label-data">{counts[s.id]}</span>
        ) : null}
      </button>
    ))}
  </nav>
  );
};

// One chat's block: its name, how much is live in it, and its cadence groups
// inside. Collapsible, because a being with six parallel sittings should not
// have to scroll past five to reach the one it is in.
export const ChatSection = ({ section, collapsed, onToggle, renderRow }) => (
  <section className={`todo-chat${section.isLaneWide ? ' is-lane' : ''}${section.isActive ? ' is-active' : ''}`}>
    <button
      type="button"
      className="todo-chat-head"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <span className="todo-chat-caret" aria-hidden="true">{collapsed ? '+' : '—'}</span>
      <span className="todo-chat-name">{section.label}</span>
      {section.isActive ? <span className="todo-chat-here label-data">IN THIS CHAT</span> : null}
      <span className="todo-chat-live label-data">{section.live} LIVE</span>
    </button>
    {collapsed ? null : section.groups.map((g) => (
      <div key={g.cadence} className="todo-chat-group">
        <h4 className="todo-h label-data">{cadenceLabel(g.cadence)}</h4>
        <ul className="todo-list">{g.tasks.map((task) => renderRow(task, false))}</ul>
      </div>
    ))}
  </section>
);
