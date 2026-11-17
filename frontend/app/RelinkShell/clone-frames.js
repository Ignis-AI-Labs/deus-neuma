// clone-frames.js — a shadow clone split's frames, and the fold that files each into its clone's
// sub-channel (clone-split.js draws them in the chat). No imports on purpose: the backend reads the
// same fold to keep a running split on disk (backend/services/turn-keep-record.js), and the
// installed app ships this one file for it (electron-builder.yml). Pure.

export const CLONE_TOOL = 'team/shadow_clone';
/** A clone's live words, at most — the newest kept; the whole report arrives with its end. */
export const CLONE_TEXT_MAX = 24_000;
export const CLONE_FRAMES = Object.freeze(['clone:split', 'clone:state', 'clone:text', 'clone:tool', 'clone:end', 'clone:done']);

const freshClone = (c) => ({
  index: c.index, title: c.title, task: c.task ?? '', state: 'waiting', position: null,
  sessionId: null, text: '', acts: [], acting: null, report: null,
});

/** pure — one frame applied to a split (null: a split this frame does not belong to). */
export const applyCloneFrame = (split, frame) => {
  if (frame?.type === 'clone:split') {
    return { splitId: frame.splitId, clones: (frame.clones ?? []).map(freshClone), together: null, seconds: null, record: null };
  }
  if (!split || split.splitId !== frame?.splitId) return null;
  // The whole split finished (a split in the background says so on its own): how many worked at once, how long, the record.
  if (frame.type === 'clone:done') return { ...split, together: frame.together ?? split.together, seconds: frame.seconds ?? split.seconds, record: frame.record ?? split.record };
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
        const text = c.text + String(frame.chunk ?? '');
        return { ...c, state: c.state === 'waiting' ? 'working' : c.state, text: text.length > CLONE_TEXT_MAX ? text.slice(-CLONE_TEXT_MAX) : text };
      }
      case 'clone:tool':
        return frame.act?.status === 'executing'
          ? { ...c, acting: frame.act.tool }
          : { ...c, acting: null, acts: [...c.acts, frame.act].slice(-40) };
      case 'clone:end':
        return { ...c, ...frame.clone, text: c.text, acting: null, position: null };
      default:
        return c;
    }
  });
  return { ...split, clones };
};
