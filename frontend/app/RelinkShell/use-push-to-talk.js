// use-push-to-talk.js — impure: microphone capture for hold-to-talk.
//
// One utterance per hold: begin() opens the mic and starts recording, end()
// stops it, and the finished audio goes through stt-client for transcription.
// The mic stream lives only while recording — the OS mic indicator is honest.
// THE LIVE LANE FIRST (2026-10-07): the hold also streams to the sidecar's
// live lane (stt-stream-client.js), which reads the voice once as it arrives —
// words while the key is down, the final ~0.2 s after the release. The
// recording keeps running beside it: if the lane is refused (a voice sitting
// holds it) or fails, the hold falls back to /transcribe as below.
// States: idle → recording → transcribing → idle (error shows briefly, then
// returns to idle so a failed attempt never wedges the composer).

import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribe, warmTranscriber } from './stt-client.js';
import { openDictationStream } from './stt-stream-client.js';

const ERROR_DISPLAY_MS = 3000;

// An accidental tap yields a header-only container (~1.3KB) with no audio
// frames — nothing was said, so nothing goes to the engine. Real speech at
// opus bitrates crosses this within ~a third of a second.
const MIN_AUDIO_BYTES = 2048;

// THE LIVE FLOW (Design note, 2026-08-01: […]).
//
// While the key is held, the audio SO FAR is transcribed on this cadence and
// shown as a provisional line. It is a growing window, not a stitched stream:
// each pass re-reads the whole hold, so the preview can revise itself as
// context arrives — which is exactly how a person expects dictation to settle.
//
// Affordable because whisper's encoder pads every request to a fixed 30 s
// regardless of clip length, and a preview decodes greedily (?preview=1):
// measured 2026-10-07 on the rig, 0.25 s for 4 s of speech, 0.7 s for 27 s.
// THE FLOW (Design note, 2026-10-07: […]): audio arrives in short slices and the next read starts the moment
// the last one lands — never a fixed 1.2 s tick waiting behind a busy pass.
// Only one pass is ever in flight; a slice that lands meanwhile just waits.
const SLICE_MS = 250;
// The floor between two read starts — a quiet engine is not asked twice per slice.
const PREVIEW_GAP_MS = 300;

export const usePushToTalk = (onTranscript, onPreview, onFinalError) => {
  const [state, setState] = useState('idle');
  // Non-null when transcription refused for MISSING COMPONENTS — the composer
  // shows the install prompt instead of a bare error flash. { missing: [...] }
  const [setup, setSetup] = useState(null);
  const recorderRef = useRef(null);
  const errorTimerRef = useRef(null);
  // Callback in a ref so a re-rendered composer never rebuilds the recorder.
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  // Whether a preview pass is in flight — one at a time, never a queue —
  // its abort handle (a release drops it), and when the last one started.
  const previewBusyRef = useRef(false);
  const previewAbortRef = useRef(null);
  const previewAtRef = useRef(0);
  const liveRef = useRef(true);
  // A release can land while begin() is still awaiting the mic (the browser's
  // first-use permission prompt forces exactly that) — remember it, or the
  // recorder starts with no stop ever coming and the mic stays hot.
  const endRequestedRef = useRef(false);
  // The recorder ref is only set after the grant resolves, so it can't guard
  // re-entry across that await — a second pointer (multi-touch, Space+mouse)
  // would mint a second recorder and orphan the first stream live.
  const beginningRef = useRef(false);
  // The hold's live-lane handle (null until it opens, or when it cannot).
  const laneRef = useRef(null);

  useEffect(() => () => {
    liveRef.current = false;
    clearTimeout(errorTimerRef.current);
    laneRef.current?.abort();
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const fail = useCallback(() => {
    if (!liveRef.current) return;
    setState('error');
    errorTimerRef.current = setTimeout(() => {
      if (liveRef.current) setState('idle');
    }, ERROR_DISPLAY_MS);
  }, []);

  const begin = useCallback(async () => {
    if (recorderRef.current || beginningRef.current) return;
    beginningRef.current = true;
    clearTimeout(errorTimerRef.current);
    endRequestedRef.current = false;
    warmTranscriber(); // model loads while the witness is still speaking
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // fail() is a brief error flash and nothing else — no reason on screen,
      // and until now nothing in the console either, so a refused mic read as
      // […]. Every cause lands here: a denied permission,
      // an insecure origin (getUserMedia is refused off https/localhost), no
      // input device. Name it, the way the LIVE lane now does.
      console.warn('[voice] dictation mic refused — hold-to-talk cannot record', err);
      beginningRef.current = false;
      fail(); // mic denied or absent
      return;
    }
    if (endRequestedRef.current || !liveRef.current) {
      // The hold was released (or the composer unmounted) while the mic was
      // being granted — nothing to record, and the stream must not stay live.
      beginningRef.current = false;
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : undefined;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      // The provisional read of everything said so far. Chunks are accumulated
      // from the first, so the blob always carries the container header and is
      // decodable on its own — a tail slice alone would not be.
      if (!onPreviewRef.current || previewBusyRef.current) return;
      if (laneRef.current && !laneRef.current.failed) return;   // the live lane is reading
      if (recorder.state !== 'recording') return;   // the final pass owns the end
      if (Date.now() - previewAtRef.current < PREVIEW_GAP_MS) return;
      const soFar = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (soFar.size < MIN_AUDIO_BYTES) return;
      previewBusyRef.current = true;
      previewAtRef.current = Date.now();
      const abort = new AbortController();
      previewAbortRef.current = abort;
      transcribe(soFar, { preview: true, signal: abort.signal })
        .then((text) => {
          // Discard a pass that landed after the hold ended: the final
          // transcript is authoritative and must never be overwritten by a
          // stale preview of the same words.
          if (!liveRef.current || recorderRef.current !== recorder) return;
          if (text) onPreviewRef.current?.(text);
        })
        .catch(() => { /* a preview is a courtesy — never fail the hold for it */ })
        .finally(() => { previewBusyRef.current = false; });
    };
    recorder.onstop = async () => {
      const lane = laneRef.current;
      laneRef.current = null;
      if (lane && liveRef.current) setState('transcribing');
      // The lane hears a short tail past the release, then finalizes.
      const laneText = lane ? await lane.finish() : null;
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      // A read still in flight is stale now — the final pass is authoritative.
      previewAbortRef.current?.abort();
      previewAbortRef.current = null;
      previewBusyRef.current = false;
      if (!liveRef.current) return;
      if (laneText !== null) {
        setState('idle');
        if (laneText) onTranscript(laneText);
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < MIN_AUDIO_BYTES) { setState('idle'); return; }
      setState('transcribing');
      try {
        const text = await transcribe(blob);
        if (!liveRef.current) return;
        setState('idle');
        if (text) onTranscript(text);
      } catch (err) {
        if (err?.code === 'STT_COMPONENTS_MISSING' && liveRef.current) {
          setSetup({ missing: err.missing || [] });
          setState('idle');
          return;
        }
        // The final pass died, but the hold's PREVIEW may already stand in
        // the draft — tell the caller so those heard words are adopted, not
        // discarded with the error (Design note, 2026-08-28: dictation […]).
        if (liveRef.current) onFinalError?.();
        fail();
      }
    };
    recorderRef.current = recorder;
    beginningRef.current = false; // recorderRef guards re-entry from here on
    recorder.start(SLICE_MS);
    setState('recording');
    openDictationStream(stream, {
      onPartial: (text) => {
        if (liveRef.current && recorderRef.current === recorder) onPreviewRef.current?.(text);
      },
    }).then((lane) => {
      if (!lane) return;
      // A hold released before the lane opened is finished by the recording alone.
      if (recorderRef.current !== recorder || recorder.state !== 'recording') { lane.abort(); return; }
      laneRef.current = lane;
    }).catch(() => { /* the recording carries the hold */ });
  }, [onTranscript, onFinalError, fail]);

  const end = useCallback(() => {
    endRequestedRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  }, []);

  const dismissSetup = useCallback(() => setSetup(null), []);

  return { state, begin, end, setup, dismissSetup };
};
