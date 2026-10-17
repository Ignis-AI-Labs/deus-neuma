// team-board.js — the team's shared STATUS BOARD: one place where every
// member checks in and everyone can see where everyone else stands.
//
// Each member ends its reply with a short self-reported STATUS (where its part
// stands, what remains on its to-do list, what it hands to whoever builds on
// its work). The runner extracts the status, STRIPS it from the work product
// (a check-in is coordination, not deliverable), and every brief assembled
// after that moment carries the live board: objective state (WAITING /
// WORKING / DONE, known from the scheduler) plus each member's own words.
// This is the record keeper's feed — a LEAD reads the same board the members
// and the witness see.
//
// Pure throughout: extraction and rendering are decisions on strings; the
// runner owns the mutable state and passes snapshots in.

// Appended to every coordinated brief (plans that carry a goal). The general
// path's wording is versionless; the LOCKED trial adopts a versioned form at
// its next TRIAL_VERSION bump.
export const STATUS_ASK =
  'End your reply with a line that says exactly "STATUS:" followed by 2-5 short lines for the team board: ' +
  'where your part stands, anything left on your to-do list, and what you hand to whoever builds on your work.';

// THE ONE SIGN-OFF (Design note, 2026-10-11: STATUS (for the board) and TORCH (for the
// member's next instance) overlapped — both carried the handoff — and members
// spent thinking walking two formats with line counts. One block now serves
// as both; the run files it as the board status AND the member's torch.
export const SIGNOFF_ASK =
  'End your reply with a line that says exactly "STATUS:" and a few short lines: where your part stands, ' +
  'what is left, and what whoever picks it up next — a teammate, or your own next instance — needs to know.';

// pure — split a member's reply into the work product and its status check-in.
// The status is everything after the LAST line that starts with "STATUS:",
// and — when the reply contains fenced code — only a marker AFTER the last
// fence counts: a "STATUS:" inside delivered code (a log line, a comment) is
// work product, never mistaken for a check-in. A reply without one simply has
// none (recorded honestly as null, never invented).
/**
 * @param {string} output
 * @returns {{ body: string, status: ?string }}
 */
export const extractStatus = (output) => {
  if (typeof output !== 'string') return { body: '', status: null };
  const lastFence = output.lastIndexOf('```');
  const searchFrom = lastFence >= 0 ? lastFence : 0;
  const tail = output.slice(searchFrom);
  const m = tail.match(/^[ \t]*STATUS:(?![\s\S]*^[ \t]*STATUS:)/m);
  if (!m || m.index == null) return { body: output.trim(), status: null };
  const at = searchFrom + m.index;
  const body = output.slice(0, at).trim();
  const status = output.slice(at).replace(/^[ \t]*STATUS:[ \t]*/, '').trim();
  return { body, status: status || null };
};

/**
 * @typedef {Object} BoardEntry
 * @property {string} id - step id
 * @property {?string} role
 * @property {string} neumaId
 * @property {'waiting'|'working'|'done'|'failed'} state - the scheduler's objective truth
 * @property {?string} status - the member's own check-in, when it posted one
 */

// pure — one board snapshot from the runner's bookkeeping. State is OBJECTIVE
// (what the scheduler knows), status is SUBJECTIVE (what the member said) —
// the board carries both and never lets one impersonate the other. A step
// whose member's conduit failed says so — never 'waiting' as if it might run.
/**
 * @param {Object} args
 * @param {Array} args.steps - the full plan
 * @param {Record<string, string>} args.results - completed step id -> output
 * @param {Set<string>} args.working - step ids currently in flight
 * @param {Record<string, ?string>} args.statuses - step id -> extracted status
 * @param {Record<string, string>} [args.failures] - step id -> error message
 * @returns {BoardEntry[]}
 */
export const boardEntries = ({ steps, results, working, statuses, failures = {} }) =>
  steps.map((s) => ({
    id: s.id,
    role: s.role ?? null,
    neumaId: s.neumaId,
    state: results[s.id] != null ? 'done'
      : failures[s.id] != null ? 'failed'
      : working.has(s.id) ? 'working'
      : 'waiting',
    status: statuses[s.id] ?? null,
  }));

// pure — the board as it enters a brief. The reader finds itself marked (YOU),
// sees everyone's objective state, and reads teammates' check-ins verbatim.
/**
 * @param {BoardEntry[]} entries
 * @param {string} selfId - the step this brief is for
 * @returns {string}
 */
export const renderBoard = (entries, selfId) => {
  const line = (e) => {
    const who = e.role || e.id;
    const head = `— ${who}${e.id === selfId ? ' (YOU)' : ''} [${e.state.toUpperCase()}]`;
    return e.status
      ? `${head}\n${e.status.split('\n').map((l) => `    ${l}`).join('\n')}`
      : head;
  };
  return `TEAM BOARD — where everyone stands right now:\n${entries.map(line).join('\n')}`;
};
