// team-continue.js — what a part is asked on each attempt, and the note a
// part that stopped short continues with. Pure.
//
// Design note, 2026-10-12, on a run whose five working members were all cut at
// thirty minutes: […] A part had ONE attempt: whatever cut it ended it, and both the
// operator's guidance and a resume asked it again from nothing. A part now
// CONTINUES in its own sitting: the conversation it was having is still
// there (its brief, its words), the files it wrote stand in the workspace,
// and this note says why it stopped, the acts it already took (its work log,
// team-part-log.js) and anything new from its operator — so it picks up
// where it was instead of starting over.

/** The earlier acts a continuation lists — the newest, when there are more. */
export const CONTINUE_ACTS_MAX = 40;

// Why the part is continuing, in one sentence.
const WHY = Object.freeze({
  failed: (why) => `Your part stopped before you finished — ${why}.`,
  unfinished: (why) => `Your answer did not finish your part — ${why}.`,
  steered: () => 'Your operator paused you mid-work to guide you.',
  resumed: (why) => `This run stopped${why ? ` (${why})` : ''} and has been picked up again.`,
  'wrap-up': (why) => `Your clock has run out (${why}).`,
});

// How the note closes: a part handing in at its clock's end starts nothing new (#577).
const CLOSE = Object.freeze({
  'wrap-up': 'HAND IN WHAT YOU HAVE NOW: write your deliverable with what you have — into its file if your brief names one — and say plainly what is left undone. Start nothing new. Then sign off as your brief asks.',
});
const CLOSE_DEFAULT = 'Pick up where you stopped — do not redo what is already done. Finish your part and sign off as your brief asks.';

const guidance = (notes) => `YOUR OPERATOR'S GUIDANCE for this part — it outranks the brief where they differ:\n${notes.map((n) => `— ${n.note}`).join('\n')}`;

const actLine = (a) => `— ${a.tool} ${String(a.status).toUpperCase()}${a.summary ? `: ${a.summary}` : ''}`;

/**
 * @param {Object} args
 * @param {'failed'|'unfinished'|'steered'|'resumed'|'wrap-up'} args.kind
 * @param {?string} [args.why] - what stopped it, in the run's words
 * @param {Array<{tool: string, status: string, summary: ?string}>} [args.acts] - its settled acts so far
 * @param {Array<{note: string}>} [args.notes] - the operator's guidance it has not read yet
 * @param {number} [args.posts] - posts in the team channel from teammates, lead or operator
 * @param {?string} [args.room] - the team workspace root (its room is <root>/.team/)
 * @returns {string}
 */
export const continuationNote = ({ kind, why = null, acts = [], notes = [], posts = 0, room = null }) => {
  const shown = acts.slice(-CONTINUE_ACTS_MAX);
  const did = acts.length
    ? `${acts.length > shown.length ? `The last ${shown.length} of the ${acts.length} acts you took:` : 'The acts you already took:'}\n${shown.map(actLine).join('\n')}`
    : null;
  return [
    `YOUR PART CONTINUES. ${(WHY[kind] || WHY.failed)(why)} Nothing you did is lost: your words are above in this conversation and the files you wrote are in the team workspace.`,
    did,
    notes.length ? guidance(notes) : null,
    posts && room ? `Your team channel holds ${posts} post${posts === 1 ? '' : 's'} from the others — read ${room}/.team/channel.md before you go on.` : null,
    CLOSE[kind] || CLOSE_DEFAULT,
  ].filter(Boolean).join('\n\n');
};

/**
 * What a part is asked on one attempt. The FIRST attempt reads its brief,
 * with any guidance the operator gave while it waited. A continuation in the
 * part's OWN SITTING reads only the note — its brief and its words are
 * already in that conversation. A conduit with no sitting (the no-tools
 * probe) holds no conversation, so it reads the brief again with every note
 * after it.
 *
 * @param {Object} args
 * @param {Array<{role: string, content: string}>} args.messages - the part's brief
 * @param {?Object} [args.continuation] - { kind, why?, acts? } when the part continues
 * @param {Array<{note: string}>} [args.notes] - the guidance this attempt carries
 * @param {boolean} [args.sitting] - the attempt continues the part's own sitting
 * @param {?string} [args.clock] - the part's clock, as its first attempt reads it (team-clock.js)
 * @returns {Array<{role: string, content: string}>}
 */
export const attemptMessages = ({ messages, continuation = null, notes = [], sitting = false, clock = null }) => {
  const append = (text) => messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: `${m.content}\n\n${text}` } : m));
  if (!continuation) {
    const first = [clock, notes.length ? guidance(notes) : null].filter(Boolean);
    return first.length ? append(first.join('\n\n')) : messages;
  }
  const note = continuationNote({ ...continuation, notes });
  return sitting ? [{ role: 'user', content: note }] : append(note);
};
