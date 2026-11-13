// use-hold-to-talk.js — hold-to-talk dictation: hold the mic button or Space
// to speak; the transcript appends to the draft for review, never auto-sends.
// Inside the field a TAP of Space still types a space — only a HOLD becomes
// dictation, so speak/pause/hold-again keeps adding to the same thought.
// Split from StreamInput.jsx (size law); bodies moved verbatim.
// `setValue`/`fieldRef` are the composer's draft state and field. (The open-mic LIVE toggle it used
// to stand down for left the composer 2026-11-13: voice is the chat's TALK, one place.)

import { useCallback, useEffect, useRef } from 'react';
import { usePushToTalk } from './use-push-to-talk.js';
import {
  spliceTranscript, holdsPushToTalkKey, stripHoldSpace, HOLD_TO_TALK_MS,
} from './dictation.js';

export const useHoldToTalk = ({ connected, setValue, fieldRef }) => {
  // In-field hold-Space: the pending is-it-a-hold timer, and whether the
  // recording was Space-started (auto-repeats eaten; only a Space release
  // ends it). A pointer hold on the mic button is tracked separately — a
  // reflexive spacebar tap must neither cut it nor start a second recorder.
  const holdTimerRef = useRef(null);
  const spaceHoldRef = useRef(false);
  const pointerHoldRef = useRef(false);

  // THE LIVE FLOW, IN THE BOX (Design note, 2026-08-28: […], superseding
  // the 2026-08-01 overlay line). The provisional text is written INTO the
  // draft at the caret and tracked as a span: each preview pass revises the
  // span in place, the final transcript replaces it in place, and dictation
  // continues wherever the caret stands — the operator's typed newlines are
  // never flattened (spliceTranscript). If the field changes under a live
  // span (a send, a hand edit), the span is abandoned rather than fought:
  // a preview re-anchors at the caret; a final whose span vanished is
  // dropped, because the operator already took those words.
  const spanRef = useRef(null); // { start, end, text } of the provisional in the field

  const spanStanding = (el) => spanRef.current
    && el.value.slice(spanRef.current.start, spanRef.current.end) === spanRef.current.text;

  const applyDictation = useCallback((transcript, final) => {
    const el = fieldRef.current;
    if (!el) return;
    let from;
    let to;
    if (spanStanding(el)) {
      ({ start: from, end: to } = spanRef.current);
    } else {
      if (spanRef.current && final) { spanRef.current = null; return; }
      spanRef.current = null;
      from = to = el.selectionStart ?? el.value.length;
    }
    const spliced = spliceTranscript(el.value, from, to, transcript);
    if (!spliced) return;
    el.value = spliced.value;
    el.setSelectionRange(spliced.end, spliced.end);
    setValue(spliced.value);
    spanRef.current = final ? null : { start: spliced.start, end: spliced.end, text: spliced.text };
    if (final) el.focus();
  }, [setValue, fieldRef]);

  const onTranscript = useCallback((text) => applyDictation(text, true), [applyDictation]);
  const onPreview = useCallback((text) => applyDictation(text, false), [applyDictation]);
  // A final pass that DIES must not take the heard words with it: the last
  // provisional already stands in the draft — adopt it as committed.
  const onFinalError = useCallback(() => { spanRef.current = null; }, []);
  const { state: mic, begin, end, setup, dismissSetup } = usePushToTalk(onTranscript, onPreview, onFinalError);

  // Dictation NEVER interrupts the turn (Design note, 2026-08-15 — this reverses
  // barge-in T1.3): holding Space to talk must not kill work in flight; only
  // the Escape ladder's third tap stops a speaker. The LIVE sitting lane
  // keeps speech-yields-floor — that is a voice conversation, not dictation.
  // Named trade: dictating while the neuma speaks aloud may record its voice.
  const beginCapture = useCallback(() => {
    begin();
  }, [begin]);

  // Hold Space to talk, Claude-voice-mode style. Outside anything typeable a
  // press begins capture at once; inside the field the textarea's keydown
  // arms a hold timer instead (a tap must stay a typed space). Release ends
  // the capture — and cancels a still-pending hold — wherever focus went;
  // window blur is the net for a release the page never sees (alt-tab
  // mid-hold), else the mic stays hot until the next interaction.
  useEffect(() => {
    if (!connected) return undefined;
    const down = (e) => {
      if (!holdsPushToTalkKey(e)) return;
      // EVERY Space keydown this lane owns, auto-repeats INCLUDED. Held Space
      // scrolls the page otherwise — and, measured in Chromium, an un-prevented
      // repeat re-arms the activation of whatever button holds focus, so the
      // RELEASE clicks it. Whatever the witness last pressed on the desk would
      // fire the moment they stopped dictating.
      e.preventDefault();
      if (e.repeat) return;                 // the same hold, not a new one
      if (pointerHoldRef.current) return;   // mic button already holds the capture
      spaceHoldRef.current = true;
      beginCapture();
    };
    // Space release only ends a capture Space started — a pointer-held
    // recording survives a stray spacebar tap. A still-pending hold timer
    // means no capture began at all: just disarm it.
    const settle = () => {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (!spaceHoldRef.current) return;
      spaceHoldRef.current = false;
      end();
    };
    const up = (e) => {
      if (e.code !== 'Space') return;
      // The release is the other half of that activation — refuse it too. The
      // settle itself runs wherever the key-up lands, so a hold can never get
      // stuck open by focus wandering mid-utterance.
      if (holdsPushToTalkKey(e)) e.preventDefault();
      settle();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', settle);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', settle);
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    };
  }, [connected, beginCapture, end]);

  // The composer field's own keydown half of the lane. Returns true when the
  // key belonged to dictation (Space); any other key settles a still-pending
  // hold and falls through to the composer's ordinary handling.
  const onFieldKeyDown = (e) => {
    if (e.code === 'Space') {
      // Tap vs hold: let the press type its space immediately (no
      // typing latency, and a fast space-then-letter roll-over stays
      // in order), but arm the hold timer. Release before it fires
      // (the window keyup cancels it) and it was just a space; past
      // the threshold it becomes dictation and the typed space is
      // stripped back out. Auto-repeats while deciding or while
      // recording would flood the draft with spaces — eat them.
      if (e.repeat) {
        if (holdTimerRef.current || spaceHoldRef.current) e.preventDefault();
        return true;
      }
      // A mic-button hold in progress (or its mic grant still
      // pending) keeps Space an ordinary space.
      if (mic === 'recording' || pointerHoldRef.current) return true;
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        spaceHoldRef.current = true;
        const el = fieldRef.current;
        const stripped = el && stripHoldSpace(el.value, el.selectionStart);
        if (stripped) {
          // setRangeText keeps the caret where the witness left it —
          // a controlled-value swap would throw it to the end.
          el.setRangeText('', stripped.caret, stripped.caret + 1);
          setValue(el.value);
        }
        beginCapture();
      }, HOLD_TO_TALK_MS);
      return true;
    }
    // Any other key while the hold is undecided settles it: that
    // Space was ordinary typing.
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    return false;
  };

  return { mic, setup, dismissSetup, beginCapture, end, pointerHoldRef, onFieldKeyDown };
};
