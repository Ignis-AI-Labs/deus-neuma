// clone-frames.js — a shadow clone split's frames, and the fold that files each into its clone's
// sub-channel (clone-split.js draws them in the chat). No imports on purpose: the backend reads the
// same fold to keep a running split on disk (backend/services/turn-keep-record.js), and the
// installed app ships this one file for it (electron-builder.yml). Pure.

export const CLONE_TOOL = 'team/shadow_clone';
/** A clone's live words, at most — the newest kept; the whole report arrives with its end. */
export const CLONE_TEXT_MAX = 24_000;
export const CLONE_FRAMES = Object.freeze(['clone:split', 'clone:state', 'clone:text', 'clone:tool', 'clone:end', 'clone:done', 'clone:resume', 'clone:stop']);
/** A clone's timeline, at most this many steps (the newest kept). */
export const CLONE_FEED_MAX = 160;

const freshClone = (c) => ({
  index: c.index, title: c.title, goal: c.goal ?? null, task: c.task ?? '', state: 'waiting', position: null,
  sessionId: null, text: '', acts: [], acting: null, report: null, feed: [],
});

// FOLLOWING A CLONE (Design note, 2026-11-19: […]):
// its words came as one run ([…]) with its acts listed apart. The feed is its work in the
// order it happened — {k:'w', text} what it said, {k:'a', tool, summary, status} each act where it took it, {k:'m',
// words} a mark (resumed) — so each act breaks its words, and the newest step is last. The newest kept, by steps and
// by words.
const capFeed = (feed) => {
  let out = feed.slice(-CLONE_FEED_MAX);
  let chars = out.reduce((n, e) => n + (e.k === 'w' ? e.text.length : 0), 0);
  while (chars > CLONE_TEXT_MAX && out.length > 1) { chars -= out[0].k === 'w' ? out[0].text.length : 0; out = out.slice(1); }
  return out;
};
const feedWords = (feed = [], chunk) => (feed.at(-1)?.k === 'w'
  ? capFeed([...feed.slice(0, -1), { k: 'w', text: feed.at(-1).text + chunk }])
  : capFeed([...feed, { k: 'w', text: chunk }]));
// An act stands where it began; when it ends, its step says how.
const feedAct = (feed = [], act) => {
  const step = { k: 'a', tool: act.tool, summary: act.summary ?? '', status: act.status };
  const open = act.status === 'executing' ? -1 : feed.findLastIndex((e) => e.k === 'a' && e.tool === act.tool && e.status === 'executing');
  return open === -1 ? capFeed([...feed, step]) : feed.map((e, i) => (i === open ? { ...step, summary: step.summary || e.summary } : e));
};

/** pure — one frame applied to a split (null: a split this frame does not belong to). */
export const applyCloneFrame = (split, frame) => {
  if (frame?.type === 'clone:split') {
    return { splitId: frame.splitId, clones: (frame.clones ?? []).map(freshClone), together: null, seconds: null, record: null };
  }
  if (!split || split.splitId !== frame?.splitId) return null;
  // The whole split finished (a split in the background says so on its own): how many worked at once, how long, the record.
  if (frame.type === 'clone:done') return { ...split, together: frame.together ?? split.together, seconds: frame.seconds ?? split.seconds, record: frame.record ?? split.record };
  // A RESUME (Design note, 2026-11-19: […]): refused, it says why; taken, its stopped clones
  // are back in line and the split is at work again.
  // STOP (Design note, 2026-11-19: […]): the clones stopping say so until each one's end
  // arrives; a split the backend is not running (the app restarted under it) stands stopped at once.
  if (frame.type === 'clone:stop') {
    if (frame.state === 'not-running') return { ...split, stopped: true, clones: split.clones.map((c) => (['done', 'failed', 'cut'].includes(c.state) ? c : { ...c, state: 'cut', acting: null, position: null })) };
    const going = new Set(frame.clones ?? []);
    return { ...split, clones: split.clones.map((c) => (going.has(c.index) ? { ...c, stopping: true } : c)) };
  }
  if (frame.type === 'clone:resume') {
    if (frame.state === 'refused') return { ...split, resumeRefused: frame.reason ?? 'the resume was refused' };
    const again = new Set(frame.clones ?? []);
    return {
      ...split, seconds: null, together: null, cutOff: false, stopped: false, resumeRefused: null,
      clones: split.clones.map((c) => (again.has(c.index) ? { ...c, state: 'waiting', position: null, text: '', acting: null, report: null, feed: capFeed([...(c.feed ?? []), { k: 'm', words: 'RESUMED WHERE IT STOPPED' }]) } : c)),
    };
  }
  const clones = split.clones.map((c) => {
    if (c.index !== (frame.index ?? frame.clone?.index)) return c;
    switch (frame.type) {
      case 'clone:state':
        return {
          ...c,
          ...(frame.state ? { state: frame.state, position: frame.state === 'waiting' ? frame.position ?? null : null } : {}),
          ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
        };
      case 'clone:text': {
        const chunk = String(frame.chunk ?? '');
        // Words after an act start a paragraph of their own, in the words kept whole as well as in the feed.
        const text = c.text + (c.text && c.feed?.at(-1)?.k === 'a' ? '\n\n' : '') + chunk;
        return { ...c, state: c.state === 'waiting' ? 'working' : c.state, text: text.length > CLONE_TEXT_MAX ? text.slice(-CLONE_TEXT_MAX) : text, feed: feedWords(c.feed, chunk) };
      }
      case 'clone:tool':
        if (!frame.act) return c;
        return frame.act.status === 'executing'
          ? { ...c, acting: frame.act.tool, feed: feedAct(c.feed, frame.act) }
          : { ...c, acting: null, acts: [...c.acts, frame.act].slice(-40), feed: feedAct(c.feed, frame.act) };
      case 'clone:end':
        return { ...c, ...frame.clone, text: c.text, feed: c.feed ?? [], acting: null, position: null, stopping: false };
      default:
        return c;
    }
  });
  return { ...split, clones };
};
