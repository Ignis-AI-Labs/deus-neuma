// use-consciousness-stream.js — the live link, as React state.
//
// impure hook: subscribes to the portal's consciousness messages and
// translates them into stream-reducer actions, owning the stateful
// tool-stream filter so raw tool payloads never reach the screen as
// speech. Subscriptions are cleaned up on unmount — the relink surface
// can come and go without leaking listeners.
//
// SIZE-029 (#376) split: persisted preferences live in stream-preferences.js,
// the inbound frame translators in stream-message-handlers.js, and the
// outgoing portal commands in stream-actions.js. This file keeps only the
// React wiring (state, refs, effects) that binds them together.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { reducer, initialState } from './stream-reducer.js';
import { createToolStreamFilter, extractToolLabel } from '../../utils/tool-stream-filter.js';
import { setActiveCompanion, resolveBoundCompanion, setWindowCompanion } from '../../utils/companion-data.js';
import { loadNavigationHistory } from './stream-navigation-history.js';
import { sharedStatusPoller, registerLaneForPolling } from '../../services/desk-status-poller.js';
import { createVoiceSink } from './voice-sink.js';
import { PURPOSE_WORK, PURPOSE_CONVERSATION, normalizePurpose } from '../../../core/voice/purpose.js';
import { shouldMountVoiceSitting } from './VoiceSitting/voice-sitting-model.js';
import {
  getSittingPurpose, setSittingPurpose, isLiveArmed, setLiveArmed, subscribeVoiceSitting,
} from './voice-purpose-state.js';
import { focusSpaceFrame, focusToolFrame } from './desk-focus.js';
import { useSettled } from './use-settled.js';
import { readToolModePref, readChatModePref } from './stream-preferences.js';
import { useVoiceEnabled } from './use-voice-enabled.js';
import { createStreamHandlers } from './stream-message-handlers.js';
import { createStreamActions } from './stream-actions.js';

export { TOOL_MODES, CHAT_MODES } from './stream-preferences.js';

// Pure — episodic scope and execution focus travel together, but remain
// distinct authorities: project space scopes memory; toolWorkspace is only a
// server-validated source hint for the operator's disposable coding snapshot.
const portalFocusFrame = (focus, projects) => ({
  ...focusSpaceFrame(focus, projects),
  ...focusToolFrame(focus, projects),
});

/**
 * @param {object} wsService - the portal this stream speaks through
 * @param {object} [opts]
 * @param {boolean} [opts.house] - does this stream answer for the MACHINE's
 *   broadcast frames? Exactly one per desk may (the desk-level stream), because
 *   with one socket per STREAM WINDOW those frames arrive N times: a storage
 *   warning would sound its alarm and write its row in every window at once.
 *   The substrate's turn count is exempt — the server sends an absolute number,
 *   so every window reading it lands on the same truth rather than a multiple.
 */
export const useConsciousnessStream = (wsService, {
  focus = null, projects = null, onProjectChatCreated = null, house = true,
} = {}) => {
  // Read through a ref: the handlers below are registered once and must see the
  // current answer without re-subscribing the whole portal.
  const houseRef = useRef(house);
  houseRef.current = house;
  const [state, rawDispatch] = useReducer(reducer, initialState);
  // Every action carries its moment (`at`) — the reducer is clock-free; the
  // impure hook stamps time at the boundary (persisted times win). THE
  // TAKES: an in-flight turn's take identity rides every segment action, so
  // the reducer targets the TAKE of its point, never a new tail message.
  const dispatch = useCallback((action) => {
    const take = currentTakeRef.current;
    return rawDispatch({ at: Date.now(), ...(take ? { take } : {}), ...action });
  }, []);
  // THIS window's focus and the fetched projects list, mirrored in refs so
  // the stable send/resume handlers stamp the CURRENT lens on each frame
  // without re-subscribing. Frames derive from focus (D7): project focus
  // stamps that project's space; a bare folder or no focus stamps NOTHING.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const onProjectChatCreatedRef = useRef(onProjectChatCreated);
  onProjectChatCreatedRef.current = onProjectChatCreated;
  // The last session id we've accounted for against the active project — so a
  // newly-minted project chat refreshes the projects view exactly once, while
  // a resumed chat (ref pre-seeded) triggers no spurious refetch.
  const projectChatSeenRef = useRef(null);
  // Last announced storage assessment — repeats of the same picture from the
  // heartbeat stay silent (see shouldAnnounceStorage).
  const storageWarningRef = useRef(null);
  // WHO is on the other side of the portal, as reactive state — THIS
  // window's binding (window-first, F-01), never the shared last-used key: a
  // sibling window's switch must not move it. Mirrored in a ref so stable
  // handlers (link-up, complete, send) read it without re-subscribing.
  const [activeCompanion, setActiveCompanionState] = useState(resolveBoundCompanion);
  const companionRef = useRef(activeCompanion);
  companionRef.current = activeCompanion;
  // Every transcript navigation advances one generation. Async history reads
  // and old-turn wire frames from earlier generations are discarded.
  const navigationSeqRef = useRef(0);
  const transitioningRef = useRef(false);
  const filterRef = useRef(null);
  // Provider token cadence can exceed display cadence (OpenAI commonly sends
  // several deltas inside one 16 ms frame). Buffer speech to one reducer write
  // per paint; tool boundaries and completion flush synchronously below so
  // segment order remains exact.
  const speechBufferRef = useRef('');
  const speechFrameRef = useRef(null);
  const streamSeenRef = useRef(false);
  const historyLoadedRef = useRef(false);
  // THE RELOAD-RACE GATE (D5, Design note, 2026-08-31: the in-flight link-up history
  // load's promise. A thought fired before it resolves waits on it — the
  // resume bind lands first, so the server continues the chat on screen
  // instead of minting a forked session with an empty tail.
  const historyReadyRef = useRef(null);
  // FAIL LOUD, NEVER FORK (ruling, 2026-08-31): set when the history load FAILED
  // (and its one retry). Sends hold with a loud bubble until a load succeeds —
  // a fresh session is never minted silently over an intact chat.
  const historyFailedRef = useRef(false);
  // The in-flight turn's take identity ({turnId, takeIndex}), read off the
  // backend's stamped stream frames; null between turns.
  const currentTakeRef = useRef(null);
  // Whether this turn errored — suppresses the success chime on the trailing complete
  const erroredRef = useRef(false);
  // Whether the link is currently up — chime only on real up/down transitions
  const connectedRef = useRef(false);
  // Whether the operator has already sent a thought — a slow first history
  // load must not rebind the portal underneath a conversation in progress.
  const turnStartedRef = useRef(false);

  const flushSpeech = useCallback(() => {
    if (speechFrameRef.current !== null) {
      cancelAnimationFrame(speechFrameRef.current);
      speechFrameRef.current = null;
    }
    const text = speechBufferRef.current;
    speechBufferRef.current = '';
    if (text) dispatch({ type: 'SPEECH', text });
  }, []);

  const queueSpeech = useCallback((text) => {
    if (!text) return;
    speechBufferRef.current += text;
    if (speechFrameRef.current !== null) return;
    speechFrameRef.current = requestAnimationFrame(() => {
      speechFrameRef.current = null;
      const buffered = speechBufferRef.current;
      speechBufferRef.current = '';
      if (buffered) dispatch({ type: 'SPEECH', text: buffered });
    });
  }, []);

  const clearSpeech = useCallback(() => {
    if (speechFrameRef.current !== null) cancelAnimationFrame(speechFrameRef.current);
    speechFrameRef.current = null;
    speechBufferRef.current = '';
  }, []);

  const clearStreamPipeline = useCallback(() => {
    clearSpeech();
    filterRef.current = null;
  }, [clearSpeech]);

  const ensureFilter = useCallback(() => {
    if (filterRef.current) return filterRef.current;
    filterRef.current = createToolStreamFilter({
      onSpeech: queueSpeech,
      onToolStart: () => {
        flushSpeech();
        dispatch({ type: 'TOOL_OPEN' });
      },
      onToolEnd: (raw) => dispatch({ type: 'TOOL_RAW', raw, label: extractToolLabel(raw) }),
    });
    return filterRef.current;
  }, [flushSpeech, queueSpeech]);

  // The neuma's voice: a Web Audio sink that plays the backend's per-sentence
  // voice:audio frames in order. Lazily created (and lazily opens its
  // AudioContext), so a text-only neuma never touches the audio stack.
  const sinkRef = useRef(null);
  // The live voice sitting's generation scope (SPEECH SYSTEM, CancelScope —
  // client mirror of the stream-session bridge): `voiceGenRef` = newest gen
  // from server frames; `voiceGenFloorRef` = the drop floor a LOCAL barge-in
  // raises — older frames belong to the cut-off utterance and never render.
  // The mic_open ack is the session's birth certificate (scope resets).
  const voiceGenRef = useRef(0);
  const voiceGenFloorRef = useRef(0);
  // The turn whose audio is currently sounding, and the one that was cut and
  // must never sound again. Identity, not timing — the frames of a cancelled
  // sentence are usually already on the wire when the barge-in is decided.
  const lastVoiceTurnRef = useRef(null);
  const cutVoiceTurnRef = useRef(null);
  // The operator's VOX — state, persistence, sink application, and the
  // voice:pref wire fact live in use-voice-enabled.js (size-law split).
  const { voiceEnabled, setVoiceEnabled, toggleVoice, voiceEnabledRef } = useVoiceEnabled({ wsService, sinkRef });
  // THE SITTING'S PURPOSE (SPEECH SYSTEM B-12): connection-scoped; server
  // truth lands on the session:purpose ack (tool:mode precedent), mirrored
  // into voice-purpose-state.js so the mic path never imports this hook.
  // Fail-closed: born 'work', reset to 'work' on a companion switch.
  const [purpose, setPurposeState] = useState(() => getSittingPurpose());
  const purposeRef = useRef(purpose);
  purposeRef.current = purpose;
  // LIVE armed, as reactive state mirrored from the module — the mic path
  // and the VoiceSitting EXIT gesture write the module; this keeps the
  // desk's mount decision (shouldMountVoiceSitting) reactive to both.
  const [liveArmed, setLiveArmedState] = useState(() => isLiveArmed());
  useEffect(() => subscribeVoiceSitting(() => setLiveArmedState(isLiveArmed())), []);
  // impure — apply purpose truth (the portal's ack, or local while dormant):
  // module first (the mic path reads it there), then the reactive mirror,
  // then the purpose-driven VOICE DEFAULTS — fired on the work→conversation
  // TRANSITION only, so a VOX the operator switched off mid-sitting is never
  // re-forced by a later ack or a reconnect restate (voice:pref overrides).
  //
  // THIS NO LONGER ARMS LIVE, and the reason is the transition guard's own
  // blind spot. `prev` is read from the module, whose default is WORK, so after
  // any page load the ack that merely RESTATES a session's standing purpose is
  // indistinguishable from the operator declaring one — same values, same
  // transition. Arming here therefore armed on every load of a conversation
  // chat, and an armed sitting REPLACES the composer (ChatApp's
  // voiceSittingActive branch: […]). The
  // operator lost the chat box to a restore they never asked for, with no
  // send to press.
  //
  // Arming belongs to the gesture, where enterVoiceSitting already does it and
  // says why. A restore now settles the purpose and the voice flags and leaves
  // the keyboard alone; the talk is re-entered deliberately.
  const applyPurpose = useCallback((next) => {
    const normalized = normalizePurpose(next);
    const prev = purposeRef.current;
    setSittingPurpose(normalized);
    setPurposeState(normalized);
    dispatch({ type: 'PURPOSE', purpose: normalized }); // reducer truth — state.purpose rides LOAD/RESET like connected
    if (normalized === prev) return;
    if (normalized === PURPOSE_CONVERSATION) {
      setVoiceEnabled(true);   // purpose defaults the voice flags — not the mic
    } else {
      setLiveArmed(false);     // leaving a conversation still disarms, fail-closed
    }
  }, []);
  // Tool mode as React state, mirrored in a ref so the stable link-up
  // handler restates the stance without re-subscribing. Seeded from the
  // BOUND participant's own stance, never a shared global.
  // How many mid-stream words the portal is holding for the next turn.
  const [heldCount, setHeldCount] = useState(0);
  // Mints each send's hold handle — session-local, collision-free by count.
  const holdSeqRef = useRef(0);
  const [toolMode, setToolModeState] = useState(() => readToolModePref(activeCompanion?.neumaId));
  // The ref is what link-up restates: moved by declaration, ack and arrival,
  // never synced from state on render (that lags the ack — restates stale).
  const toolModeRef = useRef(toolMode);
  // The standing CHAT mode (default / plan / auto) — the composer's chip.
  // Same shape as the tool stance: seeded from the BOUND participant's own
  // pref, the same restate ref, server truth on the chat:mode ack.
  const [chatMode, setChatModeState] = useState(() => readChatModePref(activeCompanion?.neumaId));
  const chatModeRef = useRef(chatMode);
  const ensureSink = useCallback(() => {
    if (!sinkRef.current) sinkRef.current = createVoiceSink({ enabled: voiceEnabledRef.current });
    return sinkRef.current;
  }, []);

  // The outgoing portal commands (stream-actions.js) — one memo keyed on the
  // same dependencies the individual useCallbacks were ([wsService,
  // ensureSink]), so consumer-visible identities change exactly when they did.
  const {
    sendThought, sendRetry, sendRevision, switchTake, stopThought,
    editQueuedThought, sendQueuedNow, pullQueuedThought,
    respondApproval, respondAsk, respondPlan, respondSeal, setToolMode, setChatMode,
  } = useMemo(() => createStreamActions({
    wsService, dispatch, ensureSink, portalFocusFrame, setToolModeState, setChatModeState,
    turnStartedRef, erroredRef, streamSeenRef, sinkRef, holdSeqRef,
    voiceGenRef, voiceGenFloorRef, lastVoiceTurnRef, cutVoiceTurnRef,
    companionRef, focusRef, projectsRef, historyReadyRef, historyFailedRef, navigationSeqRef,
    toolModeRef, chatModeRef,
  }), [wsService, ensureSink]);

  // The inbound frame translators (stream-message-handlers.js) — created once
  // per subscription, registered in one loop, removed in the same loop.
  useEffect(() => {
    const { onLinkUp, entries } = createStreamHandlers({
      wsService, dispatch, flushSpeech, ensureFilter, ensureSink, applyPurpose,
      setHeldCount, setToolModeState, setChatModeState, sendThought, portalFocusFrame,
      houseRef, focusRef, projectsRef, onProjectChatCreatedRef, projectChatSeenRef,
      storageWarningRef, companionRef, navigationSeqRef, transitioningRef, filterRef,
      streamSeenRef, historyLoadedRef, currentTakeRef, erroredRef, connectedRef,
      turnStartedRef, voiceGenRef, voiceGenFloorRef, lastVoiceTurnRef, cutVoiceTurnRef,
      toolModeRef, chatModeRef, voiceEnabledRef, purposeRef, historyReadyRef, historyFailedRef,
    });
    entries.forEach(([channel, on]) => wsService.on(channel, on));

    // The portal may already be live before this hook mounts (post-ceremony).
    if (wsService.isConnected) onLinkUp();

    return () => {
      entries.forEach(([channel, on]) => wsService.off(channel, on));
    };
  }, [wsService, ensureFilter, ensureSink, flushSpeech, applyPurpose]);

  // Tear the audio context down only when the desk itself unmounts — not on
  // every stream re-subscription.
  useEffect(() => () => {
    navigationSeqRef.current += 1;
    wsService.emit('portal:navigation-start', { disposed: true });
    clearStreamPipeline();
    if (sinkRef.current) {
      sinkRef.current.dispose();
      sinkRef.current = null;
    }
  }, [clearStreamPipeline]);

  // Poll the LOCAL substrate's reachability + deliberate rest so its light
  // tells the truth even when no message is in flight — an open socket is
  // not a substrate that can think. The live stream (above) flips it
  // instantly on a real send. This probe feeds ONLY the local light.
  // SHARED POLLER (friction-map D1): the substrate is ONE machine fact —
  // every stream instance on this desk used to re-ask it every 15s (the
  // 429-storm shape); one timer per renderer serves them all now.
  useSettled((settled) => {
    const unsub = sharedStatusPoller.subscribe('substrate', (h) => {
      if (!settled()) dispatch({ type: 'LOCAL', reachable: h.reachable, standby: h.standby });
    }, 15000);
    return unsub;
  }, []);

  // Poll the BOUND LANE's own route health — the ROUTE light — on lane bind
  // and the same calm 15s cadence, SHARED PER LANE (one timer per lane id,
  // not one per surface showing that lane). The two probes are independent
  // by law: neither light ever borrows the other's truth.
  useSettled((settled) => {
    const lane = companionRef.current;
    if (!lane?.neumaId) return undefined;
    const key = `route:${lane.neumaId}`;
    registerLaneForPolling(key, lane);
    const unsub = sharedStatusPoller.subscribe(key, (h) => {
      if (!settled()) dispatch({ type: 'ROUTE', live: h.live, provider: h.provider });
    }, 15000);
    return unsub;
  }, [activeCompanion?.neumaId]);

  // Resume a past chat: bind the portal to its session (the server replays
  // its recent turns into the prompt, so the next message continues it) and
  // load its turns into the display, replacing the current thread.
  const resumeSession = useCallback(async ({ neumaId, companionName, sessionId }) => {
    if (!neumaId || !sessionId) return;
    const navigationSeq = ++navigationSeqRef.current;
    transitioningRef.current = true;
    clearStreamPipeline();
    streamSeenRef.current = false;
    wsService.emit('portal:navigation-start', { neumaId, sessionId });
    // This resumed chat already exists — account for it so its completes don't
    // read as a new project chat and re-refresh the projects view.
    projectChatSeenRef.current = sessionId;
    wsService.send('portal:resume', { neumaId, companionName, sessionId, ...portalFocusFrame(focusRef.current, projectsRef.current) });
    // Hold the binding client-side too — a reconnect must resume THIS chat,
    // not silently sever it (the next message would fork a new session).
    wsService.setSessionState({ neumaId, companionName, sessionId });
    erroredRef.current = false;
    historyLoadedRef.current = true; // a reconnect must not clobber the resumed view
    return loadNavigationHistory({
      historyReadyRef, historyFailedRef, navigationSeqRef, navigationSeq, dispatch,
      neumaId, sessionId,
    });
  }, [wsService, clearStreamPipeline]);

  // Start a fresh chat: sever the bound session (the next message mints a new
  // one server-side) and clear the display. An explicit `frame` overrides the
  // window-focus frame for THIS mint — the projects view starts a chat in the
  // project it is showing, whose setFocus hasn't flushed into focusRef yet.
  const newSession = useCallback((frame = null) => {
    navigationSeqRef.current += 1;
    historyReadyRef.current = null;
    historyFailedRef.current = false;
    transitioningRef.current = true;
    // The next message mints a fresh session; clear the accounted-for id so
    // that mint's complete fires the one project refresh.
    projectChatSeenRef.current = null;
    wsService.emit('portal:navigation-start', { neumaId: companionRef.current?.neumaId, sessionId: null });
    // The sitting's declared purpose rides the mint — a NEW sitting opened as
    // CONVERSATION is a voice sitting from its first frame (B-12).
    wsService.send('portal:new-session', { ...(frame ?? portalFocusFrame(focusRef.current, projectsRef.current)), purpose: purposeRef.current });
    // Clear the held binding so a reconnect doesn't resurrect the severed
    // chat. The first message mints the new session server-side, and its
    // complete echoes the minted id back into this state.
    wsService.setSessionState({
      neumaId: companionRef.current?.neumaId,
      companionName: companionRef.current?.name || 'Unknown',
      sessionId: null,
    });
    erroredRef.current = false;
    historyLoadedRef.current = true;
    clearStreamPipeline();
    streamSeenRef.current = false;
    dispatch({ type: 'RESET' });
  }, [wsService, clearStreamPipeline]);

  // Switch THIS window to another neuma in the operator's house: rebind the
  // window (sessionStorage) and the portal (the server severs the prior
  // being's bound session on a changed manifest), remember the choice as the
  // shared last-used (the seed for future windows — never a rebind of live
  // siblings), and replace the display with the new neuma's latest thread —
  // arriving must never read as memory loss.
  const switchCompanion = useCallback(async (companion) => {
    if (!companion?.neumaId || companion.neumaId === companionRef.current?.neumaId) return;
    const navigationSeq = ++navigationSeqRef.current;
    transitioningRef.current = true;
    wsService.emit('portal:navigation-start', { neumaId: companion.neumaId, sessionId: null });
    setWindowCompanion(companion);   // this window's binding
    setActiveCompanion(companion);   // shared last-used — seeds NEW windows only
    setActiveCompanionState(companion);
    companionRef.current = companion; // handlers must see the switch NOW, not next render
    wsService.setSessionState({ neumaId: companion.neumaId, companionName: companion.name });
    // The stance belongs to the BEING, not the window: arriving at a new
    // participant restates ITS mode. Without this the connection would keep
    // carrying the previous being's stance, and an operator set to `auto` would
    // hand a neuma silent tool acts the operator never granted it.
    const arrivingMode = readToolModePref(companion.neumaId);
    toolModeRef.current = arrivingMode;
    setToolModeState(arrivingMode);
    // The chat mode belongs to the BEING too — arriving restates ITS mode,
    // after the tool stance so the server's derivation (chat mode carries the
    // ACTS tier) lands last and wins.
    const arrivingChatMode = readChatModePref(companion.neumaId);
    chatModeRef.current = arrivingChatMode;
    setChatModeState(arrivingChatMode);
    // A switch of being is a new sitting: purpose fails closed to WORK and
    // LIVE disarms. The manifest below carries NO purpose field, so the
    // server lands on its own fail-closed default in step with the desk.
    setSittingPurpose(PURPOSE_WORK);
    setPurposeState(PURPOSE_WORK);
    setLiveArmed(false);
    if (wsService.isConnected) {
      wsService.send('companion:manifest', { companion: companion.name, neumaId: companion.neumaId });
      wsService.send('tool:mode', { mode: arrivingMode });
      wsService.send('chat:mode', { mode: arrivingChatMode });
    } else {
      wsService.connect(); // cold link — connect() manifests from held state on open
    }
    erroredRef.current = false;
    historyLoadedRef.current = true; // a reconnect must not clobber the switched view
    // The previous neuma's voice must not keep speaking over the new one.
    if (sinkRef.current) sinkRef.current.interrupt();
    clearStreamPipeline();
    streamSeenRef.current = false;
    dispatch({ type: 'RESET' });
    return loadNavigationHistory({
      historyReadyRef, historyFailedRef, navigationSeqRef, navigationSeq, dispatch,
      neumaId: companion.neumaId,
      onLoaded: ({ sessionId }) => {
        const bind = { neumaId: companion.neumaId, companionName: companion.name, sessionId };
        wsService.setSessionState(bind);
        if (sessionId) {
          projectChatSeenRef.current = sessionId;
          wsService.send('portal:resume', { ...bind, ...portalFocusFrame(focusRef.current, projectsRef.current) });
        }
      },
    });
  }, [wsService, clearStreamPipeline]);

  // Declare the sitting's purpose (B-12). Server truth lands on the
  // session:purpose ack; a dormant portal holds the choice locally and
  // restates it on link-up (the tool:mode precedent).
  const setPurpose = useCallback((next) => {
    const normalized = normalizePurpose(next);
    if (normalized === purposeRef.current) return;
    if (wsService.isConnected) wsService.send('session:purpose', { purpose: normalized });
    else applyPurpose(normalized);
  }, [wsService, applyPurpose]);

  // THE ONE WAY IN (Design note, 2026-08-01: […]). Entering the talk is
  // ONE gesture, not a purpose choice followed by an arming. LIVE is armed
  // here rather than left to the purpose ack because setPurpose early-returns
  // on an unchanged purpose: re-entering a sitting that was EXITed would
  // otherwise send nothing and leave the mic shut.
  const enterVoiceSitting = useCallback(() => {
    setPurpose(PURPOSE_CONVERSATION);
    setLiveArmed(true);
  }, [setPurpose]);

  // THE EXIT GESTURE (F-03): leaving the voice sitting disarms LIVE — the
  // mic path watches the module and closes the mic itself (voice:mic_close
  // is its frame to send). LIVE is disarmed HERE rather than waiting on the
  // purpose ack: the mic must go quiet on the gesture, not on a round trip.
  //
  // Purpose returns to WORK with it (changed 2026-08-01). It used to stay
  // conversation so LIVE could be re-armed separately — that intermediate
  // standing existed only to serve the two-button selector, and with one
  // button "not talking" and "working" are the same state. The being's
  // voiceSitting prompt section drops when the talk ends, which is right.
  const exitVoiceSitting = useCallback(() => {
    setLiveArmed(false);
    setPurpose(PURPOSE_WORK);
  }, [setPurpose]);

  // The being's playback read-out for the visualization layer — a flat
  // silence report when no sink exists yet (a text-only lane).
  const getPlaybackState = useCallback(
    () => (sinkRef.current ? sinkRef.current.getPlaybackState() : Object.freeze({ level: 0, active: false })),
    [],
  );

  // wsService rides along for desk surfaces that drive their own portal
  // frames (the HOUSE window's on-chain founding) — same live link, no
  // second socket.
  return { state, activeCompanion, switchCompanion, sendThought, sendRetry, sendRevision, switchTake, heldCount, editQueuedThought, sendQueuedNow, pullQueuedThought, stopThought, bargeIn: stopThought, resumeSession, newSession, voiceEnabled, toggleVoice, respondApproval, respondAsk, respondPlan, respondSeal, toolMode, setToolMode, chatMode, setChatMode, purpose, setPurpose, liveArmed, voiceSittingActive: shouldMountVoiceSitting({ purpose, liveArmed }), enterVoiceSitting, exitVoiceSitting, getPlaybackState, wsService };
};
