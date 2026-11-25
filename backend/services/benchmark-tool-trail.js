// benchmark-tool-trail — WHAT THE BEING TOUCHED (#564). A benchmark sitting's
// NEUMA arm keeps its tools and its internet (Design note, 2026-09-26: […]). A
// count of tool calls cannot show that; the trail can. Every call a benchmark
// sitting makes rides its agent receipt: the tool, what it touched (the URL,
// the path, the query, the command), and how it settled — so a run can be
// audited for an answer-key lookup or a write outside its sandbox. It records,
// never blocks. Outside a benchmark sitting this records nothing.
//
// A failed call also keeps WHY (tool fluency, Design note, 2026-11-12: the refusal or
// error text, and the argument NAMES the model wrote — never their values. A
// census of 51,810 requests could not tell a model's misnamed field from a
// harness fault, because the trail kept only […].

/** The longest target a trail entry keeps — enough to read a URL or path. */
export const TRAIL_TARGET_MAX_CHARS = 200;
/** The longest refusal/error text a trail entry keeps — the reason, not a dump. */
export const TRAIL_MESSAGE_MAX_CHARS = 300;
/** The most argument names one entry keeps; a call with more is malformed anyway. */
export const TRAIL_ARG_KEYS_MAX = 24;

// The argument names that say what a call touched, most specific first.
const TARGET_KEYS = Object.freeze(['url', 'path', 'file_path', 'filePath', 'query', 'command', 'cmd', 'name']);

/**
 * pure — what one call touched, from its arguments; null when nothing names it.
 * @param {*} args the call's arguments as dispatched
 * @returns {?string}
 */
export const trailTargetOf = (args) => {
  if (!args || typeof args !== 'object') return null;
  const key = TARGET_KEYS.find((k) => typeof args[k] === 'string' && args[k].trim() !== '');
  if (!key) return null;
  return oneLine(args[key], TRAIL_TARGET_MAX_CHARS);
};

const oneLine = (text, max) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/**
 * pure — the argument NAMES a call carried, in the order written; never a value.
 * null when the arguments were not an object (unreadable JSON, a bare string).
 * @param {*} args
 * @returns {?string[]}
 */
export const trailArgKeysOf = (args) => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return Object.keys(args).slice(0, TRAIL_ARG_KEYS_MAX).map((k) => (k.length > 64 ? `${k.slice(0, 63)}…` : k));
};

/**
 * pure — why a call did not succeed, from its result; null for a call that ran
 * (ok) or was handed back (yielded). Only the harness's own words (`error`),
 * never a tool's output.
 * @param {{status?: string, error?: *}} result
 * @returns {?string}
 */
export const trailMessageOf = (result) => {
  if (!result || ['ok', 'yielded'].includes(result.status)) return null;
  const text = typeof result.error === 'string' ? result.error : result.error?.message;
  return typeof text === 'string' && text.trim() !== '' ? oneLine(text, TRAIL_MESSAGE_MAX_CHARS) : null;
};

/**
 * pure — one settled trail entry, for calls that never reach the tool loop
 * (refused before it, handed back to the sender, held as a repeat).
 * @param {string} tool the `server/tool` label
 * @param {*} args the call's arguments
 * @param {{status?: string, error?: *}} result
 */
export const trailEntryOf = (tool, args, result) => {
  const message = trailMessageOf(result);
  return {
    tool, target: trailTargetOf(args), argKeys: trailArgKeysOf(args), status: result?.status ?? 'unknown',
    ...(message ? { message } : {}),
  };
};

/**
 * Record one dispatched call on a benchmark sitting's connection, and hand the
 * call back unchanged so the dispatch site stays one expression.
 * impure — appends to `connection._benchmarkToolTrail` (the receipt reads it).
 * @param {object} connection the turn's portal connection
 * @param {{toolName?: string, args?: *}} match the call as dispatched
 * @returns {object} the same match
 */
export const recordBenchmarkToolCall = (connection, match) => {
  if (!connection?._benchmarkControls) return match;
  connection._benchmarkToolTrail = [
    ...(connection._benchmarkToolTrail ?? []),
    { tool: match?.toolName ?? 'unknown', target: trailTargetOf(match?.args), argKeys: trailArgKeysOf(match?.args), status: null },
  ];
  return match;
};

/**
 * pure — where a batch's entries will start, so the batch settles only its own.
 * @param {object} connection
 * @returns {number}
 */
export const benchmarkTrailMark = (connection) => connection?._benchmarkToolTrail?.length ?? 0;

/**
 * Settle one batch's calls with their outcomes. processToolCalls records one
 * entry and yields one result per dispatched call, in dispatch order, so its
 * results close the entries IT opened (from `mark` on) in order — each result
 * also carries the resolved `server/tool` label the dispatch site did not know
 * yet. Settled by the batch itself: the round's result list also holds
 * refusals and held repeats that never opened an entry, and settling against
 * that list handed one call's outcome to another.
 * impure — fills `tool`, `status` and `message` on `connection._benchmarkToolTrail` entries.
 * @param {object} connection the turn's portal connection
 * @param {Array<{tool?: string, status?: string, error?: *}>} results the batch's tool results
 * @param {number} [mark] the trail length before the batch (benchmarkTrailMark)
 */
export const settleBenchmarkToolTrail = (connection, results, mark = 0) => {
  if (!connection?._benchmarkControls || !Array.isArray(connection._benchmarkToolTrail)) return;
  const open = connection._benchmarkToolTrail.slice(mark).filter((e) => e.status === null);
  (results ?? []).forEach((r, i) => {
    if (!open[i]) return;
    if (typeof r?.tool === 'string') open[i].tool = r.tool;
    open[i].status = r?.status ?? 'unknown';
    const message = trailMessageOf(r);
    if (message) open[i].message = message;
  });
};
