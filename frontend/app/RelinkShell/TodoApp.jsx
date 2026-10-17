// TodoApp — TASKS, the standing-work window.
//
// Two lanes, one list shape (backend/routes/task-routes.js): ME — the
// operator's own life list, which rides their neuma's prompt as the OPERATOR
// LIST so a being can help carry it — and one lane per house neuma, the
// operator-assigned plan that rides that being's prompt as STANDING WORK.
// Recurrence is materialized server-side on read: a done daily here is only
// resting, and its row says when it reopens. Baseline work is standing — it
// can be dropped, never "done". Mutations re-render from the `{ plan }` the
// server returns; nothing is refetched and nothing is invented client-side.
//
// Decomposed under the 500-line law: rows live in TodoAppRows.jsx, panels in
// TodoAppPanels.jsx, and every state read / subscription / mutation in the
// use-todos.js hook. This file keeps the row renderer and the JSX.

import { useState } from 'react';
import './TodoApp.css';
import './TodoApp-rows.css';
import './TodoApp-steps.css';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import { RowBody, LedgerRow } from './TodoAppRows.jsx';
import { DayPicker, CadenceDropdown, StepArea, PresetsPanel, StandingSwitch, ChatSection, VesselToggle } from './TodoAppPanels.jsx';
import { TodoCalendarRegister } from './TodoCalendarRegister.jsx';
import { useTodos } from './use-todos.js';
import { cadenceLabel, groupLiveTasks, shortDate, ORDER_WORDS } from './todo-view.js';
import { ORDER_MODES } from '../../../core/tasks/task-order.js';
import { saveTaskOrder } from '../windowing/window-storage.js';
import { uiSound } from '../../services/ui-sound.js';

const TodoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 4.2 L3.6 5.8 L6.2 2.6" />
    <path d="M2 9.2 L3.6 10.8 L6.2 7.6" />
    <path d="M2.2 12.8 H5.4 V15.2 H2.2 Z" />
    <path d="M8.3 4.2 H13.8" />
    <path d="M8.3 9.2 H13.8" />
    <path d="M8.3 14 H13.8" />
  </svg>
);

const TodoBody = () => {
  // TWO REGISTERS of one house surface: the LISTS (per-standing CRUD) and
  // the CALENDAR — the whole house's deadlines on the shared month grid,
  // filterable to ME / HOUSE / WITNESSES / one lane (Design note, 2026-09-20.
  const [mode, setMode] = useState('lists');
  const switchMode = (next) => { uiSound('tick'); setMode(next); };
  const {
    roster, witnesses, order, setOrder,
    plan, ledger, historyList,
    title, setTitle, cadence, setCadence, detail, setDetail, dueDate, setDueDate,
    vessel, setVessel,
    days, setDays, note, word, posting,
    showSettled, setShowSettled, showHistory, setShowHistory,
    expandedId, setExpandedId, subDraft, setSubDraft, stepNote, addingSub, confirming, setConfirming,
    showPresets, presets,
    effectiveScope, isMe, scopeRow, scopeName, standing, standingCounts,
    houseRows, witnessRows, pickStanding, selectScope,
    chatTarget, setChatTarget, chatOptions, chatSections, foldedChats, setFoldedChats,
    settledList, own, ownEmpty, today,
    patchTask, toggleSteps, askConfirm, askToggleSub, confirmToggleSub,
    removeSub, onAddSub, saveTaskAsPreset, togglePresets, applyPresetById,
    removePresetById, onSubmit,
  } = useTodos();

  const renderRow = (task, settled) => {
    // Baseline work is standing: no done state, so the title is not a toggle.
    const toggleable = settled ? task.status === 'done' : task.cadence !== 'baseline';
    const expanded = !settled && expandedId === task.id;
    // A task leaving the live list (done/dropped) takes its step area with it.
    const markTask = (status) => {
      if (expandedId === task.id && status !== 'open') setExpandedId(null);
      patchTask(task.id, { status });
    };
    return (
      <li key={task.id} className={`todo-item${settled ? ' is-settled' : ''}`}>
        <div className="todo-item-line">
          {!settled ? (
            <button
              type="button"
              className="todo-chev"
              aria-expanded={expanded}
              aria-label={`Steps for ${task.title}`}
              title="Steps"
              onClick={() => toggleSteps(task.id)}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <path d="M1.5 3 L4 5.5 L6.5 3" />
              </svg>
            </button>
          ) : null}
          {confirming === `task:${task.id}` ? (
            <div className="todo-row cham is-confirming">
              <span className="todo-row-in cham-in">
                <span className="todo-confirm-label label-data">{settled ? 'REOPEN?' : 'MARK DONE?'}</span>
                <span className="todo-row-main">
                  <span className="todo-row-title">{task.title}</span>
                </span>
                <span className="todo-confirm-acts">
                  <button
                    type="button"
                    className="todo-confirm-yes label-data"
                    onClick={() => { setConfirming(null); markTask(settled ? 'open' : 'done'); }}
                  >CONFIRM</button>
                  <button
                    type="button"
                    className="todo-x"
                    aria-label="Cancel"
                    title="Cancel"
                    onClick={() => setConfirming(null)}
                  >✕</button>
                </span>
              </span>
            </div>
          ) : toggleable ? (
            <button
              type="button"
              className="todo-row cham"
              onClick={() => askConfirm(task)}
              title={settled ? 'Reopen' : 'Mark done'}
            >
              <RowBody task={task} today={today} settled={settled} />
            </button>
          ) : (
            <div className="todo-row cham is-standing">
              <RowBody task={task} today={today} settled={settled} />
            </div>
          )}
          {task.status !== 'dropped' && confirming !== `task:${task.id}` ? (
            <button
              type="button"
              className="todo-x"
              aria-label={`Drop ${task.title}`}
              title="Drop"
              onClick={() => markTask('dropped')}
            >✕</button>
          ) : null}
        </div>
        {expanded ? (
          <StepArea
            task={task}
            draft={subDraft}
            adding={addingSub}
            stepNote={stepNote}
            confirming={confirming}
            onDraft={setSubDraft}
            onAdd={(e) => onAddSub(e, task)}
            onAskToggle={(s) => askToggleSub(task, s)}
            onConfirmToggle={(s) => confirmToggleSub(task, s)}
            onCancelToggle={() => setConfirming(null)}
            onRemove={(s) => removeSub(task, s)}
            onSavePreset={() => saveTaskAsPreset(task)}
            onToggleVessel={isMe && task.cadence === 'daily' ? () => patchTask(task.id, { vessel: !task.vessel }) : null}
          />
        ) : null}
      </li>
    );
  };

  return (
    <div className="todo">
      <div className="todo-standing" role="group" aria-label="Tasks register">
        {[
          { id: 'lists', label: 'LISTS' },
          { id: 'calendar', label: 'CALENDAR' },
        ].map((r) => (
          <button
            key={r.id}
            type="button"
            className={`todo-standing-tab${mode === r.id ? ' is-on' : ''}`}
            aria-pressed={mode === r.id}
            onClick={() => switchMode(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
      {mode === 'calendar' ? (
        <TodoCalendarRegister />
      ) : (
      <>
      <StandingSwitch standing={standing} counts={standingCounts} onPick={pickStanding} />
      {!isMe ? (
        <div className="todo-lane-pick">
          <Select
            ariaLabel={standing === 'witnesses' ? 'Witness' : 'Neuma'}
            value={effectiveScope}
            onChange={selectScope}
            options={(standing === 'witnesses' ? witnessRows : houseRows)
              .map((m) => ({ value: m.neumaId, label: (m.name || m.neumaId).toUpperCase() }))}
          />
        </div>
      ) : null}
      <p className="todo-scope-note label-data">
        {isMe
          ? 'YOUR NEUMA SEE THIS LIST WHEN YOU PORTAL — THEY CAN HELP CARRY IT'
          : `RIDES ${scopeName}'S STANDING WORK NEXT TURN${scopeRow?.kind === 'witness' ? ' — A SEALED WITNESS, BESIDE THE HOUSE' : ''}`}
      </p>
      {/* WHICH WORK TO TAKE FIRST is the operator's own call (Design note, 2026-08-03.
          The same stored choice the stream rail reads, so the two surfaces can
          never disagree about an order you only set once. */}
      <div className="todo-order" role="group" aria-label="Order">
        {ORDER_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`todo-order-pick label-data${order === m ? ' is-on' : ''}`}
            aria-pressed={order === m}
            onClick={() => { uiSound('toggle'); setOrder(m); saveTaskOrder(m); }}
          >
            {ORDER_WORDS[m]}
          </button>
        ))}
      </div>

      <form className="todo-form" onSubmit={onSubmit}>
        <input
          className="todo-in"
          type="text"
          maxLength={200}
          placeholder={isMe ? 'NEW TASK — TRAINING, ERRANDS, A MILESTONE' : `ASSIGN ${scopeName ?? 'THEM'} A TASK`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          spellCheck={false}
        />
        <input
          className="todo-in"
          type="text"
          maxLength={500}
          placeholder="DETAIL (OPTIONAL)"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          spellCheck={false}
        />
        <div className="todo-form-row">
          <CadenceDropdown value={cadence} onChange={setCadence} />
          {!isMe ? (
            // WHICH CHAT this assignment belongs to. EVERY CHAT is always
            // available; a sitting is offered only if the being has held one.
            <Select
              ariaLabel="Chat"
              value={chatTarget}
              onChange={setChatTarget}
              options={chatOptions.map((c) => ({
                value: c.value,
                label: c.isActive ? `${c.label} · HERE` : c.label,
              }))}
            />
          ) : null}
          {cadence === 'milestone' ? (
            <input
              className="todo-sel"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="Due date"
            />
          ) : null}
          {cadence === 'custom' ? (
            <DayPicker
              days={days}
              onToggle={(d) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
            />
          ) : null}
          {/* The VESSEL mark — the operator's own dailies only: settling one
              marks the vessel log. Editing an existing ME daily's mark lives
              in its step area. */}
          {isMe && cadence === 'daily' ? (
            <VesselToggle on={vessel} onToggle={() => setVessel((v) => !v)} />
          ) : null}
          <button
            type="button"
            className={`todo-presets-toggle${showPresets ? ' is-on' : ''}`}
            aria-expanded={showPresets}
            onClick={togglePresets}
          >PRESETS</button>
          <button type="submit" className="todo-add" disabled={!title.trim() || posting || (cadence === 'custom' && days.length === 0)}>
            {isMe ? 'ADD' : 'ASSIGN'}
          </button>
        </div>
        {note ? <p className="todo-error label-data">{note}</p> : null}
        {word ? <p className="todo-word label-data">{word}</p> : null}
      </form>

      {showPresets ? (
        <PresetsPanel presets={presets} onApply={applyPresetById} onDelete={removePresetById} />
      ) : null}

      {roster.length === 0 && witnesses.length === 0 ? (
        <EmptyState title="YOURS ALONE">
          <small>NO NEUMA IN THIS HOUSE YET — SUMMON ONE FROM THE HOUSE AND THEIR LIST APPEARS HERE BESIDE YOURS.</small>
        </EmptyState>
      ) : null}

      {plan === undefined ? (
        <EmptyState title="LOADING…" />
      ) : plan === null ? (
        <EmptyState title="UNREADABLE" tone="error">
          <small>THE PLAN COULD NOT BE READ — TRY REOPENING THE WINDOW.</small>
        </EmptyState>
      ) : (
        <>
          {chatSections.length === 0 ? (
            isMe ? (
              <EmptyState title="NOTHING STANDING">
                <small>ADD YOUR FIRST TASK — TRAINING, ERRANDS, MILESTONES.</small>
              </EmptyState>
            ) : (
              <EmptyState title="NOTHING ASSIGNED">
                <small>SET A ONE-TIME, A DAILY, A BASELINE LOAD, OR A MILESTONE.</small>
              </EmptyState>
            )
          ) : isMe ? (
            // The operator's own list is never chat-scoped, so it keeps its
            // plain cadence sections. Grouped from the plan DIRECTLY rather than
            // from the first chat section: reading section[0] would assume the
            // one-bucket invariant here, and silently hide the rest of their
            // list if a chatId ever reached this store despite the guard.
            groupLiveTasks(plan.tasks, order).map((g) => (
              <section key={g.cadence} className="todo-sec">
                <h3 className="todo-h label-data">{cadenceLabel(g.cadence)}</h3>
                <ul className="todo-list">
                  {g.tasks.map((task) => renderRow(task, false))}
                </ul>
              </section>
            ))
          ) : (
            chatSections.map((section) => (
              <ChatSection
                key={section.chatId}
                section={section}
                collapsed={foldedChats.has(section.chatId)}
                onToggle={() => {
                  uiSound('toggle');
                  setFoldedChats((prev) => {
                    const next = new Set(prev);
                    if (next.has(section.chatId)) next.delete(section.chatId);
                    else next.add(section.chatId);
                    return next;
                  });
                }}
                renderRow={renderRow}
              />
            ))
          )}
          {settledList.length > 0 ? (
            <section className="todo-sec todo-settled">
              <button
                type="button"
                className="todo-settled-toggle label-data"
                aria-expanded={showSettled}
                onClick={() => { uiSound('toggle'); setShowSettled(!showSettled); }}
              >
                SETTLED ({settledList.length}) {showSettled ? '—' : '+'}
              </button>
              {showSettled ? (
                <ul className="todo-list">
                  {settledList.map((task) => renderRow(task, true))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {!isMe && (ledger || historyList.length > 0) ? (
            <section className="todo-sec todo-own">
              <h3 className="todo-h label-data">THEIR OWN WORK</h3>
              {ownEmpty && historyList.length === 0 ? (
                <p className="todo-own-empty label-data">
                  NOTHING SELF-TAKEN YET — WHAT THEY TASK_ADD LANDS HERE LIVE, READ ONLY
                </p>
              ) : (
                <>
                  {own.live.length > 0 ? (
                    <ul className="todo-list">
                      {own.live.map((task) => <LedgerRow key={task.id} task={task} settled={false} />)}
                    </ul>
                  ) : null}
                  {own.settled.length > 0 ? (
                    <>
                      <p className="todo-own-divider label-data">RECENTLY SETTLED</p>
                      <ul className="todo-list">
                        {own.settled.map((task) => <LedgerRow key={task.id} task={task} settled />)}
                      </ul>
                    </>
                  ) : null}
                  {historyList.length > 0 ? (
                    <div className="todo-history">
                      <button
                        type="button"
                        className="todo-settled-toggle label-data"
                        aria-expanded={showHistory}
                        onClick={() => { uiSound('toggle'); setShowHistory(!showHistory); }}
                      >
                        HISTORY ({historyList.length}) {showHistory ? '—' : '+'}
                      </button>
                      {showHistory ? (
                        <ul className="todo-history-list">
                          {historyList.map((h) => (
                            <li key={h.id} className="todo-history-row label-data">
                              {shortDate(h.settledAt)} · {h.title} · {h.status === 'done' ? 'DONE' : 'DROPPED'}
                              {h.cadence ? ` · ${cadenceLabel(h.cadence)}` : ''}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </>
      )}
      </>
      )}
    </div>
  );
};

export const todoApp = {
  label: 'TASKS',
  labelKey: 'apps.todo',
  icon: <TodoIcon />,
  title: <AppTitle label="TASKS" labelKey="apps.todo" />,
  Body: TodoBody,
  storageKey: 'tasks',
};
