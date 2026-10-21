// StreamTasks — the stream's own task rail, pinned right, collapsible.
//
// The Explorer's idiom moved inside the conversation (Design note, 2026-07-27: […]). It answers, without leaving the stream,
// what the being in front of you is carrying:
//
//   NOW            what THEY took on and are actively working — watched, not
//                  settled here: their own ledger is theirs.
//   STANDING WORK  what YOU assigned, by cadence — settle a row right here.
//   ALL BEINGS     who else has live work, and how much. A name opens the TASKS
//                  window on that being's tab; the rail stays narrow.
//
// Adding and editing stay in the TASKS window (Founder's call): one editor, one
// store. Collapsed, the rail thins to a spine that still says how much is live,
// so collapsing never hides the fact that work exists.

import { useCallback, useEffect, useState } from 'react';
import './StreamTasks.css';
import { useConsciousness } from './consciousness-context.js';
import { useWindows } from '../windowing/use-windows.js';
import { fetchNeumaTasks, updateNeumaTask, fetchLiveCounts } from './todo-client.js';
import { railState, stepsLabel } from './stream-tasks-view.js';
import { requestTaskFocus } from './task-focus.js';
import { cadenceLabel, ORDER_WORDS } from './todo-view.js';
import { getRoster, getWitnesses } from '../../utils/companion-data.js';
import { isHarness } from '../harness-mode.js';
import { useSettled } from './use-settled.js';
import { loadTaskOrder, saveTaskOrder, TASK_ORDER_EVENT } from '../windowing/window-storage.js';
import { setOpenRail } from './stream-rail-state.js';
import { useRailItem } from './StreamRail.jsx';
import { RailGlyph } from './RailGlyph.jsx';
import { ORDER_MODES, sizeLabel, orderMode } from '../../../core/tasks/task-order.js';
import { uiSound } from '../../services/ui-sound.js';

// Is a turn LIVE right now? The same reading ChatApp uses for its own busy
// state — the being is thinking, or a message is still streaming in. This is
// what separates WORKING NOW from INTERRUPTED: a live turn is still appending
// to its focused task, so silence is the evidence that it stopped.
const _isLiveTurn = (state) =>
  Boolean(state?.thinking) || (state?.messages || []).some((m) => m?.streaming);

// How the operator wants to take work on. A CYCLE, not a dropdown: three
// choices in a rail this narrow is one tap each way, and the label always says
// which one is standing rather than hiding it behind a closed panel.
const nextOrder = (mode) => ORDER_MODES[(ORDER_MODES.indexOf(mode) + 1) % ORDER_MODES.length];

export const StreamTasks = () => {
  const { activeCompanion, wsService, state } = useConsciousness() || {};
  const windows = useWindows();
  const beingId = activeCompanion?.neumaId || null;

  // This rail no longer wears its own spine, and no longer tracks the open rail
  // itself. It publishes a BUTTON to the one shared strip (StreamRail) and draws
  // only its panel — which is what lets the strip stay reachable while a panel
  // is open, so another rail is one tap away instead of requiring this one to be
  // folded first (ruling, 2026-08-25).
  //
  // Exclusivity is unchanged and still belongs to stream-rail-state.js; the
  // strip subscribes once on everyone's behalf rather than each rail keeping a
  // duplicate copy of the same value.

  // How you like to take work on is YOURS, not this rail's — the same stored
  // choice the TASKS window reads, so the two surfaces can never disagree
  // about the order you asked for.
  const [order, setOrder] = useState(loadTaskOrder);
  const cycleOrder = useCallback(() => {
    uiSound('toggle');
    setOrder((m) => { const next = nextOrder(m); saveTaskOrder(next); return next; });
  }, []);
  // The TASKS window writes the same stored choice, so the rail follows it the
  // moment it changes. Without this the two lists sort differently until a
  // reload — one choice, two answers.
  useEffect(() => {
    const onOrder = (e) => setOrder(orderMode(e?.detail));
    window.addEventListener(TASK_ORDER_EVENT, onOrder);
    return () => window.removeEventListener(TASK_ORDER_EVENT, onOrder);
  }, []);

  const [plan, setPlan] = useState(undefined); // undefined = loading, null = unreadable
  const [ledger, setLedger] = useState(null);
  const [note, setNote] = useState('');
  // The house's other live work — counted only when the operator asks for it,
  // because it costs one read per being.
  const [counts, setCounts] = useState([]);
  const [showOthers, setShowOthers] = useState(false);
  const [settling, setSettling] = useState(null); // taskId mid-write
  // The closed-off goals fold away: they are a receipt that the list is being
  // worked down, not something to read every turn.
  const [showDone, setShowDone] = useState(false);
  // THE CHAT IN FRONT OF YOU. The rail narrows to it exactly as the being's own
  // prompt does, so what the operator reads here is what the being is reading.
  // The socket owns the binding and announces every change (resume, new chat,
  // being switch), so the rail follows rather than guessing.
  const [chatId, setChatId] = useState(() => wsService?.getSessionState?.()?.sessionId ?? null);
  useSettled(() => {
    if (!wsService) return undefined;
    setChatId(wsService.getSessionState?.()?.sessionId ?? null);
    const onState = (state) => setChatId(state?.sessionId ?? null);
    wsService.on('session:state', onState);
    return () => wsService.off('session:state', onState);
  }, [wsService]);

  const load = useCallback((settled) => {
    if (!beingId) { setPlan(undefined); setLedger(null); return; }
    fetchNeumaTasks(beingId)
      .then((body) => {
        if (settled?.()) return;
        setPlan(body?.plan ?? null);
        setLedger(body?.ledger ?? null);
      })
      .catch(() => { if (!settled?.()) { setPlan(null); setLedger(null); } });
  }, [beingId]);

  useSettled((settled) => { load(settled); }, [beingId]);

  // Live: a being's own task work rides tool:usage frames. When THIS being
  // finishes a tasks/* op — or settles a tasks/* INTENT (Stage 3 batch 4: the
  // mutations file now, and the sweep's chips read intents/tasks.*) — the
  // rail refetches, so NOW moves as they work.
  // Ambient — no sound, no note; a failed refresh keeps the last honest truth.
  useSettled((settled) => {
    if (!wsService || !beingId) return undefined;
    let timer = null;
    const onTool = (frame) => {
      if (frame?.status !== 'ok' || typeof frame?.tool !== 'string') return;
      const name = frame.tool;
      if (!(name.startsWith('tasks/') || name.startsWith('intents/tasks.')) || frame.neumaId !== beingId) return;
      clearTimeout(timer);                       // a turn fires 2–3 ops; one refetch covers the burst
      timer = setTimeout(() => load(settled), 200);
    };
    wsService.on('tool:usage', onTool);
    return () => { clearTimeout(timer); wsService.off('tool:usage', onTool); };
  }, [wsService, beingId, load]);

  // `streaming` is what separates WORKING NOW from INTERRUPTED: a live turn is
  // still writing to its focused task, silence is the evidence it stopped.
  const bar = railState({ being: activeCompanion, plan, ledger, counts, chatId, streaming: _isLiveTurn(state), order });
  // Registered BEFORE the early return, and with bar.show passed through: a
  // rail that has nothing to show must withdraw its button rather than leave a
  // live one on the strip that opens an empty panel. Hooks may not sit behind
  // a return, and this one carries the reason it must not.
  const isOpen = useRailItem('tasks', {
    label: 'TASKS', badge: bar.live, show: bar.show, title: `${bar.title} — ${bar.live} live`,
  });
  if (!bar.show) return null;

  // Every other being's live count in ONE read. The names come from the cached
  // roster (the server counts, the desk names), so a being whose display name
  // the operator knows is never reduced to a lane id.
  const openOthers = async () => {
    uiSound('open');
    setShowOthers(true);
    if (counts.length) return;
    const named = new Map([...getRoster(), ...getWitnesses()]
      .filter((m) => m?.neumaId)
      .map((m) => [m.neumaId, m.name]));
    try {
      const { counts: live } = await fetchLiveCounts();
      setCounts((live || []).map((c) => ({
        neumaId: c.beingId,
        name: named.get(c.beingId) || c.name || c.beingId,
        kind: c.kind,
        count: c.open,
      })));
    } catch (err) {
      setNote(err?.message || 'The other beings could not be counted.');
      setShowOthers(false);
    }
  };

  // Settling is a real act on the operator's own list: the row reports the
  // server's own correction rather than a swallowed failure.
  const settle = async (taskId, status) => {
    uiSound(status === 'done' ? 'activate' : 'deny');
    setSettling(taskId);
    setNote('');
    try {
      const body = await updateNeumaTask(beingId, taskId, { status });
      setPlan(body?.plan ?? null);
    } catch (err) {
      setNote(err?.message || 'The task did not change.');
    } finally {
      setSettling(null);
    }
  };

  // The editor opens ON the being that was clicked. The window mounts after the
  // OPEN dispatch, so the scope is LATCHED (task-focus) rather than fired into a
  // listener that does not exist yet — the same reason Settings' deep links latch.
  const openTasksWindow = (id) => {
    uiSound('activate');
    if (id) requestTaskFocus(id);
    windows?.dispatch?.({ type: 'OPEN', id: 'todo' });
    if (id) setShowOthers(false);
  };

  // Folded is now NOTHING, not a spine — the strip carries this rail's button
  // whether it is open or shut, so drawing a second one here would put TASKS on
  // screen twice.
  if (!isOpen) return null;

  return (
    <aside className="stream-tasks cham" aria-label="Tasks">
      <div className="stream-tasks-in cham-in">
        <header className="stream-tasks-head">
          <span className="stream-tasks-title label-data">{bar.title}</span>
          <button
            type="button"
            className={`stream-tasks-order label-data${order === 'mine' ? '' : ' is-on'}`}
            onClick={cycleOrder}
            title="Take work on heaviest first, lightest first, or in the list's own order"
          >
            {ORDER_WORDS[order]}
          </button>
          <button
            type="button"
            className="stream-tasks-fold"
            onClick={() => { uiSound('close'); setOpenRail(null); }}
            title="Fold the rail away"
            aria-expanded
          >
            <RailGlyph open />
          </button>
        </header>

        {bar.loading ? (
          <p className="stream-tasks-empty label-data">READING…</p>
        ) : bar.unreadable ? (
          <p className="stream-tasks-empty is-warn label-data">THE PLAN COULD NOT BE READ</p>
        ) : (
          <>
            {bar.own.length > 0 ? (
              <section className="stream-tasks-sec">
                <h4 className="stream-tasks-h label-data">THEIR OWN GOALS</h4>
                <ul className="stream-tasks-list">
                  {bar.own.map((t) => (
                    // A MARK, not a control (ruling, 2026-08-03): the box says where
                    // this goal stands; settling a being's own task still goes
                    // through the being. So the row reads, and offers no act the
                    // operator does not own.
                    <li key={t.id} className={`stream-tasks-row is-theirs is-${t.state}${t.blockers?.length ? ' is-blocked' : ''}`}>
                      <span className="stream-tasks-box" aria-hidden="true">
                        {t.checked ? '✓' : ''}
                      </span>
                      <span className="stream-tasks-text">
                        {t.title}
                        {t.size ? (
                          <span className="stream-tasks-size label-data"> {t.size}</span>
                        ) : null}
                        {t.state === 'in-progress' ? (
                          <span className="stream-tasks-state is-now label-data"> WORKING NOW</span>
                        ) : t.state === 'interrupted' ? (
                          // The crash case, said out loud — an interrupted task
                          // that reads like an untouched one gets redone.
                          <span className="stream-tasks-state is-warn label-data"> INTERRUPTED</span>
                        ) : null}
                        {t.done ? (
                          <span className="stream-tasks-steps label-data"> {t.done.count} ACT{t.done.count === 1 ? '' : 'S'}</span>
                        ) : null}
                        {/* BOTH, when both hold: how far it got and that it can
                            go no further. Naming the blocker turns […] into an answer on the row. */}
                        {t.blockers?.length > 0 ? (
                          <span className="stream-tasks-blocked label-data">
                            {' '}WAITING ON {t.blockers.map((b) => b.title).join(', ')}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {bar.settled.length > 0 ? (
              <section className="stream-tasks-sec">
                <button
                  type="button"
                  className="stream-tasks-others-h label-data"
                  aria-expanded={showDone}
                  onClick={() => { uiSound('toggle'); setShowDone((v) => !v); }}
                >
                  — CLOSED ({bar.settled.length}) {showDone ? '−' : '+'}
                </button>
                {showDone ? (
                  <ul className="stream-tasks-list">
                    {bar.settled.map((t) => (
                      <li key={t.id} className="stream-tasks-row is-theirs is-done">
                        <span className="stream-tasks-box" aria-hidden="true">✓</span>
                        <span className="stream-tasks-text">{t.title}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {bar.groups.length === 0 ? (
              // Narrowed, the empty state must say WHERE it is empty — "nothing
              // assigned" would read as a claim about the whole being when the
              // rail is only looking at one conversation.
              <p className="stream-tasks-empty label-data">
                {chatId ? 'NOTHING ASSIGNED IN THIS CHAT' : 'NOTHING ASSIGNED'}
              </p>
            ) : (
              bar.groups.map((g) => (
                <section key={g.cadence} className="stream-tasks-sec">
                  <h4 className="stream-tasks-h label-data">{cadenceLabel(g.cadence)}</h4>
                  <ul className="stream-tasks-list">
                    {g.tasks.map((t) => {
                      const steps = stepsLabel(t);
                      return (
                        <li key={t.id} className="stream-tasks-row">
                          <span className="stream-tasks-text">
                            {t.title}
                            {/* The sort key, SHOWN. Ordering assigned work by a
                                size the row never displays leaves the operator
                                reading a list they cannot account for. */}
                            {sizeLabel(t) ? <span className="stream-tasks-size label-data"> {sizeLabel(t)}</span> : null}
                            {steps ? <span className="stream-tasks-steps label-data"> {steps}</span> : null}
                          </span>
                          <span className="stream-tasks-acts">
                            <button
                              type="button"
                              className="stream-tasks-act"
                              disabled={settling === t.id}
                              title="Settle — done"
                              aria-label={`Mark ${t.title} done`}
                              onClick={() => settle(t.id, 'done')}
                            >✓</button>
                            <button
                              type="button"
                              className="stream-tasks-act is-drop"
                              disabled={settling === t.id}
                              title="Drop — no longer standing"
                              aria-label={`Drop ${t.title}`}
                              onClick={() => settle(t.id, 'dropped')}
                            >✕</button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
            {note ? <p className="stream-tasks-empty is-warn label-data" role="status">{note}</p> : null}
          </>
        )}

        <footer className="stream-tasks-foot">
          {isHarness(activeCompanion) ? null : showOthers ? ( /* a harness desk has no other beings to show */
            <>
              <button
                type="button"
                className="stream-tasks-others-h label-data"
                onClick={() => { uiSound('close'); setShowOthers(false); }}
              >
                — ALL BEINGS ({bar.othersLive} WITH LIVE WORK) −
              </button>
              <ul className="stream-tasks-others">
                {bar.others.length === 0 ? (
                  <li className="stream-tasks-empty label-data">NO OTHER LIVE WORK</li>
                ) : bar.others.map((o) => (
                  <li key={o.neumaId}>
                    <button
                      type="button"
                      className="stream-tasks-other"
                      onClick={() => openTasksWindow(o.neumaId)}
                      title={`Open TASKS — ${o.name}`}
                    >
                      <span className="stream-tasks-other-name label-data">{o.name}</span>
                      {o.kind === 'witness' ? <span className="stream-tasks-kind label-data">WITNESS</span> : null}
                      <span className="stream-tasks-other-count label-data">{o.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <button type="button" className="stream-tasks-others-h label-data" onClick={openOthers}>
              — ALL BEINGS +
            </button>
          )}
          <button type="button" className="stream-tasks-editor label-data" onClick={() => openTasksWindow(null)}>
            OPEN THE EDITOR
          </button>
        </footer>
      </div>
    </aside>
  );
};
