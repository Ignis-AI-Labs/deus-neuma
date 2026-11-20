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
  if (clone.stopping && (clone.state === 'waiting' || clone.state === 'working')) return 'STOPPING…';
  if (clone.state === 'waiting') return clone.position ? `WAITING · #${clone.position} IN LINE` : 'WAITING';
  if (clone.state === 'working') return clone.acting ? `WORKING · ${String(clone.acting).split('/').pop().toUpperCase()}` : 'WORKING';
  if (clone.state === 'failed') return 'DID NOT FINISH';
  if (clone.state === 'cut') return 'CUT OFF WHEN THE APP CLOSED';
  return 'DONE';
};

const ENDED = new Set(['done', 'failed', 'cut']);
/** pure — is a split still at work: some clone waiting its place or working, and the run not closed or cut off. */
export const isSplitRunning = (split) => Boolean(split?.clones?.length) && split.seconds == null && !split.cutOff && !split.stopped
  && split.clones.some((c) => !ENDED.has(c.state));

/** pure — the clones of a split that stopped before they reported (failed, or cut off), when the split is not at work. */
export const stoppedClones = (split) => (isSplitRunning(split) ? [] : (split?.clones ?? []).filter((c) => c.state === 'failed' || c.state === 'cut'));

/**
 * pure — the splits of this chat still at work, oldest first (Design note, 2026-11-19: […]). The chat docks them above its composer while they work.
 */
export const runningSplits = (messages = []) => messages.flatMap((m) => (m?.segments ?? []))
  .map((s) => s?.split).filter(isSplitRunning);

/** pure — the line over the sub-channels. */
export const splitHeadline = (split) => {
  const clones = split?.clones ?? [];
  const done = clones.filter((c) => c.state === 'done').length;
  const working = clones.filter((c) => c.state === 'working').length;
  const head = `SHADOW CLONES · ${clones.length}`;
  if (split?.seconds != null) return `${head} · ${done} REPORTED · ${split.together} AT ONCE · ${split.seconds}S`;
  // The app closed while the split worked (turn-keep.js), or its clones stopped: what finished, and that the rest resume.
  const stopped = stoppedClones(split).length;
  if (split?.cutOff) return `${head} · ${done} DONE · CUT OFF WHEN THE APP CLOSED${stopped ? ' — RESUME THEM WHERE THEY LEFT OFF' : ''}`;
  if (split?.stopped || (split?.background && stopped)) return `${head} · ${done} DONE · ${stopped} STOPPED — RESUME THEM WHERE THEY LEFT OFF`;
  // Sent to work in the background: the chat went on; the reports come back as a turn of their own.
  if (split?.background) return `${head} · ${working} WORKING · ${done} DONE · IN THE BACKGROUND — THEY REPORT BACK HERE`;
  return `${head} · ${working} WORKING · ${done} DONE`;
};

/** pure — a clone's work in the order it happened (clone-frames.js feed); one kept before the feed existed reads as its acts, then its words. */
export const feedOf = (clone) => (clone?.feed?.length ? clone.feed
  : [...(clone?.acts ?? []).map((a) => ({ k: 'a', tool: a.tool, summary: a.summary ?? '', status: a.status })), ...(clone?.text ? [{ k: 'w', text: clone.text }] : [])]);

const NOW_CHARS = 110;
const lastSentence = (text) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const sentences = flat.match(/[^.!?]+[.!?]*/g) ?? [];
  const last = (sentences.at(-1) ?? '').trim();
  const pick = last.length < 12 && sentences.length > 1 ? `${sentences.at(-2).trim()} ${last}` : last;
  return pick.length > NOW_CHARS ? `…${pick.slice(-NOW_CHARS)}` : pick;
};
/** pure — what a clone is doing this moment, in one line: the act under way, else the last thing it said; null when it has done nothing yet or is done. */
export const nowLine = (clone) => {
  if (!clone || !['working', 'waiting'].includes(clone.state)) return null;
  const last = feedOf(clone).at(-1);
  if (!last) return null;
  if (last.k === 'a') return `${last.status === 'executing' ? '⟐ ' : ''}${last.summary || String(last.tool).split('/').pop()}`;
  return last.k === 'w' ? lastSentence(last.text) || null : null;
};
