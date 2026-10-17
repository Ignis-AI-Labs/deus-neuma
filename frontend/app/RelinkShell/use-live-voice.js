// use-live-voice.js — impure: the open mic. LIVE mode for natural conversation.
//
// SIZE EXCEPTION: the mic is one temporal unit. Everything here — the 50 ms
// ref-farm pump, the VAD feed, the pre-roll ring, barge-in, and the
// MediaRecorder/worklet paths — shares one set of refs on one real-time
// clock, and every closer must see every ref to honor the honest-mic law
// (never hot without a live sitting). Cutting it apart means threading a
// dozen mutable refs across module seams on a sub-100 ms path: subdivision
// genuinely loses. Ruled by Design note, 2026-08-26 (size-law finalize session):
// exception over extraction.
//
// TWO paths, chosen by the sitting's declared purpose (server truth, held in
// the stream-reducer's state.purpose and passed down as a prop):
//
//   conversation (streaming — SPEECH SYSTEM Phase A / F-01):
//     mic_open over the portal → the AudioWorklet pump (voice-mic-worklet.js)
//     streams 16 kHz s16le PCM continuously → server VAD owns endpointing and
//     whisper partials/finals come back as voice:* frames (rendered by
//     use-consciousness-stream). The client VAD (voice-activity.js) keeps ONE
//     job: INSTANT local barge-in — speech-start fires onSpeechStart (the
//     sink yields sub-100 ms) and sends voice:speech_start in the same breath.
//
//   work (legacy, byte-identical to before the stream lane):
//     the AnalyserNode RMS pump drives the VAD, speech-end closes a
//     MediaRecorder utterance, the blob transcribes through the whisper
//     sidecar and onUtterance(text) sends it.
//
// Echo discipline: getUserMedia asks for echoCancellation + noiseSuppression +
// autoGainControl, and prefers an OS-level echo-cancelled source when the
// system offers one (preferredInputDevice).
//
// Do not trust browser AEC to carry this alone. It subtracts a filtered copy
// of what was PLAYED from what the mic HEARS, which models delay and room
// response — both linear. It cannot model a pitch shift, and this desk's
// default output sink is a PipeWire filter chain retuning everything down
// 31.77 cents (440→432 Hz): the echo arriving at the mic is at a different
// pitch than the reference, so cancellation is defeated by construction.
// Separate capture and render hardware on independent clocks compounds it.
// Headphones remove the acoustic path entirely, which is why they always work.
//
// This is why hold-to-talk is the default rather than a preference.
//
// Honest-mic law: the mic closes on toggle-off, on portal disconnect, on
// purpose exit, and on unmount — never hot without a live sitting behind it.
//
// States: off → opening → listening → capturing → listening…  (error on
// grant failure or a voice:error the sitting cannot survive)

import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribe, warmTranscriber } from './stt-client.js';
import { holdsPushToTalkKey } from './dictation.js';
import {
  createVadState, feedVad, frameRms, micGateOpen, isWitnessSpeaking, preferredInputDevice,
} from './voice-activity.js';
import { feedMicLevel, feedMicDevice, feedMicState } from './voice-purpose-state.js';
import {
  WORKLET_NAME, createWorkletUrl, createPcmFramer,
  downsampleTo16k, floatToS16le, bytesToBase64,
} from './voice-mic-worklet.js';

const PUMP_MS = 50;           // VAD sample cadence
const MIN_AUDIO_BYTES = 2048; // header-only container = nothing was said
// 100 ms frames held while the mic pipe is closed, so a barge-in's opening
// syllables survive the VAD's confirm window (120 ms) plus a pump tick. Four
// is ~400 ms: enough to cover the decision, short enough that reopening never
// dumps a reply's worth of room tone into whisper.
const PREROLL_FRAMES = 4;
// How long the mic pipe stays shut after the sink stops reporting activity.
// The sink's own window (350 ms) runs from when a frame was SCHEDULED, and it
// schedules ahead of real time — so the room can still be sounding when that
// window closes. This covers the queue's tail and the room's ring-out. It
// never delays a barge-in: the VAD runs on every frame regardless of the gate,
// and a witness who speaks reopens the pipe immediately with the pre-roll.
const ECHO_TAIL_MS = 600;

export const useLiveVoice = ({
  connected = true, purpose = 'work', wsService = null,
  onSpeechStart, onUtterance,
  // The being's live playback read-out — { level, active }. `level` raises the
  // VAD's bar so the being cannot trigger its own barge-in; `active` closes
  // the mic pipe entirely so whisper never sees the being at all.
  // Absent → silent → the detector and the pipe behave exactly as before.
  getPlaybackState = null,
  // PUSH TO TALK (Design note, 2026-08-01: […]). The mic GRANT stays open
  // the whole sitting — only the pipe opens and closes — so a hold costs no
  // permission round trip and the OS indicator tells the truth about a live
  // mic. Nothing reaches whisper unless the key is down, which is why this
  // sidesteps echo and silence-hallucination entirely rather than fighting
  // them: when the being speaks, the witness is not holding the key.
  pushToTalk = false,
}) => {
  const [live, setLive] = useState(false);
  const [state, setState] = useState('off'); // off | opening | listening | capturing | transcribing | error
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const pumpRef = useRef(null);
  const recorderRef = useRef(null);
  // The streaming path's worklet node + PCM framer (null in the legacy path).
  const workletRef = useRef(null);
  const framerRef = useRef(null);
  // Whether the portal acked voice:mic_open — PCM flows only behind the ack.
  const micOpenRef = useRef(false);
  // Which path the CURRENT live session runs on ('stream' | 'blob'), so async
  // callbacks built before a purpose change still act on the right one.
  const modeRef = useRef('blob');
  // Whether the CURRENT utterance was ruled a blip ('drop') by the VAD. One
  // recorder exists at a time, so a single ref carries the verdict from the
  // pump to the async onstop.
  const droppedRef = useRef(false);
  const liveRef = useRef(false);
  // Callbacks + collaborators in refs so the pump never has to be rebuilt
  // mid-session.
  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;
  const playbackStateRef = useRef(getPlaybackState);
  playbackStateRef.current = getPlaybackState;
  // When the being's audio was last known to be sounding. The sink reports
  // `active` from when a frame was SCHEDULED, and it schedules ahead of real
  // time — so its window closing does not mean the room has gone quiet. This
  // carries the pipe past the queue's tail and the room's own ring-out.
  const lastPlaybackAtRef = useRef(0);
  // THE MIC PIPE, gated on the echo bar (voice-activity.micGateOpen). Open by
  // default: with no playback this is always true and the lane behaves exactly
  // as it did. Closed only while the being is sounding and the witness is not.
  const pcmGateRef = useRef(true);
  // Frames captured while the pipe was closed, held so the OPENING of a
  // barge-in is not clipped: the VAD needs confirmMs to be sure, and those
  // first syllables are already past by then. Real captured samples, delayed —
  // never fabricated, never zero-filled (the framer's law, kept here too).
  const prerollRef = useRef([]);
  const pushToTalkRef = useRef(pushToTalk);
  pushToTalkRef.current = pushToTalk;
  // Whether the witness is holding the key RIGHT NOW. A ref, not state: the
  // pump reads it every 50 ms and must never wait on a re-render.
  const holdingRef = useRef(false);
  const wsRef = useRef(wsService);
  wsRef.current = wsService;
  // The streaming path arms ONLY in a declared conversation with a live
  // portal service behind it — anything else fails closed to the legacy path.
  const streamingRef = useRef(false);
  streamingRef.current = purpose === 'conversation' && !!wsService;

  const teardown = useCallback(() => {
    clearInterval(pumpRef.current);
    pumpRef.current = null;
    const rec = recorderRef.current;
    recorderRef.current = null;
    try { if (rec && rec.state === 'recording') rec.stop(); } catch { /* already stopped */ }
    const node = workletRef.current;
    workletRef.current = null;
    framerRef.current = null;
    if (node) {
      try { node.port.onmessage = null; node.disconnect(); } catch { /* already gone */ }
    }
    // Honest-mic: an open sitting is closed at the portal before the hardware
    // goes quiet — but only over a live socket (a dead one killed the session
    // server-side already, and a queued close would flush into the NEXT one,
    // where it is a harmless no-op anyway).
    if (micOpenRef.current && wsRef.current?.isConnected) {
      wsRef.current.send('voice:mic_close');
    }
    micOpenRef.current = false;
    // Held frames belong to the sitting that captured them; a later sitting
    // must never open by replaying the last one's room. The gate reopens so a
    // fresh mic starts in the ordinary always-send standing.
    prerollRef.current = [];
    holdingRef.current = false;
    // Push-to-talk starts SHUT: a fresh mic must not stream until a thumb says
    // so. Open-mic starts open, as it always did.
    pcmGateRef.current = !pushToTalkRef.current;
    // The readout dies with the grant, before the tracks stop — no window in
    // which the desk names a mic that is no longer captured.
    feedMicDevice('');
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { ctxRef.current?.close(); } catch { /* best effort */ }
    ctxRef.current = null;
    setState('off');
  }, []);

  useEffect(() => () => { liveRef.current = false; teardown(); }, [teardown]);

  // PUSH TO TALK — hold Space to speak, release to send.
  //
  // The grant stays open all sitting; only the pipe moves. Press barges in
  // (the witness speaking over the being cuts it, the same gesture the open
  // mic used), and release FLUSHES: with no audio flowing the server VAD can
  // never hear the silence that would end the utterance, so the release has to
  // say so itself, or the last words sit in the decoder unspoken.
  //
  // Space is claimed only where the witness is not typing (holdsPushToTalkKey),
  // and a blur releases — a key-up that lands in another window would
  // otherwise leave the pipe open with nobody holding it.
  useEffect(() => {
    if (!pushToTalk || !live) return undefined;
    const release = () => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      // Shut the pipe HERE, not on the next 50 ms pump tick. Frames captured
      // in that gap arrive after the sidecar has finalized and become the head
      // of the NEXT utterance.
      pcmGateRef.current = false;
      // Say the turn was TAKEN, in the same breath the key comes up. The words
      // still have to be decoded, and the sitting used to read WAITING through
      // that whole gap — indistinguishable from nothing having happened.
      // Cleared when the transcript lands (or the sitting errors).
      setState('transcribing');
      if (micOpenRef.current) wsRef.current?.send('voice:flush', {});
      // The framer holds a sub-frame remainder of up to 99 ms. Carried across
      // a release it becomes the head of the next hold — the tail syllable of
      // this sentence spliced onto the front of the next one.
      framerRef.current = createPcmFramer();
      prerollRef.current = [];
    };
    const onKeyDown = (e) => {
      if (!holdsPushToTalkKey(e)) return;
      // EVERY Space keydown the lane owns, auto-repeats INCLUDED. Two defaults
      // have to die here: the scroll of the dimmed desk beneath, and — measured
      // in Chromium — the activation of whatever button still holds focus. An
      // un-prevented repeat re-arms that activation, so holding Space with TALK
      // still focused from the click that opened the sitting made the RELEASE
      // click it: the talk closed the moment the witness stopped speaking.
      e.preventDefault();
      if (e.repeat || holdingRef.current) return;   // the same hold, not a new one
      holdingRef.current = true;
      pcmGateRef.current = true;   // now, not on the next 50 ms pump tick
      setState('capturing');
      // Barge in: silence the being and abort its turn. This rides
      // consciousness:interrupt, which needs nothing from the sidecar.
      //
      // retireVoiceLane:false is load-bearing. The client's stale-frame drop
      // floor is the twin of the STT cancel below — raising it without moving
      // the server's generation leaves it permanently ahead, and every
      // transcript that follows is discarded as stale before it can be sent.
      onSpeechStartRef.current?.({ retireVoiceLane: false });
      // NOT voice:speech_start. That cancels the STT session — bumping its
      // generation and resetting the decoder — and every press paid for it:
      // the reset opens a window during which the release's flush has to WAIT
      // (and, before it was latched, was dropped outright, losing the whole
      // hold). Under hold-to-talk there is nothing stale to reset: no audio
      // flows between holds, and every flush already re-initialises the
      // decoder behind itself. So the press costs the sidecar nothing, and the
      // release is answered immediately.
    };
    const onKeyUp = (e) => {
      if (e.code !== 'Space') return;
      // The release is the other half of that activation — refuse it too. The
      // release itself is honored regardless of where the key-up lands, so a
      // hold can never get stuck open by focus moving mid-utterance.
      if (holdsPushToTalkKey(e)) e.preventDefault();
      release();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      holdingRef.current = false;
    };
  }, [pushToTalk, live]);

  // Publish the mic's REAL standing to the seam the readout reads. Without
  // this the desk could only see `liveArmed` — that the desk asked — and an
  // unopened or failed mic rendered as "MIC ON" over untouched hardware.
  useEffect(() => { feedMicState(state); }, [state]);

  // Product decision (recorded): LIVE stands DOWN when the portal drops. A
  // hot mic serving a dead socket betrays the honest-mic principle — the OS
  // indicator would say "listening" while nothing the witness says can reach
  // the neuma. Going quiet is state 'off', not 'error'; the witness re-opens
  // the mic deliberately after the link returns.
  useEffect(() => {
    if (!connected && liveRef.current) {
      liveRef.current = false;
      setLive(false);
      teardown();
    }
  }, [connected, teardown]);

  // Purpose exit is a stand-down too: a streaming sitting whose sitting stops
  // being a declared conversation has no lane left to stream into.
  useEffect(() => {
    if (liveRef.current && modeRef.current === 'stream' && purpose !== 'conversation') {
      liveRef.current = false;
      setLive(false);
      teardown();
    }
  }, [purpose, teardown]);

  // impure — one utterance recorder over the live stream (legacy blob path)
  const startUtterance = useCallback((stream) => {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : undefined;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      if (recorderRef.current === recorder) recorderRef.current = null;
      const dropped = droppedRef.current;
      droppedRef.current = false;
      if (!liveRef.current) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < MIN_AUDIO_BYTES || dropped) {
        setState('listening');
        return;
      }
      setState('transcribing');
      try {
        const text = await transcribe(blob);
        if (!liveRef.current) return;
        if (text) onUtteranceRef.current?.(text);
      } catch { /* a failed utterance never wedges the session */ }
      if (liveRef.current) setState('listening');
    };
    recorderRef.current = recorder;
    recorder.start();
  }, []);

  // impure — the shared mic grant + analyser pump. The VAD's job differs by
  // path: legacy owns endpointing (start/stop the recorder); streaming keeps
  // ONLY the instant barge-in (speech-start) — the server VAD owns the end.
  const openMicAndPump = useCallback(async () => {
    let stream;
    try {
      // Prefer an OS-level echo-cancelled source when the system offers one.
      // The browser's own AEC cannot help on a desk whose output is pitch-
      // shifted after the fact (see preferredInputDevice) — an OS source takes
      // its reference from the real speaker feed, after every filter. Labels
      // are only readable once a grant has been given, so this is a no-op on
      // the very first sitting and takes effect from the next one; a system
      // with no such device simply keeps the browser's choice.
      let preferred = null;
      try {
        preferred = preferredInputDevice(await navigator.mediaDevices.enumerateDevices());
      } catch { /* enumeration is a courtesy, never a requirement */ }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          ...(preferred ? { deviceId: { exact: preferred } } : {}),
        },
      });
    } catch (err) {
      // THE READOUT SAYS "SEE THE CONSOLE" — so put something in it. Every way
      // a grant can fail landed here identically and silently: a denied
      // permission, an insecure origin (getUserMedia is refused outright off
      // https/localhost), no input device, or a call with no user gesture
      // behind it. The operator got "MIC BLOCKED", looked where the readout
      // sent them, and found an empty console.
      console.warn('[voice] mic grant refused — the sitting reads MIC BLOCKED and will not retry', err);
      liveRef.current = false;
      setLive(false);
      setState('error');
      return null;
    }
    if (!liveRef.current) { // toggled off while the grant was pending
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    // An ON→OFF→ON flurry during the grant leaves TWO start() calls in
    // flight; the OFF teardown was a no-op (nothing installed yet). Whichever
    // resolve lands second must release whatever the first installed, or its
    // pump/stream/context orphan with the mic captured — the OS indicator
    // would lie. Teardown-before-install makes the orphan impossible in
    // either resolve order.
    if (pumpRef.current || streamRef.current) teardown();
    streamRef.current = stream;
    // Which mic is ACTUALLY live — read off the granted track, never guessed
    // from an enumerateDevices list the browser may order differently than it
    // chose. teardown() above already cleared any prior label, so this is the
    // only writer for the grant that just landed.
    feedMicDevice(stream.getAudioTracks()[0]?.label || '');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser); // analysis only — never to ctx.destination
    const frame = new Uint8Array(analyser.fftSize);

    let vad = createVadState();
    pumpRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(frame);
      const rms = frameRms(frame);
      // The operator channel shows what is being CAPTURED, not what the room
      // happens to contain. Under hold-to-talk nothing is captured between
      // holds, so the bars rest — otherwise they dance to the being's own
      // voice off the speakers and read as […] when it is not.
      feedMicLevel(pushToTalkRef.current && !holdingRef.current ? 0 : rms);
      // What the being is sounding RIGHT NOW — the VAD raises its bar by it so
      // speech coming back off open speakers is not mistaken for the witness.
      const now = performance.now();
      const playback = playbackStateRef.current?.() || { level: 0, active: false };
      const fed = feedVad(vad, rms, now, playback.level || 0);
      vad = fed.state;
      if (playback.active) lastPlaybackAtRef.current = now;
      if (pushToTalkRef.current) {
        // The key IS the gate. No VAD guess, no echo bar, no silence for
        // whisper to hallucinate over — the pipe is exactly as open as the
        // witness's thumb says it is.
        pcmGateRef.current = holdingRef.current;
      } else {
        // Open-mic: close the pipe while the being sounds — whisper runs its
        // own VAD, so anything reaching it gets transcribed, and it transcribes
        // the being cleanly down to −32 dB. Keyed on WHETHER it is sounding,
        // plus a tail, because no level is quiet enough to be safe.
        const sounding = playback.active
          || (now - lastPlaybackAtRef.current) < ECHO_TAIL_MS;
        pcmGateRef.current = micGateOpen({
          playbackActive: sounding,
          witnessSpeaking: isWitnessSpeaking(vad.phase),
        });
      }
      // THE KEY IS THE ONLY BARGE-IN (Design note, 2026-08-01: […]).
      //
      // Shutting the PCM pipe was never enough. The mic GRANT stays open all
      // sitting — only the pipe moves — so this detector kept running on live
      // frames, heard the being through the open speakers, and fired 'start':
      // barge-in stopped the playback and voice:speech_start aborted the turn
      // server-side. The being cut ITSELF off, mid-sentence, every time. On
      // headphones there is no bleed, so it behaved — which is exactly the
      // difference he heard.
      //
      // Under hold-to-talk the witness's thumb is the entire signal. There is
      // nothing for a detector to decide, so it decides nothing.
      if (pushToTalkRef.current) return;
      if (fed.event === 'start') {
        onSpeechStartRef.current?.(); // barge-in: silence the neuma NOW
        if (modeRef.current === 'stream') {
          // The same breath tells the portal: cut the in-flight turn and bump
          // the sitting's generation so stale TTS/STT output drops on mismatch.
          wsRef.current?.send('voice:speech_start', {});
        } else {
          startUtterance(stream);
        }
        setState('capturing');
      } else if (fed.event === 'end' || fed.event === 'drop') {
        if (modeRef.current === 'stream') {
          // Server VAD owns the endpoint — the local dip only moves the label.
          setState('listening');
        } else {
          const rec = recorderRef.current;
          if (rec && rec.state === 'recording') {
            droppedRef.current = fed.event === 'drop';
            rec.stop(); // onstop transcribes (or discards a blip)
          } else {
            setState('listening');
          }
        }
      }
    }, PUMP_MS);
    return { ctx, source };
  }, [startUtterance, teardown]);

  // impure — legacy LIVE: blob per utterance → whisper → onUtterance.
  const startBlob = useCallback(async () => {
    warmTranscriber(); // whisper loads while the witness draws breath
    modeRef.current = 'blob';
    const opened = await openMicAndPump();
    if (opened) setState('listening');
  }, [openMicAndPump]);

  // impure — streaming LIVE: open the portal's voice session, then pump PCM.
  const startStream = useCallback(async () => {
    modeRef.current = 'stream';
    micOpenRef.current = false;
    const opened = await openMicAndPump();
    if (!opened) return;
    const { ctx, source } = opened;
    try {
      await ctx.audioWorklet.addModule(createWorkletUrl());
    } catch {
      liveRef.current = false;
      setLive(false);
      teardown();
      setState('error');
      return;
    }
    if (!liveRef.current) { teardown(); return; } // toggled off mid-load
    const node = new AudioWorkletNode(ctx, WORKLET_NAME);
    workletRef.current = node;
    framerRef.current = createPcmFramer();
    // Page-side PCM pipeline: native-rate chunks → 16 kHz → whole 100 ms
    // frames → s16le → base64 → voice:mic_pcm. Only real captured samples
    // flow (the framer HOLDS partial frames — never zero-fills), and only
    // behind the portal's mic_open ack.
    node.port.onmessage = (event) => {
      if (!liveRef.current || !micOpenRef.current || !framerRef.current) return;
      const down = downsampleTo16k(event.data, ctx.sampleRate);
      const send = (frame) =>
        wsRef.current?.send('voice:mic_pcm', { pcm: bytesToBase64(floatToS16le(frame)) });
      for (const frame of framerRef.current.push(down)) {
        if (!pcmGateRef.current) {
          // HOLD-TO-TALK KEEPS NOTHING. The ring exists to cover the client
          // VAD's 120 ms confirm window, which a held key does not have — the
          // press IS the decision. Keeping it here was the self-pickup Founder
          // kept hearing: while the key is up the being is talking through the
          // speakers, so the ring filled with the BEING's voice, and the press
          // drained it to whisper ahead of the first real frame. The module
          // header 350 lines above claimed nothing reaches whisper unless the
          // key is down; this is the line that made that false.
          if (pushToTalkRef.current) continue;
          // A bounded ring — the pre-roll only has to cover the VAD's confirm
          // window, and an unbounded hold would dump a whole reply's worth of
          // room noise into whisper the moment someone spoke.
          prerollRef.current.push(frame);
          if (prerollRef.current.length > PREROLL_FRAMES) prerollRef.current.shift();
          continue;
        }
        // The gate just opened — the syllables that opened the barge-in are in
        // the ring. Send them first, in order, then carry on live.
        if (prerollRef.current.length > 0) {
          const held = prerollRef.current;
          prerollRef.current = [];
          for (const earlier of held) send(earlier);
        }
        send(frame);
      }
    };
    source.connect(node);
    // The processor writes no output, so this plays silence — the connection
    // exists because an unconnected worklet node is never pulled.
    node.connect(ctx.destination);
    setState('opening');
    // Declare WHO ends an utterance. Under hold-to-talk the key does, and the
    // sidecar has to be told: left to its own VAD it ends the line after 400 ms
    // of quiet, so one held sentence containing a thinking pause became two
    // turns, and a release landing after that finalize re-emitted the same
    // words — the being answered one sentence twice.
    wsRef.current?.send('voice:mic_open', { pushToTalk: pushToTalkRef.current === true });
  }, [openMicAndPump, teardown]);

  // The portal's answers for a streaming sitting: the ack opens the PCM gate;
  // a fatal voice:error (session refused or the sidecar wedged) stands the
  // mic DOWN honestly — pcm_flood is a drop notice, not a death, and the
  // stream hook renders the note either way.
  useEffect(() => {
    if (!live || !wsService) return undefined;
    const onOpen = () => {
      if (!liveRef.current || modeRef.current !== 'stream') return;
      micOpenRef.current = true;
      setState('listening');
    };
    const onClose = () => { micOpenRef.current = false; };
    const onError = (data) => {
      if (modeRef.current !== 'stream') return;
      if (data?.code === 'pcm_flood') return; // a drop notice — the lane stays up
      liveRef.current = false;
      setLive(false);
      teardown();
      setState('error');
    };
    // The words landing is what ends the "sending" beat — an event, never a
    // timer. A hold that produces nothing at all stays visibly unanswered
    // rather than quietly resetting to idle as if it had been taken.
    const onSettled = () => {
      if (holdingRef.current) return;   // already holding again; that state wins
      setState((prev) => (prev === 'transcribing' ? 'listening' : prev));
    };
    wsService.on('voice:mic_open', onOpen);
    wsService.on('voice:mic_close', onClose);
    wsService.on('voice:error', onError);
    wsService.on('voice:utterance', onSettled);
    return () => {
      wsService.off('voice:mic_open', onOpen);
      wsService.off('voice:mic_close', onClose);
      wsService.off('voice:error', onError);
      wsService.off('voice:utterance', onSettled);
    };
  }, [live, wsService, teardown]);

  const start = useCallback(
    () => (streamingRef.current ? startStream() : startBlob()),
    [startStream, startBlob],
  );

  const toggleLive = useCallback(() => {
    const next = !liveRef.current;
    liveRef.current = next;
    setLive(next);
    if (next) start();
    else teardown();
  }, [start, teardown]);

  return { live, state, toggleLive };
};
