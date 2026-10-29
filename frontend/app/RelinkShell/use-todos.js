// useTodos — every state read, subscription, and mutation behind the TASKS
// window (TodoApp.jsx), extracted under the 500-line law. impure: talks to
// the task backend (todo-client.js), the portal socket, and localStorage.
// TodoBody keeps only the row renderer and the JSX; every name it consumes
// is returned here unchanged.

import { useEffect, useState } from 'react';
import { useConsciousnessPick } from './consciousness-context.js';
import { useSettled } from './use-settled.js';
import { recoverRoster } from '../roster-recovery.js';
import { takeTaskFocus, onTaskFocus } from './task-focus.js';
import { onCardLanding, takeCardLanding } from './card-landing.js';
import { getRoster, getWitnesses } from '../../utils/companion-data.js';
import { uiSound } from '../../services/ui-sound.js';
import {
  todayKey, scopeRows, orderedScopes, standingOf, groupTasksByChat, chatChoices,
  settledTasks, ledgerRows, LANE_WIDE,
} from './todo-view.js';
import { orderMode } from '../../../core/tasks/task-order.js';
import { loadTaskOrder, TASK_ORDER_EVENT } from '../windowing/window-storage.js';
import { listSessions } from './workspace-sessions.js';
import { getChatLabels } from '../../services/chat-labels.js';
import {
  fetchMine, addMineTask, updateMineTask, fetchNeumaTasks, addNeumaTask, updateNeumaTask,
  addMineSubtask, updateMineSubtask, removeMineSubtask,
  addNeumaSubtask, updateNeumaSubtask, removeNeumaSubtask,
  fetchPresets, savePreset, deletePreset, applyMinePreset, applyNeumaPreset,
} from './todo-client.js';

// the intents a being uses on the OPERATOR'S list — adding AND amending; the
// ME lane refreshes on either (it once heard only the add)
const OPERATOR_ACTS = Object.freeze(['intents/tasks.operator-add', 'intents/tasks.operator-update', 'intents/tasks.operator-drop']);
// no card landed: one stable empty list, so a reader's effect keyed on it rests
const NO_LANDING = Object.freeze([]);

export const useTodos = () => {
  const { activeCompanion, wsService } = useConsciousnessPick('activeCompanion', 'wsService');
  const [roster, setRoster] = useState(getRoster);
  // Sealed witnesses carry lanes of their own, and the operator assigns them
  // work the same way (ruling, 2026-07-27) — so they get their own tabs beside the
  // house's, never mixed into it.
  const [witnesses, setWitnesses] = useState(getWitnesses);
  // 'me' = the operator's own lane; otherwise a lane id from the roster or the
  // operator list. The stream's rail can open this window ON a being (task-focus),
  // and a tray card ON its task (card-landing: the lane, and the ids it marks):
  // latched on mount, because the window mounts after the OPEN dispatch.
  const [landed, setLanded] = useState(() => takeCardLanding('todo'));
  const [scope, setScope] = useState(() => { const focus = takeTaskFocus(); return landed?.scope || focus || 'me'; });
  // The being's own sittings and the operator's names for them — needed to say
  // WHICH chat holds a task instead of printing a session token at them.
  const [sessions, setSessions] = useState([]);
  const [chatLabels, setChatLabels] = useState({});
  // The chat the stream is bound to, so the window can mark "IN THIS CHAT" and
  // default the add form to the conversation the operator is actually in.
  const [liveChat, setLiveChat] = useState(() => wsService?.getSessionState?.()?.sessionId ?? null);
  // Which chat NEW work is filed under; LANE_WIDE means […].
  const [chatTarget, setChatTarget] = useState(LANE_WIDE);
  const [foldedChats, setFoldedChats] = useState(() => new Set());
  // Heaviest first, lightest first, or the list's own — read from the operator's
  // stored choice, which the stream rail writes too.
  const [order, setOrder] = useState(loadTaskOrder);
  // The stream rail writes the same stored choice, so the window follows it the
  // moment it changes — one choice, one answer, both surfaces.
  useEffect(() => {
    const onOrder = (e) => setOrder(orderMode(e?.detail));
    window.addEventListener(TASK_ORDER_EVENT, onOrder);
    return () => window.removeEventListener(TASK_ORDER_EVENT, onOrder);
  }, []);
  const [plan, setPlan] = useState(undefined); // undefined = loading, null = unreadable
  // The being's own self-taken ledger and its settled record (neuma lanes
  // only) — both read-only here.
  const [ledger, setLedger] = useState(null);
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState('daily');
  const [detail, setDetail] = useState('');
  const [dueDate, setDueDate] = useState('');
  // The VESSEL mark on a new ME-lane daily — settling one marks the vessel log.
  const [vessel, setVessel] = useState(false);
  // The CUSTOM cadence's designed rhythm — getDay() indices (0 = Sunday).
  const [days, setDays] = useState([]);
  const [note, setNote] = useState(''); // the server's correction, or a generic failure line
  const [word, setWord] = useState(''); // a quiet confirmation (a preset saved), never a refusal
  const [posting, setPosting] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  // One task's step area open at a time; the draft and the step area's own
  // correction line belong to whichever task is expanded.
  const [expandedId, setExpandedId] = useState(null);
  const [subDraft, setSubDraft] = useState('');
  const [stepNote, setStepNote] = useState('');
  const [addingSub, setAddingSub] = useState(false);
  // A completion waiting on its confirmation — 'task:<id>' or
  // 'sub:<taskId>:<subId>'. Clicking a row asks; CONFIRM settles; anything
  // else dismisses. Completion is a deliberate act, never an accident.
  const [confirming, setConfirming] = useState(null);
  // The PRESETS panel: null presets = not yet loaded this session; saves and
  // deletes refresh the customs list from their own responses.
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState(null);

  const scopes = scopeRows(roster, witnesses, activeCompanion);
  // A being that left the house mid-session snaps the lane back to ME rather
  // than aiming at a scope the backend would (rightly) refuse.
  const scopeKnown = scope === 'me' || scopes.some((m) => m.neumaId === scope);
  const effectiveScope = scopeKnown ? scope : 'me';
  // The standing is DERIVED from the lane, never stored beside it — two sources
  // for one fact is how a switch ends up pointing at the wrong tab.
  const standing = standingOf(effectiveScope, witnesses);
  const houseRows = orderedScopes(roster, activeCompanion);
  const witnessRows = orderedScopes(witnesses, activeCompanion);
  const standingCounts = { house: houseRows.length, witnesses: witnessRows.length, me: 1 };

  // Picking a standing lands on its first lane — the switch is a way IN, so it
  // must never leave the window pointing at a lane from the standing you left.
  const pickStanding = (id) => {
    if (id === standing) return;
    if (id === 'me') return selectScope('me');
    const rows = id === 'witnesses' ? witnessRows : houseRows;
    if (rows.length > 0) selectScope(rows[0].neumaId);
  };
  const isMe = effectiveScope === 'me';
  const scopeRow = isMe ? null : scopes.find((m) => m.neumaId === effectiveScope) || null;
  const scopeName = isMe ? null : (scopeRow?.name || effectiveScope).toUpperCase();

  // The cached roster renders instantly; the backend refreshes it once per
  // open so a renamed or newly-summoned being appears without a reload.
  useSettled((settled) => {
    recoverRoster().then(() => {
      if (settled()) return;
      setRoster(getRoster());
      setWitnesses(getWitnesses());
    });
  }, []);

  // The lane's plan — loaded on mount and on every scope switch. The server
  // rolls recurrence forward on read, so this IS the current truth. A neuma
  // lane also carries the being's own self-taken ledger and its settled
  // history (both read-only here).
  useSettled((settled) => {
    setPlan(undefined);
    setLedger(null);
    setHistory(null);
    setNote('');
    const meScope = effectiveScope === 'me';
    const load = meScope ? fetchMine() : fetchNeumaTasks(effectiveScope);
    load
      .then((body) => {
        if (settled()) return;
        setPlan(body?.plan ?? null);
        setLedger(meScope ? null : (body?.ledger ?? null));
        setHistory(meScope ? null : (Array.isArray(body?.history) ? body.history : []));
      })
      .catch(() => {
        if (settled()) return;
        setPlan(null);
        setLedger(null);
        setHistory(null);
      });
  }, [effectiveScope]);

  // The lane's sittings and the operator's names for them. Loaded per lane,
  // because "which chat" is only a question a being's own lane can answer. A
  // failure here costs the NAMES, never the tasks — a chat still groups under
  // its timestamp rather than vanishing.
  useSettled((settled) => {
    if (effectiveScope === 'me') { setSessions([]); return; }
    listSessions(effectiveScope)
      .then((rows) => { if (!settled()) setSessions(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!settled()) setSessions([]); });
  }, [effectiveScope]);

  // The labels are wallet-global, so this does not vary by lane — it is keyed on
  // the lane deliberately: switching lanes is the natural moment to pick up a
  // chat the operator renamed in the CHATS window since this one mounted.
  useSettled((settled) => {
    getChatLabels()
      .then((labels) => { if (!settled()) setChatLabels(labels || {}); })
      .catch(() => { if (!settled()) setChatLabels({}); });
  }, [effectiveScope]);

  // The socket owns the chat binding and announces every change (resume, new
  // chat, being switch) — the window follows it rather than guessing.
  useSettled(() => {
    if (!wsService) return undefined;
    setLiveChat(wsService.getSessionState?.()?.sessionId ?? null);
    const onState = (state) => setLiveChat(state?.sessionId ?? null);
    wsService.on('session:state', onState);
    return () => wsService.off('session:state', onState);
  }, [wsService]);

  // New work defaults to the conversation the operator is standing in — that is
  // the common case, and it is what makes the per-chat list fill itself instead
  // of needing to be curated. Only when the lane on screen IS the being the
  // stream is bound to; aiming another being's work at this chat would be a lie.
  useEffect(() => {
    const boundHere = effectiveScope !== 'me' && effectiveScope === activeCompanion?.neumaId;
    setChatTarget(boundHere && liveChat ? liveChat : LANE_WIDE);
  }, [effectiveScope, activeCompanion?.neumaId, liveChat]);

  // Live: a being's task work rides tool:usage frames on the desk's portal.
  // When the being on screen finishes a tasks/* op — or settles a tasks/*
  // INTENT (the mutations are filed acts now; the chips read intents/tasks.*) —
  // refetch the lane so THEIR OWN WORK moves as they work; a being adding to
  // the OPERATOR'S list (the tasks/operator-add intent) is the ME lane's
  // business the same way. Ambient
  // — no sound, no note line; a failed refresh keeps the last truth the lane
  // honestly had. Frames naming another being (or no being) are not this
  // lane's business.
  useSettled((settled) => {
    if (!wsService) return undefined;
    const meLane = effectiveScope === 'me';
    let timer = null;
    const onTool = (frame) => {
      if (frame?.status !== 'ok') return;
      const name = frame?.tool;
      if (typeof name !== 'string' || !(name.startsWith('tasks/') || name.startsWith('intents/tasks.'))) return;
      if (meLane
        ? !OPERATOR_ACTS.includes(name)
        : (!frame?.neumaId || frame.neumaId !== effectiveScope)) return;
      // A turn often fires 2–3 task ops — one trailing refetch covers the burst.
      clearTimeout(timer);
      timer = setTimeout(() => {
        const load = meLane ? fetchMine() : fetchNeumaTasks(effectiveScope);
        load
          .then((body) => {
            if (settled()) return;
            setPlan(body?.plan ?? null);
            if (meLane) return;
            setLedger(body?.ledger ?? null);
            setHistory(Array.isArray(body?.history) ? body.history : []);
          })
          .catch((error) => console.warn('todo: live lane refresh failed —', error?.message ?? error));
      }, 200);
    };
    wsService.on('tool:usage', onTool);
    return () => {
      clearTimeout(timer);
      wsService.off('tool:usage', onTool);
    };
  }, [wsService, effectiveScope]);

  // The preset catalog loads the first time the panel opens; after that,
  // saves and deletes keep it current from their own responses.
  useSettled((settled) => {
    if (!showPresets || presets !== null) return;
    fetchPresets()
      .then((body) => {
        if (settled()) return;
        setPresets({
          builtins: Array.isArray(body?.builtins) ? body.builtins : [],
          customs: Array.isArray(body?.customs) ? body.customs : [],
        });
      })
      .catch((error) => {
        if (!settled()) setNote(error.http === 400 ? error.message : 'THE PRESETS COULD NOT BE READ — TRY AGAIN');
      });
  }, [showPresets, presets]);

  const selectScope = (id) => {
    if (id === scope) return;
    uiSound('tick');
    setScope(id);
    setShowSettled(false);
    setShowHistory(false);
    // The fold is per-chat, and EVERY CHAT is a key EVERY lane shares —
    // carried across a switch it would fold a being's bucket because a
    // different being's was folded.
    setFoldedChats(new Set());
    setExpandedId(null);
    setConfirming(null);
    setSubDraft('');
    setStepNote('');
    setWord('');
    setLanded(null);
  };

  // A rail click or a tray card while TASKS is ALREADY open still lands — the
  // latches cover the mount, these cover every request after it.
  useEffect(() => onTaskFocus((focus) => { if (focus) selectScope(focus); }));
  useEffect(() => onCardLanding('todo', (item) => { if (item?.scope) selectScope(item.scope); setLanded(item); }));

  // Escape dismisses a pending completion confirmation.
  useEffect(() => {
    if (!confirming) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setConfirming(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming]);

  // impure — one mutation, then the window re-renders from the returned plan.
  // setErr is where a refusal lands: the form's note line by default, the
  // step area's own line for step work. Resolves to the response body (or
  // true) so a caller can read what the server said — false on a refusal.
  const runMutation = async (call, sound, setErr = setNote) => {
    setErr('');
    setWord('');
    try {
      const body = await call();
      setPlan(body?.plan ?? null);
      if (sound) uiSound(sound);
      return body || true;
    } catch (error) {
      setErr(error.http === 400 ? error.message : 'THE PLAN REFUSED THE CHANGE — TRY AGAIN');
      return false;
    }
  };

  const patchTask = async (taskId, patch) => {
    const body = await runMutation(
      () => (isMe ? updateMineTask(taskId, patch) : updateNeumaTask(effectiveScope, taskId, patch)),
      patch.status === 'dropped' ? 'deny' : 'toggle',
    );
    // A vessel daily that settled but did NOT reach the vessel log is said
    // out loud — the announcement register, never a silent miss (F2).
    if (body && body.vesselLogged === false) {
      const name = String(body.task?.title || 'the daily').toUpperCase();
      setNote(`«WARNING» ${name} SETTLED, BUT THE MARK DID NOT REACH THE VESSEL LOG — MARK IT IN VESSEL BY HAND`);
    }
    return body;
  };

  const toggleSteps = (taskId) => {
    uiSound('tick');
    setExpandedId((id) => (id === taskId ? null : taskId));
    setSubDraft('');
    setStepNote('');
  };

  const toggleSub = (task, sub) =>
    runMutation(
      () => {
        const status = sub.status === 'done' ? 'open' : 'done';
        return isMe
          ? updateMineSubtask(task.id, sub.id, { status })
          : updateNeumaSubtask(effectiveScope, task.id, sub.id, { status });
      },
      'toggle',
      setStepNote,
    );

  // Settling work asks first — click raises the confirm, CONFIRM commits,
  // anything else dismisses. The ask gates BOTH directions (done and
  // reopen): list state only ever changes on purpose.
  const askConfirm = (task) => { uiSound('tick'); setConfirming(`task:${task.id}`); };
  const askToggleSub = (task, sub) => { uiSound('tick'); setConfirming(`sub:${task.id}:${sub.id}`); };
  const confirmToggleSub = (task, sub) => { setConfirming(null); toggleSub(task, sub); };

  const removeSub = (task, sub) =>
    runMutation(
      () => (isMe ? removeMineSubtask(task.id, sub.id) : removeNeumaSubtask(effectiveScope, task.id, sub.id)),
      'deny',
      setStepNote,
    );

  const onAddSub = async (event, task) => {
    event.preventDefault();
    const trimmed = subDraft.trim();
    if (!trimmed || addingSub) return;
    setAddingSub(true);
    const added = await runMutation(
      () => (isMe ? addMineSubtask(task.id, trimmed) : addNeumaSubtask(effectiveScope, task.id, trimmed)),
      'activate',
      setStepNote,
    );
    setAddingSub(false);
    if (added) setSubDraft('');
  };

  // Lift a task (steps included) into a reusable bundle. The response carries
  // the refreshed customs list — applied only when the panel has loaded
  // (otherwise its first open fetches the whole catalog anyway).
  const saveTaskAsPreset = async (task) => {
    setStepNote('');
    setNote('');
    setWord('');
    try {
      const body = await savePreset({
        name: task.title,
        tasks: [{
          title: task.title,
          cadence: task.cadence,
          ...(task.detail ? { detail: task.detail } : {}),
          ...(task.dueDate ? { dueDate: task.dueDate } : {}),
          ...(task.cadence === 'custom' && task.days?.length ? { days: task.days } : {}),
          ...(task.vessel === true ? { vessel: true } : {}),
          subtasks: (task.subtasks || []).map((s) => ({ title: s.title })),
        }],
      });
      setPresets((p) => (p ? { ...p, customs: body?.presets ?? [] } : p));
      uiSound('activate');
      setWord(`SAVED AS PRESET — ${task.title}`);
    } catch (error) {
      setNote(error.http === 400 ? error.message : 'THE PRESET REFUSED — TRY AGAIN');
    }
  };

  const togglePresets = () => {
    uiSound('toggle');
    setShowPresets((v) => !v);
  };

  // APPLY lands the bundle in the lane on screen and re-renders from the
  // returned plan; the panel stays open for another pick.
  const applyPresetById = (presetId) =>
    runMutation(
      () => (isMe ? applyMinePreset(presetId) : applyNeumaPreset(effectiveScope, presetId)),
      'activate',
    );

  const removePresetById = async (presetId) => {
    setNote('');
    setWord('');
    try {
      const body = await deletePreset(presetId);
      setPresets((p) => (p ? { ...p, customs: body?.presets ?? [] } : p));
      uiSound('deny');
    } catch (error) {
      setNote(error.http === 400 ? error.message : 'THE PRESET REFUSED — TRY AGAIN');
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || posting) return;
    const fields = {
      title: trimmed,
      cadence,
      ...(detail.trim() ? { detail: detail.trim() } : {}),
      ...(cadence === 'milestone' && dueDate ? { dueDate } : {}),
      ...(cadence === 'custom' ? { days: [...days].sort((a, b) => a - b) } : {}),
      // The VESSEL mark belongs to the operator's own dailies only — a being's
      // lane has no use for it (its own dailies bridge through its ledger).
      ...(isMe && cadence === 'daily' && vessel ? { vessel: true } : {}),
      // EVERY CHAT is the absence of a chat, so it sends nothing — the store
      // writes no key at all for lane-wide work.
      ...(!isMe && chatTarget !== LANE_WIDE ? { chatId: chatTarget } : {}),
    };
    setPosting(true);
    const added = await runMutation(
      () => (isMe ? addMineTask(fields) : addNeumaTask(effectiveScope, fields)),
      'activate',
    );
    setPosting(false);
    if (added) { setTitle(''); setVessel(false); }
  };

  const today = todayKey();
  // Open work grouped BY CHAT — the shape Founder asked for. The ME lane is never
  // chat-scoped (it is his life, not the work of one conversation), so it keeps
  // its single list and simply reads as one bucket.
  const chatSections = plan
    ? groupTasksByChat(plan.tasks, {
      labels: chatLabels,
      neumaId: effectiveScope,
      activeChatId: effectiveScope === activeCompanion?.neumaId ? liveChat : null,
      order,
    })
    : [];
  const chatOptions = chatChoices(sessions, { labels: chatLabels, neumaId: effectiveScope, activeChatId: liveChat });
  const settledList = plan ? settledTasks(plan.tasks) : [];
  // The being's own self-taken work (neuma lanes) — read-only context in two
  // registers (live, recently settled) plus the deep settled record.
  // The whole ledger rides along, not just its tasks: it carries the focus map
  // (which task each chat has in hand) and it is the list blockers resolve
  // against — a blocker taken up in another chat still blocks here.
  const own = ledger ? ledgerRows(ledger.tasks, 10, { ledger, order }) : { live: [], settled: [] };
  const historyList = Array.isArray(history) ? history : [];
  const ownEmpty = own.live.length === 0 && own.settled.length === 0;
  // A landed assignment that already settled opens the SETTLED list it stands in.
  const landedIds = landed?.ids ?? NO_LANDING;
  useEffect(() => {
    if (settledList.some((t) => landedIds.includes(t.id))) setShowSettled(true);
  }, [plan, landed]);

  return {
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
    settledList, own, ownEmpty, today, landedIds,
    patchTask, toggleSteps, askConfirm, askToggleSub, confirmToggleSub,
    removeSub, onAddSub, saveTaskAsPreset, togglePresets, applyPresetById,
    removePresetById, onSubmit,
  };
};
