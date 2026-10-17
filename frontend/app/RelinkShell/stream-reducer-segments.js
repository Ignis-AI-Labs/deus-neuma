// stream-reducer-segments.js — the live neuma message's segment machinery
// and the streaming-content handler family (thought, speech, tool rows).
// Split from stream-reducer.js (size law); bodies moved verbatim. Pure and
// deterministic exactly as the reducer is: no IO, no clocks.

import { isInflightStatus } from '../../../core/runtime/tool-status.js';

/** Index of the live (still-streaming) neuma message, or -1. At most one
 *  message streams at a time, and a retried TAKE streams IN PLACE at its
 *  turn-point — not necessarily at the tail — so "live" is found anywhere. */
export const streamingIndex = (messages) =>
  messages.findLastIndex((m) => m.role === 'neuma' && m.streaming);

/** Ensure a live neuma message exists; returns possibly-new state. `at` is
 *  the mint moment (the impure hook stamps it; the reducer reads no clock).
 *  `take` (THE TAKES) targets the stream's turn-point: the new take opens IN
 *  PLACE of the viewed one; without a take, a fresh message at the tail. */
const withStreaming = (state, at, take) => {
  if (streamingIndex(state.messages) !== -1) return state;
  if (take?.turnId) {
    const idx = state.messages.findIndex((m) => m.role === 'neuma' && m.turnId === take.turnId);
    if (idx !== -1) {
      const message = state.messages[idx];
      const takes = [
        ...(message.takes || []),
        { takeIndex: take.takeIndex ?? (message.takes?.length || 0) + 1, at: at ?? null, segments: [], meta: null },
      ];
      const messages = state.messages.slice();
      messages[idx] = {
        ...message, streaming: true,
        takeCount: takes.length, takeIndex: takes.length, takes,
        at: at ?? null, segments: [], meta: null,
      };
      return { ...state, messages };
    }
    // The point is not on screen (the history window cut it) — a fresh
    // streaming message at the tail, take identity carried.
    const message = {
      id: `m${state.seq}`,
      role: 'neuma',
      streaming: true,
      isHistory: false,
      at: at ?? null,
      segments: [],
      meta: null,
      turnId: take.turnId,
      takeIndex: take.takeIndex ?? 1,
      takeCount: take.takeIndex ?? 1,
      takes: [{ takeIndex: take.takeIndex ?? 1, at: at ?? null, segments: [], meta: null }],
    };
    return { ...state, seq: state.seq + 1, messages: [...state.messages, message] };
  }
  const message = {
    id: `m${state.seq}`,
    role: 'neuma',
    streaming: true,
    isHistory: false,
    at: at ?? null,
    segments: [],
    meta: null,
  };
  return { ...state, seq: state.seq + 1, messages: [...state.messages, message] };
};

/** Replace the live neuma message's segments via fn(segments) -> segments.
 *  A take-aware message mirrors its live segments into the viewed take, so a
 *  later TAKE_SWITCH re-folds from the takes alone. */
export const mapStreamingSegments = (state, fn, at, take) => {
  const next = withStreaming(state, at, take);
  const idx = streamingIndex(next.messages);
  const message = next.messages[idx];
  const segments = fn(message.segments);
  const messages = next.messages.slice();
  messages[idx] = message.takes
    ? {
        ...message, segments,
        takes: message.takes.map((t, i) => (i === message.takeIndex - 1 ? { ...t, segments } : t)),
      }
    : { ...message, segments };
  return { ...next, messages };
};

/** Index of the first tool segment still acting, or -1. */
const firstActingTool = (segments) =>
  segments.findIndex((s) => s.kind === 'tool' && s.phase === 'acting');

/**
 * Index of the LAST tool row for `label` that is still live, or -1. Pure.
 * Last, not first: a being may use the same tool twice in one turn, and a new
 * report belongs to the most recent invocation.
 *
 * The in-flight register is the shared one (core/runtime/tool-status.js): the
 * chip's colour, this fold, and the backend's persisted record all read it, or
 * a row updates in place on screen while the record keeps every frame.
 */
const lastLiveToolIndex = (segments, label) => {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const s = segments[i];
    if (s.kind === 'tool' && s.label === label && isInflightStatus(s.status)) return i;
  }
  return -1;
};

// The streaming-content handler family — stream-reducer.js delegates these
// by action type; each entry is one former switch case, body verbatim.
export const segmentHandlers = Object.freeze({
  // THE THOUGHT BUBBLE. Reasoning arrives on its own frame and lands in
  // its own segment kind, where in the turn it actually happened — never
  // merged into speech. Design note, 2026-07-30: […]
  THINKING: (state, action) => {
    if (!action.text) return state;
    return mapStreamingSegments({ ...state, thinking: false }, (segments) => {
      const last = segments[segments.length - 1];
      // Reasoning streams token by token — it accumulates into ONE bubble per
      // stretch of thought, exactly as speech accumulates into one paragraph.
      if (last && last.kind === 'thought') {
        return [...segments.slice(0, -1), { ...last, text: last.text + action.text }];
      }
      return [...segments, { kind: 'thought', text: action.text }];
    }, action.at, action.take);
  },

  SPEECH: (state, action) => {
    if (!action.text) return state;
    return mapStreamingSegments({ ...state, thinking: false }, (segments) => {
      const last = segments[segments.length - 1];
      if (last && last.kind === 'speech') {
        return [...segments.slice(0, -1), { ...last, text: last.text + action.text }];
      }
      return [...segments, { kind: 'speech', text: action.text }];
    }, action.at, action.take);
  },

  TOOL_OPEN: (state, action) =>
    mapStreamingSegments({ ...state, thinking: false }, (segments) => [
      ...segments,
      { kind: 'tool', phase: 'acting', label: action.label || 'tool', status: '', summary: '', detail: '' },
    ], action.at, action.take),

  // The tool name often arrives after the block opens (parsed block or
  // the backend's `executing` event) — name the chip that is acting.
  TOOL_LABEL: (state, action) =>
    mapStreamingSegments(state, (segments) => {
      const i = firstActingTool(segments);
      if (i === -1 || !action.label) return segments;
      const copy = segments.slice();
      copy[i] = { ...copy[i], label: action.label };
      return copy;
    }, action.at, action.take),

  // The streamed block closed — name it and keep the raw call as the
  // detail the backend result may not supply.
  TOOL_RAW: (state, action) =>
    mapStreamingSegments(state, (segments) => {
      const i = firstActingTool(segments);
      if (i === -1) return segments;
      const copy = segments.slice();
      copy[i] = {
        ...copy[i],
        label: action.label || copy[i].label,
        detail: action.raw || copy[i].detail,
      };
      return copy;
    }, action.at, action.take),

  TOOL_RESULT: (state, action) => {
    const { tool, status, summary, detail, sources, images, findings, bench } = action.data;
    return mapStreamingSegments(state, (segments) => {
      const i = firstActingTool(segments);
      const resolved = {
        kind: 'tool',
        phase: 'resolved',
        status: status || 'ok',
        label: tool || (i !== -1 ? segments[i].label : 'tool'),
        summary: summary || '',
        detail: detail || (i !== -1 ? segments[i].detail : '') || '',
        sources: Array.isArray(sources) ? sources : (i !== -1 ? segments[i].sources || [] : []),
        // What the being MADE, carried to the chip so a render is visible
        // where the work happened — the stream — without a trip to the
        // gallery (Design note, 2026-08-01. Dropped here until now, which is why a
        // generated image existed everywhere except the conversation.
        images: Array.isArray(images) ? images : (i !== -1 ? segments[i].images || [] : []),
        // A list the being HANDED the operator — the curated answer, not the
        // research record beside it. Carried like the others so it survives
        // the act resolving on top of its own in-flight segment.
        findings: findings || (i !== -1 ? segments[i].findings || null : null),
        // a benchmark the chat launched — the card watches it to its end
        bench: bench || (i !== -1 ? segments[i].bench || null : null),
      };
      if (i !== -1) {
        const copy = segments.slice();
        copy[i] = resolved;
        return copy;
      }
      // ONE CHIP PER ACTION, not one per heartbeat. A long action reports
      // progress repeatedly, and each of those used to append a new segment —
      // a single image render laid down seven rows on its way to succeeding
      // (Design note, 2026-08-02: […]). With
      // no acting chip left to resolve, a repeat report UPDATES the live row
      // for the same tool: the bar fills in place, then the terminal result
      // replaces it with the finished thing.
      const live = lastLiveToolIndex(segments, resolved.label);
      if (live !== -1) {
        const copy = segments.slice();
        copy[live] = { ...resolved, detail: resolved.detail || segments[live].detail };
        return copy;
      }
      return [...segments, resolved];
    }, action.at, action.take);
  },
});
