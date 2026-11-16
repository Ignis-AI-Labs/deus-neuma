// turn-keep-record.js — the pure half of THE TURN KEPT AS IT GOES (turn-keep.js).
//
// Design note, 2026-11-16: […]
//
// A turn's outbound frames fold into what it has said and done so far: its words, the frames that
// draw them again (consecutive words and thoughts merged), the acts still running, and a shadow
// clone split's sub-channels. Two things are made from that: the CATCH-UP a desk that comes back
// mid-turn is sent before the live frames, and the CUT TAKE that lands on the record when the app
// closed before the turn could settle — the words and acts exactly as far as they got, marked
// where they stopped. Pure: frames in, state out.

import { isInflightStatus } from '../../core/runtime/tool-status.js';
import { applyCloneFrame, CLONE_TOOL } from '../../frontend/app/RelinkShell/clone-split.js';

/** What the being reads at the end of a take the app's close cut short (and the desk shows). */
export const CUT_MARK = '[the app closed mid-reply — cut off here]';
/** The catch-up frames a kept turn holds at most (merged words count once). */
export const KEPT_FRAMES_MAX = 600;
/** A cut clone's words kept as its report, at most (the newest kept). */
export const CUT_CLONE_CHARS = 4000;

const KEPT_TYPES = ['"type":"consciousness:', '"type":"tool:usage"', '"type":"tool:detail"', '"type":"clone:'];

/** pure — a frame worth parsing for the kept turn; everything else passes by unread. */
export const worthKeeping = (raw) => typeof raw === 'string' && KEPT_TYPES.some((t) => raw.includes(t));

/** pure — a turn kept from its first frame. */
export const freshKept = ({ neumaId, sessionId, take, startedAt }) => ({
  neumaId, sessionId, turnId: take.turnId, takeIndex: take.takeIndex ?? 1, startedAt,
  words: '', frames: [], acting: [], split: null, settled: false,
});

// pure — a frame appended, or merged into the last when it continues the same stream of text.
const withFrame = (frames, frame) => {
  const last = frames[frames.length - 1];
  if (last && last.type === frame.type && (frame.type === 'consciousness:stream' || frame.type === 'consciousness:thinking')) {
    return [...frames.slice(0, -1), { ...last, content: last.content + frame.content }];
  }
  const next = [...frames, frame];
  return next.length > KEPT_FRAMES_MAX ? next.slice(-KEPT_FRAMES_MAX) : next;
};

// pure — the acts still running after a tool frame: one row per act, the record's own fold.
const actingAfter = (acting, frame) => {
  if (isInflightStatus(frame.status)) return acting.at(-1) === frame.tool ? acting : [...acting, frame.tool];
  const at = acting.lastIndexOf(frame.tool);
  return at === -1 ? acting : [...acting.slice(0, at), ...acting.slice(at + 1)];
};

/** pure — one outbound frame folded into the kept turn. */
export const foldFrame = (kept, frame) => {
  switch (frame?.type) {
    case 'consciousness:stream':
      if (frame.error || typeof frame.content !== 'string' || !frame.content) return kept;
      return { ...kept, words: kept.words + frame.content, frames: withFrame(kept.frames, frame) };
    case 'consciousness:thinking':
      if (typeof frame.content !== 'string' || !frame.content) return kept;
      return { ...kept, frames: withFrame(kept.frames, frame) };
    case 'tool:usage':
      if (!frame.tool) return kept;
      return { ...kept, acting: actingAfter(kept.acting, frame), frames: withFrame(kept.frames, frame) };
    case 'tool:detail':
      return { ...kept, frames: withFrame(kept.frames, frame) };
    case 'clone:split': case 'clone:state': case 'clone:text': case 'clone:tool': case 'clone:end': {
      const split = applyCloneFrame(kept.split, frame);
      return split ? { ...kept, split } : kept;
    }
    case 'consciousness:complete':
      return { ...kept, settled: true };
    default:
      return kept;
  }
};

/** pure — the turn has said or done something worth keeping. */
export const hasWork = (kept) => Boolean(kept?.words || kept?.tools?.length || kept?.thoughts?.length
  || kept?.acting?.length || kept?.split);

/**
 * pure — what goes on disk while the turn runs: its words, its acts and thought stretches as the
 * turn's own record holds them (tool-action-record.js), what is still running, and the split.
 */
export const keptSnapshot = (kept, { tools = [], thoughts = [], savedAt }) => ({
  v: 1, neumaId: kept.neumaId, sessionId: kept.sessionId, turnId: kept.turnId, takeIndex: kept.takeIndex,
  startedAt: kept.startedAt, savedAt, words: kept.words, tools: [...tools], thoughts: [...thoughts],
  acting: [...kept.acting], split: kept.split,
});

// pure — a split's sub-channels redrawn from scratch: what each clone did, said and is doing.
const splitFrames = (split) => {
  const { splitId } = split;
  const at = (index) => ({ splitId, index });
  return [
    { type: 'clone:split', splitId, clones: split.clones.map(({ index, title, task }) => ({ index, title, task })) },
    ...split.clones.flatMap((c) => [
      ...(c.sessionId ? [{ type: 'clone:state', ...at(c.index), sessionId: c.sessionId }] : []),
      ...c.acts.map((act) => ({ type: 'clone:tool', ...at(c.index), act })),
      ...(c.text ? [{ type: 'clone:text', ...at(c.index), chunk: c.text }] : []),
      c.state === 'done' || c.state === 'failed'
        ? { type: 'clone:end', splitId, clone: { index: c.index, state: c.state, report: c.report, acts: c.acts, sessionId: c.sessionId } }
        : { type: 'clone:state', ...at(c.index), state: c.state, position: c.position },
      ...(c.acting ? [{ type: 'clone:tool', ...at(c.index), act: { tool: c.acting, status: 'executing', summary: '' } }] : []),
    ]),
  ];
};

/**
 * pure — the frames that draw the turn so far on a desk that came back mid-turn: its words,
 * thoughts and acts in the order they happened, then a running split's sub-channels. Each is
 * marked `catchUp` (the desk may tell them from live ones).
 */
export const catchUpFrames = (kept) => [
  ...kept.frames,
  ...(kept.split && kept.acting.includes(CLONE_TOOL) ? splitFrames(kept.split) : []),
].map((frame) => ({ ...frame, catchUp: true }));

/** pure — a split the app's close cut: finished clones as they reported, the rest cut where they were. */
export const cutSplit = (split) => ({
  splitId: split.splitId, together: split.together ?? null, seconds: null, record: split.record ?? null, cutOff: true,
  clones: split.clones.map((c) => ({
    index: c.index, title: c.title, task: c.task, acts: c.acts, sessionId: c.sessionId ?? null,
    ...(c.state === 'done' || c.state === 'failed'
      ? { state: c.state, report: c.report ?? null }
      : { state: 'cut', report: c.text ? c.text.slice(-CUT_CLONE_CHARS) : null }),
  })),
});

/**
 * pure — the take a cut turn leaves on the record: the words exactly as far as they got and the
 * mark that says where they stopped, every act that finished, every act still running when the
 * app closed (marked so, a split with its sub-channels), the thought stretches, and `cutOff`.
 */
export const cutRecord = (snap) => {
  const words = typeof snap.words === 'string' ? snap.words : '';
  const running = (snap.acting ?? []).map((tool) => ({
    tool, status: 'error', summary: 'cut off — the app closed while this was running', detail: '', mark: words.length,
    ...(tool === CLONE_TOOL && snap.split ? { split: cutSplit(snap.split) } : {}),
  }));
  const tools = [...(snap.tools ?? []), ...running];
  const thoughts = snap.thoughts ?? [];
  return {
    role: 'assistant',
    content: words ? `${words}\n\n${CUT_MARK}` : CUT_MARK,
    ...(tools.length ? { tools } : {}),
    ...(thoughts.length ? { thoughts } : {}),
    cutOff: { at: snap.savedAt ?? null, startedAt: snap.startedAt ?? null },
  };
};

/** pure — the platform's words that open the turn picking a cut take up again (CONTINUE). */
export const resumeThought = (cutAt) => `[THE APP CLOSED MID-REPLY — the platform, not your operator] Your reply above was cut off${
  cutAt ? ` at ${cutAt}` : ''} when the app closed. Everything you said and did before the cut is on the record above, `
  + 'and the acts that finished stand. Pick up exactly where you stopped: do not repeat what is already said and do not redo '
  + 'an act that already ran — check one that was cut off before running it again — then finish the work.';
