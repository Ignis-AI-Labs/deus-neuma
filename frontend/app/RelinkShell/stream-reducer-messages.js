// stream-reducer-messages.js — message assembly: witness/persisted segments,
// the history fold (persisted records → display messages), the edit-fork's
// displayed-ask swap, and the plain message push. Split from
// stream-reducer.js (size law); bodies moved verbatim. Pure and
// deterministic exactly as the reducer is: no IO, no clocks.
import { historyCompactMessage } from './compact-marker.js';

/** Segments for a witness/persisted message: shared images ride above the
 *  words (either may stand alone). Pure. */
const imageSegment = (src) => (typeof src === 'string'
  ? { kind: 'image', src }
  // A pasted image the display view left out (session-display.js): fetched when seen.
  : { kind: 'image', src: null, ref: src?.ref ?? null, bytes: src?.bytes ?? null });

const messageSegments = (text, images, docs = []) => [
  ...(Array.isArray(images) ? images.map(imageSegment) : []),
  // Shared FILES ride the bubble as named chips (Design note, 2026-09-17: a message
  // sent with a markdown must SHOW that it was sent with it — live and in
  // history; the redeemed text belongs to the being's turn, the name to the
  // operator's own record).
  ...(Array.isArray(docs) ? docs.map((d) => ({ kind: 'doc', name: typeof d === 'string' ? d : d?.name })) : [])
    .filter((s) => s.name),
  ...(text ? [{ kind: 'speech', text }] : []),
];

/** Persisted tool actions → settled tool segments. A resumed chat shows the
 *  acts exactly as they settled (chips resolved, never re-executed). Pure. */
const historyToolSegments = (tools) =>
  (Array.isArray(tools) ? tools : []).map((t) => ({
    kind: 'tool',
    phase: 'resolved',
    label: t.tool || 'tool',
    status: t.status || 'ok',
    summary: t.summary || '',
    detail: t.detail || '',
    // The display view leaves a long result out; its size and address stay so
    // the chip opens it on demand (use-lazy-detail.js).
    ...(t.lazy ? { detailChars: t.detailChars ?? 0, ref: t.ref ?? null } : {}),
    // Research sources persisted with the turn — a resumed chat can still open
    // the links the being pulled, which is the whole point of keeping them.
    sources: Array.isArray(t.sources) ? t.sources : [],
    // What the act MADE, kept with it — a render was visible on the live chip
    // and then gone on return, which made the conversation the one place the
    // being's own work could not be seen.
    images: Array.isArray(t.images) ? t.images : [],
    // The list the operator was handed, rebuilt on resume. This is the one
    // payload he is most likely to come BACK for — […] — so losing it on reopen would defeat the whole surface.
    findings: t.findings && t.findings.count ? t.findings : null,
    // a benchmark the chat launched — on resume its card reads how it ended
    bench: t.bench?.comparisonId ? t.bench : null,
  }));

/** Text between two acts → a speech segment, or nothing. The slice inherits the
 *  separator the rounds were joined with, so it is trimmed; a slice of pure
 *  whitespace was never speech. Pure. */
const historySpeech = (text) => (text.trim() ? [{ kind: 'speech', text: text.trim() }] : []);

/** Persisted thought-trail entries → thought segments (THE THOUGHT TRAIL):
 *  the reasoning a turn streamed, kept as review material — never speech. Pure. */
const historyThoughtSegments = (trail) =>
  (Array.isArray(trail) ? trail : [])
    .filter((t) => (typeof t?.text === 'string' && t.text.trim()) || (t?.lazy && t.chars > 0))
    .map((t) => (t.lazy ? { kind: 'thought', text: '', chars: t.chars, ref: t.ref ?? null } : { kind: 'thought', text: t.text }));

/**
 * A persisted assistant record → settled segments, IN THE ORDER THE TURN
 * HAPPENED. Each act carries `mark` — how much speech stood written when it
 * happened — so chips rebuild between the words they actually fell between
 * (Design note, 2026-08-05: […]). The THOUGHT TRAIL rides the same law: reasoning
 * stretches carry the same mark, so the bubbles rebuild where they streamed
 * (Design note, 2026-08-27: […]). A round's
 * act and the NEXT round's thought share one mark — the sort is stable and
 * tools enter first, so the tie settles in the order it flowed: the act,
 * then the thought.
 *
 * A record written before the mark existed keeps the old shape — nothing on it
 * says where its acts went, and inventing a position would be worse than the
 * honest one it has always had. Pure.
 */
const historySegments = (content, tools, images, thoughts) => {
  const acts = Array.isArray(tools) ? tools : [];
  const trail = Array.isArray(thoughts) ? thoughts : [];
  const text = typeof content === 'string' ? content : '';
  const placed = [
    ...acts.map((a) => ({ ...a, kind: 'tool' })),
    ...trail.map((t) => ({ ...t, kind: 'thought' })),
  ];
  if (placed.length === 0 || placed.some((p) => !Number.isFinite(p?.mark))) {
    return [...historyToolSegments(acts), ...historyThoughtSegments(trail), ...messageSegments(content, images)];
  }
  const shared = Array.isArray(images) ? images.map(imageSegment) : [];
  const ordered = [...placed].sort((a, b) => a.mark - b.mark);
  let cut = 0;
  const flow = ordered.flatMap((entry) => {
    const at = Math.min(Math.max(entry.mark, cut), text.length);
    const spoken = historySpeech(text.slice(cut, at));
    cut = at;
    const segment = entry.kind === 'thought'
      ? historyThoughtSegments([entry])
      : historyToolSegments([entry]);
    return [...spoken, ...segment];
  });
  return [...shared, ...flow, ...historySpeech(text.slice(cut))];
};

/** Map persisted display records to history messages. A take-aware record
 *  (THE TAKES — workspace-sessions' fold) becomes ONE message holding every
 *  take, the viewed one's segments mirrored out; a legacy record passes
 *  through as a single-take message, exactly as before. */
export const toHistoryMessages = (messages, base, prefix) =>
  messages.map((m, k) => {
    if (m.compacted === true) return historyCompactMessage(m, `${prefix}${base + k}`);
    const shared = {
      id: `${prefix}${base + k}`,
      // The platform's own lines — a watch's report, a house wake's note, another chat's link, the citation law's hold — never the operator's bubble.
      role: m.role === 'assistant' ? 'neuma' : ['watch', 'wake', 'link', 'hold'].includes(m.origin) ? m.origin : 'user',
      streaming: false,
      isHistory: true,
      at: m.at ?? null,
      // The declared affect is the ONE meta that persists — the being's
      // revelation outlives the reload (Campaign 6); the live-only guess
      // never did and never will.
      meta: m.affect ? { affect: m.affect } : null,
    };
    if (m.role === 'assistant' && Array.isArray(m.takes) && m.takes.length > 0) {
      const takes = m.takes.map((t) => ({
        takeIndex: t.takeIndex,
        at: t.at ?? null,
        meta: t.affect ? { affect: t.affect } : null,
        segments: historySegments(t.content, t.tools, undefined, t.thoughts),
      }));
      const viewed = takes[m.takeIndex - 1] || takes[takes.length - 1];
      return {
        ...shared,
        turnId: m.turnId,
        takeIndex: viewed.takeIndex,
        takeCount: takes.length,
        takes,
        at: viewed.at ?? null,
        segments: viewed.segments,
      };
    }
    return {
      ...shared,
      ...(m.turnId ? { turnId: m.turnId } : {}),
      segments: m.role === 'assistant'
        ? historySegments(m.content, m.tools, m.images, m.thoughts)
        : messageSegments(m.content, m.images, m.docs),
    };
  });

/** A user bubble with a different DISPLAYED asking: shared images kept, the
 *  speech replaced. The record's first asking is never rewritten — this only
 *  moves what the view shows (the edit-fork's fold law, live). Pure. */
export const withDisplayedAsk = (message, text) => ({
  ...message,
  segments: [
    ...message.segments.filter((s) => s.kind === 'image' || s.kind === 'doc'),
    { kind: 'speech', text },
  ],
});

export const pushMessage = (state, role, text, images, at, holdId = null, docs = []) => ({
  ...state,
  thinking: role === 'user' || role === 'watch' || role === 'link' || role === 'hold', // a watch's report, a chat link and a held answer open a turn too
  seq: state.seq + 1,
  messages: [
    ...state.messages,
    {
      id: `m${state.seq}`,
      role,
      streaming: false,
      isHistory: false,
      at: at ?? null,
      segments: messageSegments(text, images, docs),
      meta: null,
      // The send's hold handle — a HELD word's bubble is addressable.
      ...(holdId ? { holdId, queued: false } : {}),
    },
  ],
});
