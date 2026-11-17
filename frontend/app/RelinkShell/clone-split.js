// clone-split.js — a shadow clone split, filed into sub-channels of the chat it happened in.
//
// Design note, 2026-11-16: […]
//
// The portal streams clone:* frames while a split works (backend/services/shadow-clone.js): the
// split and its clones, each clone's place in line, its words, its acts, its report. They land on
// the shadow_clone chip of the turn as `split` — one sub-channel per clone — and the chip's
// persisted record carries the same shape (each clone's report and acts), so a reopened chat
// draws the sub-channels again. Pure: the reducer family the stream delegates CLONE to.

import { mapStreamingSegments } from './stream-reducer-segments.js';
import { CLONE_TOOL, applyCloneFrame } from './clone-frames.js';

// The frames and their fold live in clone-frames.js (no imports: the backend reads it too — turn-keep).
export { CLONE_TOOL, CLONE_TEXT_MAX, CLONE_FRAMES, applyCloneFrame } from './clone-frames.js';

// pure — the chip a split belongs to: the turn's newest shadow_clone chip, else its newest acting act.
const splitChipIndex = (segments) => {
  for (let i = segments.length - 1; i >= 0; i -= 1) if (segments[i].kind === 'tool' && segments[i].label === CLONE_TOOL) return i;
  for (let i = segments.length - 1; i >= 0; i -= 1) if (segments[i].kind === 'tool' && segments[i].phase === 'acting') return i;
  return -1;
};

// pure — a settled message whose chip holds this split (a split in the background outlives its turn), or -1.
const settledSplitAt = (messages, splitId) => messages.findLastIndex((m) => !m.streaming
  && (m.segments ?? []).some((s) => s.kind === 'tool' && s.split?.splitId === splitId));

// pure — the split's frame applied to the chip of a settled message (and to its viewed take, which the view folds from).
const intoSettled = (state, at, frame) => {
  const apply = (segments) => segments.map((s) => (s.kind === 'tool' && s.split?.splitId === frame.splitId ? { ...s, split: applyCloneFrame(s.split, frame) ?? s.split } : s));
  const messages = state.messages.slice();
  const m = messages[at];
  messages[at] = { ...m, segments: apply(m.segments), ...(m.takes ? { takes: m.takes.map((t, k) => (k === m.takeIndex - 1 ? { ...t, segments: apply(t.segments) } : t)) } : {}) };
  return { ...state, messages };
};

/** The stream reducer's CLONE family (stream-reducer.js delegates by action type). */
export const cloneHandlers = Object.freeze({
  CLONE: (state, { frame }) => {
    // Clones working in the background report long after their turn settled: their chip is found where it stands.
    const settled = frame?.type === 'clone:split' ? -1 : settledSplitAt(state.messages, frame?.splitId);
    if (settled !== -1) return intoSettled(state, settled, frame);
    // Otherwise only into a reply that is still being written: a frame with no turn on screen has nowhere to go.
    if (!state.messages.some((m) => m.streaming)) return state;
    return mapStreamingSegments(state, (segments) => {
      const i = splitChipIndex(segments);
      if (i === -1) return segments;
      const split = applyCloneFrame(segments[i].split ?? null, frame);
      if (!split) return segments;
      const copy = segments.slice();
      copy[i] = { ...copy[i], split };
      return copy;
    });
  },
});

/** pure — how a clone's state reads in its tab. */
export const cloneStateWords = (clone) => {
  if (clone.state === 'waiting') return clone.position ? `WAITING · #${clone.position} IN LINE` : 'WAITING';
  if (clone.state === 'working') return clone.acting ? `WORKING · ${String(clone.acting).split('/').pop().toUpperCase()}` : 'WORKING';
  if (clone.state === 'failed') return 'DID NOT FINISH';
  if (clone.state === 'cut') return 'CUT OFF WHEN THE APP CLOSED';
  return 'DONE';
};

/** pure — the line over the sub-channels. */
export const splitHeadline = (split) => {
  const clones = split?.clones ?? [];
  const done = clones.filter((c) => c.state === 'done').length;
  const working = clones.filter((c) => c.state === 'working').length;
  const head = `SHADOW CLONES · ${clones.length}`;
  if (split?.seconds != null) return `${head} · ${done} REPORTED · ${split.together} AT ONCE · ${split.seconds}S`;
  // Sent to work in the background: the chat went on; the reports come back as a turn of their own.
  if (split?.background) return `${head} · ${working} WORKING · ${done} DONE · IN THE BACKGROUND — THEY REPORT BACK HERE`;
  // The app closed while the split worked (turn-keep.js): what finished, and where the rest stopped.
  if (split?.cutOff) return `${head} · ${done} DONE · CUT OFF WHEN THE APP CLOSED`;
  return `${head} · ${working} WORKING · ${done} DONE`;
};
