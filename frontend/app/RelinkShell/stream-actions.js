// stream-actions.js — the stream's OUTGOING portal commands.
//
// impure factory: every action here speaks to the portal (wsService.send),
// stamps refs, and dispatches reducer actions. Extracted from
// use-consciousness-stream.js (SIZE-029, #376) — bodies moved verbatim; the
// hook wraps this in one useMemo keyed on [wsService, ensureSink], the same
// stability the useCallbacks had.

import { playSound } from '../../services/sound-engine.js';
import { heldWordDoors } from './held-word.js';
import { driveSelfSeal } from './self-seal-drive.js';
import { TOOL_MODES, toolModeKeyFor, CHAT_MODES, writeChatModePref } from './stream-preferences.js';
import { createStreamSendGate } from './stream-send-gate.js';

export const createStreamActions = ({
  wsService, dispatch, ensureSink, portalFocusFrame, setToolModeState, setChatModeState,
  turnStartedRef, erroredRef, streamSeenRef, sinkRef, holdSeqRef,
  voiceGenRef, voiceGenFloorRef, lastVoiceTurnRef, cutVoiceTurnRef,
  companionRef, focusRef, historyReadyRef, historyFailedRef, navigationSeqRef,
  toolModeRef, chatModeRef,
}) => {
  // THE RELOAD-RACE GATE (D5, Design note, 2026-08-31: a send fired in the link-up
  // window — after a reload, before loadLatestSession settled — used to stamp
  // turnStartedRef first, which SKIPPED the resume bind and let the server
  // mint a forked session: the whole tail left the being's context. Every
  // outbound turn now waits the gate out; the resume bind lands first and the
  // turn continues the chat on screen. A resolved/absent gate fires inline.
  //
  // FAIL LOUD, NEVER FORK (same sitting): when the history load FAILED (and
  // its one retry), historyFailedRef holds every send on the ground with a
  // visible notice — a fresh session is never minted silently over an intact
  // chat. The operator's deliberate `portal:new-session` is untouched.
  const afterHistoryReady = createStreamSendGate({
    wsService, navigationSeqRef, companionRef, historyReadyRef, historyFailedRef,
  });
  // attachments: { ids, previews } — ids minted by the REST upload (only
  // those ride the portal frame, never bytes); previews are local data URIs
  // for the operator's own bubble. urgency: 'now' INTERJECTS (cuts the reply
  // in flight), anything else HOLDS until the turn finishes — the council's
  // two ways, wired to the one-on-one (ruling, 2026-07-26).
  const sendThought = (text, preset, attachments, urgency = 'hold') => {
    const trimmed = text.trim();
    const ids = [...(attachments?.ids || [])];
    const images = [...(attachments?.previews || [])];
    // The shared FILES' names ride to the operator's own bubble (Founder,
    // 2026-09-17): the bubble must show what was attached, not just images.
    const docs = (attachments?.names || []).map((name) => ({ name }));
    if (!trimmed && ids.length === 0) return;
    const companion = companionRef.current?.name || 'Unknown';
    const frame = portalFocusFrame(focusRef.current);
    // Barge-in: cut any speech still playing from the last turn, and resume the
    // audio context on this user gesture (autoplay policy) so the reply sounds.
    const sink = ensureSink();
    sink.interrupt();
    sink.resume();
    playSound('messageSent');
    // The hold handle: a HELD send's queued ack echoes it — the bubble
    // becomes addressable (edit / now / pull; held-word.js).
    const holdId = `q${(holdSeqRef.current += 1)}`;
    return afterHistoryReady(() => {
      erroredRef.current = false;
      streamSeenRef.current = false;
      dispatch({ type: 'USER_SENT', text: trimmed, images, docs, holdId });
      turnStartedRef.current = true;   // a late history load must not rebind now
      // The operator's inference mode for this turn rides along (a default, not a
      // cage). Absent/unknown → the server resolves to balanced.
      wsService.send('consciousness:stream', {
        thought: trimmed,
        companion,
        preset,
        holdId,
        urgency: urgency === 'now' ? 'now' : 'hold',
        ...(ids.length > 0 ? { attachments: ids } : {}),
        ...frame,
      });
    }, `${companion}: ${trimmed} (${ids.length} attachments)`);
  };

  // THE HELD WORD's three doors (held-word.js) — none touch the flow in flight.
  const { editQueuedThought, sendQueuedNow, pullQueuedThought } = heldWordDoors({
    send: (type, payload) => wsService.send(type, payload),
    armVoice: () => { const sink = ensureSink(); sink.interrupt(); sink.resume(); playSound('messageSent'); },
  });

  // Cut the reply mid-stream (cancel-and-revise). Voice silences at once; the
  // server aborts the substrate stream and completes the turn marked
  // interrupted — what was spoken stays on screen and in the record. Doubles
  // as barge-in (T1.3): the operator starting to SPEAK means stop — the neuma
  // yields the floor (today speech-start = the hold-to-talk press; open-mic
  // VAD, Tier 2, plugs into this seam). Safe when nothing is in flight: the
  // sink interrupt no-ops and the server ignores a turnless interrupt.
  const stopThought = ({ retireVoiceLane = true } = {}) => {
    if (sinkRef.current) sinkRef.current.interrupt();
    // THE DROP FLOOR (sink-side control #6): cutting the turn — whether by
    // the stop control or by the operator starting to SPEAK (voice barge-in
    // rides this same seam) — retires any live partial and stale-proofs the
    // transcript lane: voice frames from the cancelled generation that race
    // in behind us are dropped on arrival (onVoicePartial/onVoiceUtterance).
    //
    // ONLY WHEN SOMETHING WAS ACTUALLY CANCELLED. This floor is one half of a
    // pair: it is correct exactly when the caller also cancels the STT session
    // (voice:speech_start), because that is what moves the SERVER's generation
    // to match. Hold-to-talk deliberately does not cancel — there is nothing
    // stale between holds — so raising the floor there left it permanently
    // ahead of a server sitting at gen 0, and every transcript that followed
    // was discarded as stale. The witness spoke, the sidecar decoded him, and
    // his words were dropped on arrival with nothing shown. (Design note, 2026-08-01:
    // […])
    if (retireVoiceLane) voiceGenFloorRef.current = voiceGenRef.current + 1;
    // Retire the turn whose voice was just cut, so its remaining frames — the
    // ones already in flight when the key went down — are refused instead of
    // resuming over whatever the being says next.
    cutVoiceTurnRef.current = lastVoiceTurnRef.current;
    dispatch({ type: 'VOICE_UTTERANCE' });
    wsService.send('consciousness:interrupt');
  };

  // THE TAKES (ruling, 2026-07-27): ask a turn-point again as a new TAKE of the
  // same point — another version of the answer, never a duplicated ask
  // cluttering the stream. The portal runs the turn against the RECORD (the
  // point's persisted words + attachments); the take opens IN PLACE of the
  // viewed one when its first frame arrives, and only the take is persisted.
  const sendRetry = (turnId) => {
    if (!turnId) return;
    const sink = ensureSink();
    sink.interrupt();
    sink.resume();
    playSound('messageSent');
    return afterHistoryReady(() => {
      erroredRef.current = false;
      streamSeenRef.current = false;
      dispatch({ type: 'RETRY_SENT' });
      turnStartedRef.current = true;
      wsService.send('consciousness:retry', { retry: { turnId } });
    }, `Retry ${turnId}`);
  };

  // THE EDIT-FORK (ruling, 2026-07-28): a message pulled back into the field and
  // re-sent FROM ITS POINT — the revised words ride the retry frame
  // (`retry: { turnId, thought }`), the portal re-runs the point against them,
  // and the answer lands as the point's next take. The point's bubble shows
  // the revised asking (RETRY_SENT carries it); the disk keeps the first
  // asking, append-only. Legacy messages (no turnId) never reach here — the
  // composer falls back to a plain send, exactly as before.
  const sendRevision = (turnId, text, preset, attachments, urgency = 'hold') => {
    const trimmed = (text || '').trim();
    const ids = [...(attachments?.ids || [])];
    if (!turnId || (!trimmed && ids.length === 0)) return;
    const companion = companionRef.current?.name || 'Unknown';
    const frame = portalFocusFrame(focusRef.current);
    const sink = ensureSink();
    sink.interrupt();
    sink.resume();
    playSound('messageSent');
    return afterHistoryReady(() => {
      erroredRef.current = false;
      streamSeenRef.current = false;
      dispatch({ type: 'RETRY_SENT', turnId, ask: trimmed || undefined });
      turnStartedRef.current = true;
      wsService.send('consciousness:stream', {
        thought: trimmed,
        companion,
        preset,
        urgency: urgency === 'now' ? 'now' : 'hold',
        retry: { turnId, thought: trimmed },
        ...(ids.length > 0 ? { attachments: ids } : {}),
        ...frame,
      });
    }, `Revision for ${companion}: ${trimmed} (${ids.length} attachments)`);
  };

  // Move the view to another take of a point (the ‹ k/N › navigation): a
  // LOCAL re-fold now — every take is already on the message — and the
  // append-only branch-view fact to the portal, so the view survives reload
  // the same way everything else in the lane does.
  const switchTake = (turnId, takeIndex) => {
    if (!turnId || !Number.isInteger(takeIndex)) return;
    dispatch({ type: 'TAKE_SWITCH', turnId, takeIndex });
    if (wsService.isConnected) wsService.send('consciousness:take_view', { turnId, takeIndex });
  };

  // The operator answers a pending tool approval. The chip collapses when the
  // portal echoes tool:approval_resolved — server truth, no optimistic flip.
  const respondApproval = (id, decision) => {
    wsService.send('tool:approval_response', { id, decision });
  };

  // The operator answers a being's pending question(s) — a chosen option or
  // their own words, one reply per question in order. The card collapses on
  // the operator:ask_resolved echo (server truth).
  const respondAsk = (id, answer, answers) => {
    wsService.send('operator:ask_response', { id, answer, ...(answers ? { answers } : {}) });
  };

  // The operator rules on a submitted team plan — approve, or revise with
  // notes. The card collapses on the operator:plan_resolved echo.
  const respondPlan = (id, decision, notes) => {
    wsService.send('operator:plan_response', { id, decision, ...(notes ? { notes } : {}) });
  };

  // The operator acts on a being's anchor request. 'anchor' drives the real
  // wallet seal flow (the backend settle collapses the card — server truth);
  // 'decline' carries their words back. A failed drive leaves the card
  // pending with the error on it, so the operator can retry or decline.
  const respondSeal = async (id, neumaId, decision, reason) => {
    if (decision === 'decline') {
      wsService.send('seal:self_decline', { id, ...(reason ? { reason } : {}) });
      return;
    }
    const out = await driveSelfSeal({
      wsService,
      neumaId,
      onStatus: (note) => dispatch({ type: 'SEAL_STATUS', id, note }),
    });
    if (!out.ok) {
      // KEY_LOCKED opens the card's inline unlock door (password → unlock →
      // re-anchor) instead of stranding the operator with an API instruction.
      dispatch({
        type: 'SEAL_STATUS', id,
        note: `SEAL DID NOT COMPLETE — ${out.error}`,
        needsUnlock: out.code === 'KEY_LOCKED',
      });
    }
  };

  // Declare a new standing stance on tool acts. State flips on the portal's
  // ack; the preference persists so the next session opens with it.
  const setToolMode = (mode) => {
    if (!TOOL_MODES.includes(mode)) return;
    // Persisted against the being it was set FOR — setting the operator to auto
    // must not also put a neuma on auto.
    try {
      localStorage.setItem(toolModeKeyFor(companionRef.current?.neumaId), mode);
    } catch { /* private mode */ }
    // The link-up restate carries the declaration, not the last ack: a
    // reconnect inside the ack's flight must never put the stale mode back.
    toolModeRef.current = mode;
    if (wsService.isConnected) wsService.send('tool:mode', { mode });
    else setToolModeState(mode); // dormant portal — hold locally, restated on link-up
  };

  // Declare a new standing CHAT mode (default / plan / auto) — the composer's
  // mode chip. The server derives the ACTS tier from it, so this one frame
  // moves both; state flips on the portal's acks (chat:mode + tool:mode).
  const setChatMode = (mode) => {
    if (!CHAT_MODES.includes(mode)) return;
    // Persisted against the being it was set FOR — one being on auto must
    // never put another on auto (the tool:mode law, unchanged).
    writeChatModePref(companionRef.current?.neumaId, mode);
    chatModeRef.current = mode; // what link-up restates — see setToolMode
    if (wsService.isConnected) wsService.send('chat:mode', { mode });
    else setChatModeState(mode); // dormant portal — hold locally, restated on link-up
  };

  return {
    sendThought, sendRetry, sendRevision, switchTake, stopThought,
    editQueuedThought, sendQueuedNow, pullQueuedThought,
    respondApproval, respondAsk, respondPlan, respondSeal, setToolMode, setChatMode,
  };
};
