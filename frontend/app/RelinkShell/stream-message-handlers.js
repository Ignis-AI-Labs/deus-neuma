// stream-message-handlers.js — the stream's INBOUND portal frames.
//
// impure host: applies pure frame decisions through sounds, dispatch,
// sinks and session bookkeeping. Translation lives in stream-*-actions (#376).
// Returns [channel, handler] entries; the hook's one subscription
// effect loops them onto the portal and off again on teardown.

import { thinkingActions, speechActions, completionActions, providerRetryAction, substrateLineAction } from './stream-turn-actions.js';
import { streamVoiceAction } from './stream-voice-actions.js';
import { streamCardAction } from './stream-card-actions.js';
import { heldWordAcks } from './held-word.js';
import { playSound } from '../../services/sound-engine.js';
import { soundAct } from '../../services/act-sound.js';
import { runLinkHistoryLoad } from './stream-link-history.js';
import { isWitness } from './house-members.js';
import { reconnectFrames, streamSession, resumedSession, lifecycleAction } from './stream-lifecycle-actions.js';
import { feedHeard } from './voice-purpose-state.js';
import { isNewProjectChat } from './project-space.js';
import { focusProject } from './desk-focus.js';
import { announceFileChange } from './files-refresh.js';
import { announceCampaignChange } from './campaign-refresh.js';
import { shouldAnnounceStorage } from './storage-warning.js';
import { TOOL_MODES, CHAT_MODES } from './stream-preferences.js';
import { isBootActive } from '../Opening/opening-state.js';

export const createStreamHandlers = ({
  wsService, dispatch, flushSpeech, ensureFilter, ensureSink, applyPurpose,
  setHeldCount, setToolModeState, setChatModeState, sendThought, portalFocusFrame,
  houseRef, focusRef, projectsRef, onProjectChatCreatedRef, projectChatSeenRef,
  storageWarningRef, companionRef, navigationSeqRef, transitioningRef, filterRef,
  streamSeenRef, historyLoadedRef, currentTakeRef, erroredRef, connectedRef,
  turnStartedRef, voiceGenRef, voiceGenFloorRef, lastVoiceTurnRef, cutVoiceTurnRef,
  toolModeRef, chatModeRef, voiceEnabledRef, purposeRef, historyReadyRef, historyFailedRef,
}) => {
  const dispatchAfterSpeech = (action) => {
    if (transitioningRef.current) return;
    flushSpeech();
    dispatch(action);
  };
  // THE THOUGHT BUBBLE — its own frame, deliberately NOT consciousness:stream.
  // It never touches the speech path, the voice chain, or the retry guard: a
  // being that only thinks has not started answering yet, so the composing
  // placeholder is left standing and nothing about the turn's state moves.
  const onThinking = (data) => {
    if (transitioningRef.current) return;
    for (const action of thinkingActions(data, currentTakeRef.current, Date.now())) dispatch(action);
  };

  const onStream = (data) => {
    if (transitioningRef.current) return;
    const frame = speechActions(data, { seen: streamSeenRef.current, witness: isWitness(companionRef.current) });
    // Preserve stamp-before-start ordering so even a failed first frame is retryable.
    if (frame.take) currentTakeRef.current = frame.take;
    if (frame.stamp) dispatch(frame.stamp);
    if (frame.first) {
      streamSeenRef.current = true;
      dispatch(frame.start);
    }
    if (frame.error) {
      if (filterRef.current) {
        filterRef.current.flush();
        filterRef.current = null;
      }
      flushSpeech();
      erroredRef.current = true;
      if (frame.health) dispatch(frame.health);
      playSound('desyncGlitch');
      dispatch(frame.failure);
      return;
    }
    if (frame.health) dispatch(frame.health);
    // No chime here: the typing bed (StreamingSpeech → typing-sound.js)
    // plays for exactly as long as characters are appearing on screen —
    // the one-shot it replaces died out mid-response.
    ensureFilter().push(frame.content);
  };
  const onComplete = (data) => {
    if (transitioningRef.current) return;
    // A finished turn consumes one held word — the portal drains them in
    // order, so the count walks down as they are spoken.
    setHeldCount((n) => (n > 0 ? n - 1 : 0));
    if (filterRef.current) {
      filterRef.current.flush();
      filterRef.current = null;
    }
    flushSpeech();
    streamSeenRef.current = false;
    // A failed turn already glitched — it must not also chime success.
    if (erroredRef.current) erroredRef.current = false;
    else playSound('replyArrived');
    // Server truth: the session this exchange landed in (the first message
    // of a fresh chat mints it server-side). Hold it so a reconnect resumes
    // THIS chat instead of forking a new one.
    if (data?.sessionId) {
      wsService.setSessionState(streamSession(companionRef.current, data.sessionId));
      // A chat born under an active project just got its server-minted id —
      // the backend has already pinned it to the project; refresh so it
      // appears in the project's chat list. Fires once per new id (resume /
      // new-session pre-seed the ref), never mid-conversation.
      if (isNewProjectChat(focusProject(focusRef.current, projectsRef.current), data.sessionId, projectChatSeenRef.current)) {
        onProjectChatCreatedRef.current?.();
      }
      projectChatSeenRef.current = data.sessionId;
    }
    // A turn that yielded no stream frames still names its point here —
    // the stamp is idempotent, so a turn that already stamped on its first
    // frame (or a retry, whose point is named) passes through untouched.
    for (const action of completionActions(data)) dispatch(action);
    currentTakeRef.current = null; // the turn closed — the next stream re-stamps
  };
  const onTool = (data) => {
    // A being's hands are audible: each family of act has its own voice, and
    // an act that did NOT happen says so (services/act-sound-map.js). Handed
    // every frame — it decides for itself which ones warrant a cue.
    soundAct(data);
    if (data.status === 'executing') { dispatchAfterSpeech(lifecycleAction('tool:usage', data)); return; }

    // A being that changed the operator's ground must be VISIBLE in the
    // Explorer without a remount — the tree re-lists the directory it
    // touched. No-op for reads and refusals (files-refresh.js decides).
    announceFileChange(data);
    // …and a being that declared or edited a campaign must be visible on the
    // campaign board the same way. Without this the board kept saying
    // "No campaigns yet" over a campaign the operator had just created.
    announceCampaignChange(data);
    dispatchAfterSpeech(lifecycleAction('tool:usage', data));
  };
  // impure — preserve sound-before-flush ordering while translation stays pure.
  const cardHandler = (channel) => (data) => {
    const frame = streamCardAction(channel, data, companionRef.current?.neumaId || null);
    if (!frame) return;
    if (frame.sound) playSound(frame.sound);
    dispatchAfterSpeech(frame.action);
  };
  // The portal acked (or corrected) the declared tool mode — server truth.
  const onToolMode = (data) => {
    if (!TOOL_MODES.includes(data.mode)) return;
    toolModeRef.current = data.mode;
    setToolModeState(data.mode);
  };
  // The portal acked (or corrected) the declared CHAT mode — server truth.
  // Also fires when a plan verdict flips the mode (ACCEPT → DEFAULT / AUTO):
  // the desk never shows a mode the portal isn't holding.
  const onChatMode = (data) => {
    if (!CHAT_MODES.includes(data.mode)) return;
    chatModeRef.current = data.mode;
    setChatModeState(data.mode);
  };
  // The portal acked (or corrected) the declared sitting purpose — server
  // truth, same contract as tool:mode. Unknown values already failed closed
  // to 'work' server-side; the ack is what the desk shows.
  const onSessionPurpose = (data) => applyPurpose(data?.purpose);
  // How many turns the ONE local substrate carries right now, across every
  // desk (B-01 broadcast, counted per class server-side) — only the LOCAL
  // count may feed the SHARED reading; third-party turns are normal and
  // are never the substrate's load.
  const onSubstrateActivity = (data) =>
    dispatch(lifecycleAction('substrate:activity', data));
  // The named being has no lane under the active workspace root — the
  // portal refused to bind it (shadow-lane guard). Shown as a stream
  // error so the operator knows they are NOT speaking with the being's
  // anchored identity until the workspace home is corrected.
  const onLaneMissing = (data) => {
    transitioningRef.current = false;
    playSound('desyncGlitch');
    dispatch(lifecycleAction('companion:lane_missing', data));
  };
  // The named being belongs to another operator — the portal refused the
  // bind (WS ownership gate). Same honest in-stream treatment as a missing
  // lane: the operator must know they are NOT anchored.
  const onNotYours = (data) => {
    transitioningRef.current = false;
    playSound('desyncGlitch');
    dispatch(lifecycleAction('companion:not_yours', data));
  };
  // Disk headroom under the workspace home is shrinking (heartbeat watch).
  // The machine's disk is the MACHINE's news: announced into the transcript
  // it read as though the being had said it, and entered the conversation's
  // history. It belongs on the desk's announcement lane, which the backend
  // mints a record onto (broadcastStorageWarning) — the tray shows it, and
  // it survives a restart like every other notification.
  //
  // The throttle stays here and stays UNCHANGED — `shouldAnnounceStorage` is
  // the anti-spam guard against a per-heartbeat repeat, and it is what keeps
  // the sound from firing on every beat. Only the destination moved.
  const onStorageWarning = (data) => {
    if (!houseRef.current) return;
    if (!shouldAnnounceStorage(storageWarningRef.current, data)) return;
    storageWarningRef.current = data;
    if (data?.level === 'critical') playSound('desyncGlitch');
  };
  // THE HELD WORD (Design note, 2026-08-16, held-word.js): four acks, SERVER truth.
  const heldAcks = heldWordAcks({ dispatch, setHeldCount });
  // THE RETRY LADDER, visible (Design note, 2026-07-28: […]): a transient overload shows as a quiet note that UPDATES
  // per attempt — never nine messages, never an alarm.
  const onProviderRetry = (data) => {
    dispatch(providerRetryAction(data, Date.now()));
  };
  // THE LINE, visible (ruling, 2026-10-12): waiting its turn for the house's model, and who is ahead.
  const onWatchFired = (data) => {
    if (typeof data?.text === 'string' && data.text) dispatch({ type: 'WATCH_FIRED', text: data.text, at: data.at ?? Date.now() });
  };
  const onSubstrateLine = (data) => {
    dispatch(substrateLineAction(data, Date.now()));
  };
  const onLinkUp = () => {
    // Tool stance precedes chat mode: the latter sets the server's ACTS tier.
    for (const [channel, data] of reconnectFrames({
      toolMode: toolModeRef.current, chatMode: chatModeRef.current,
      voiceEnabled: voiceEnabledRef.current, purpose: purposeRef.current,
    })) wsService.send(channel, data);
    // 'connection' and 'portal:resumed' both fire on one reconnect — chime
    // once, only on a real down -> up transition.
    //
    // A QUIET PORTAL NEVER CHIMES. Every tab past the first runs its own
    // socket (TabPortalHost, #407) and connects on its FIRST FOCUS, so this
    // fired on a plain tab switch: […] (ruling, 2026-08-29).
    //
    // The badge was already silenced for these portals in August; the chime
    // lives here and was missed, so the announcement only changed senses. The
    // desk's own link still sounds — that one IS the operator arriving.
    // Except under the opening: the boot owns every sound while it plays
    // (its rows declare the link), and this chime used to land at a random
    // moment beneath it, before the first tick (audit 2026-09-25).
    if (!connectedRef.current) {
      connectedRef.current = true;
      if (!wsService.isQuiet?.() && !isBootActive()) playSound('portalContact');
    }
    dispatch(lifecycleAction('connection'));
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    const target = companionRef.current;
    const navigationSeq = navigationSeqRef.current;
    // The gate promise the sends wait on (D5) and the fail-loud retry/hold
    // law live in stream-link-history.js — one module, one job.
    historyReadyRef.current = runLinkHistoryLoad({
      wsService, dispatch, portalFocusFrame, companionRef, navigationSeqRef,
      turnStartedRef, projectChatSeenRef, focusRef, projectsRef, historyFailedRef,
      target, navigationSeq,
    });
  };
  const onPortalResumed = (data) => {
    transitioningRef.current = false;
    streamSeenRef.current = false;
    const session = resumedSession(data, companionRef.current);
    if (session) wsService.setSessionState(session);
    onLinkUp();
  };
  const onSessionReset = () => {
    transitioningRef.current = false;
    streamSeenRef.current = false;
    wsService.setSessionState(streamSession(companionRef.current, null));
  };
  const onCompanionAnchored = () => { transitioningRef.current = false; };
  const onLinkDown = () => {
    if (connectedRef.current) { connectedRef.current = false; playSound('portalSever'); }
    dispatch(lifecycleAction('disconnection'));
  };
  // The neuma's spoken voice: each audio frame to the sink, in-order
  // gapless playback (no voice:end handler — playback self-corrects).
  // THE CUT TURN STAYS CUT. Kokoro answers a sentence in one burst, so on a
  // barge-in its bytes are usually already on the wire — the sink stopped
  // what was sounding, then played the remainder over the new answer ([…]). The frame carries its turn, so a cut turn is
  // refused for good rather than merely silenced for a moment.
  const onVoiceAudio = (data) => {
    const frame = streamVoiceAction('voice:audio', data, { cutTurn: cutVoiceTurnRef.current });
    if (!frame) return;
    if (frame.turnId) lastVoiceTurnRef.current = frame.turnId;
    ensureSink().pushAudio(data);
  };

  // --- live voice sitting frames (SPEECH SYSTEM, Phase A client half) ----
  // The streaming mic lane's inbound frames. GEN DISCIPLINE (control #6,
  // client mirror): frames carry the sitting's generation; anything older
  // than the local drop floor (stopThought raises it on barge-in) is stale
  // and never renders. The backend emits NO voice:cancel and voice:audio
  // carries no gen — sink-side the drop IS the barge-in interrupt, and the
  // transcript lane then refuses the stale tail.
  const onVoiceMicOpen = (data) => {
    const frame = streamVoiceAction('voice:mic_open', data);
    voiceGenRef.current = frame.generation;
    voiceGenFloorRef.current = frame.floor;
  };
  const onVoiceSpeechMarker = (data) => {
    // speech_started / speech_stopped carry gen truth but no display work
    // (the local VAD already drove the barge-in UX; F-04's turn-state reads
    // these when it lands).
    const frame = voiceFrame('voice:speech_started', data);
    if (frame) voiceGenRef.current = frame.generation;
  };
  const voiceFrame = (channel, data) => streamVoiceAction(channel, data, {
    generation: voiceGenRef.current, floor: voiceGenFloorRef.current,
  });
  const onVoicePartial = (data) => {
    const frame = voiceFrame('voice:partial', data);
    if (!frame) return;
    voiceGenRef.current = frame.generation;
    dispatch(frame.action);
    // The sitting owns the whole window and the chat under it is hidden,
    // so this seam is the only place the witness can see his own words.
    feedHeard(frame.heard, false);
  };
  const onVoiceUtterance = (data) => {
    const frame = voiceFrame('voice:utterance', data);
    if (!frame) {
      // NEVER SILENTLY. Dropping a finished utterance means the witness
      // spoke, the sidecar decoded him, and nothing happened — the failure
      // he cannot see and cannot debug. If the floor is ever wrong again,
      // this line says so with both numbers.
      console.warn('[voice] utterance DROPPED as stale — the witness spoke and nothing was sent',
        { frameGen: data?.gen, floor: voiceGenFloorRef.current });
      return;
    }
    voiceGenRef.current = frame.generation;
    feedHeard(frame.heard, true);   // settled: this is what was sent
    // The transient partial retires, then the words enter as an ORDINARY
    // thought — the same path typing takes (USER_SENT + stream frame), so
    // identity, memory, and routing stay untouched and the words land
    // exactly once (no server-side user echo for a voice utterance —
    // portal-voice-stream test shape — this send is the only bubble).
    dispatch(frame.action);
    if (frame.thought) sendThought(frame.thought);
  };
  const onVoiceError = (data) => {
    // degrade:'text' — the sitting keeps working as a plain text sitting
    // and says so honestly in-stream; use-live-voice stands the mic down.
    dispatch(streamVoiceAction('voice:error', data).action);
  };

  // onLinkUp rides along: the hook fires it directly when the portal is
  // already live before the stream mounts (post-ceremony).
  return { onLinkUp, entries: [
    ['consciousness:thinking', onThinking],
    ['consciousness:stream', onStream],
    ['consciousness:complete', onComplete],
    ...Object.entries(heldAcks),
    ['consciousness:provider-retry', onProviderRetry],
    ['substrate:line', onSubstrateLine],
    ['watch:fired', onWatchFired],
    // A /compact, drawn in the thread where it happened (compact-marker.js).
    ['session:compact', (frame) => dispatch({ type: 'COMPACT', frame, at: new Date().toISOString() })],
    ['tool:usage', onTool],
    ['tool:approval_request', cardHandler('tool:approval_request')],
    ['tool:approval_resolved', cardHandler('tool:approval_resolved')],
    ['operator:ask', cardHandler('operator:ask')],
    ['operator:ask_resolved', cardHandler('operator:ask_resolved')],
    ['operator:plan', cardHandler('operator:plan')],
    ['operator:plan_resolved', cardHandler('operator:plan_resolved')],
    ['seal:self_offer', cardHandler('seal:self_offer')],
    ['seal:self_resolved', cardHandler('seal:self_resolved')],
    ['operator:team_start', cardHandler('operator:team_start')],
    ['operator:team_board', cardHandler('operator:team_board')],
    ['operator:team_done', cardHandler('operator:team_done')],
    ['operator:team_torch', cardHandler('operator:team_torch')],
    ['tool:mode', onToolMode],
    ['chat:mode', onChatMode],
    ['session:purpose', onSessionPurpose],
    ['substrate:activity', onSubstrateActivity],
    ['companion:lane_missing', onLaneMissing],
    ['companion:not_yours', onNotYours],
    ['storage:warning', onStorageWarning],
    ['voice:audio', onVoiceAudio],
    ['voice:mic_open', onVoiceMicOpen],
    ['voice:speech_started', onVoiceSpeechMarker],
    ['voice:speech_stopped', onVoiceSpeechMarker],
    ['voice:partial', onVoicePartial],
    ['voice:utterance', onVoiceUtterance],
    ['voice:error', onVoiceError],
    ['connection', onLinkUp],
    ['portal:resumed', onPortalResumed],
    ['portal:session-reset', onSessionReset],
    ['companion:anchored', onCompanionAnchored],
    ['disconnection', onLinkDown],
  ] };
};
