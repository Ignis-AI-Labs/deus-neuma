// benchmark-tool-trail — WHAT THE BEING TOUCHED (#564). A benchmark sitting's
// NEUMA arm keeps its tools and its internet (Design note, 2026-09-26: […]). A
// count of tool calls cannot show that; the trail can. Every call a benchmark
// sitting makes rides its agent receipt: the tool, what it touched (the URL,
// the path, the query, the command), and how it settled — so a run can be
// audited for an answer-key lookup or a write outside its sandbox. It records,
// never blocks. Outside a benchmark sitting this records nothing.

/** The longest target a trail entry keeps — enough to read a URL or path. */
export const TRAIL_TARGET_MAX_CHARS = 200;

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
  const value = args[key].replace(/\s+/g, ' ').trim();
  return value.length > TRAIL_TARGET_MAX_CHARS ? `${value.slice(0, TRAIL_TARGET_MAX_CHARS - 1)}…` : value;
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
    { tool: match?.toolName ?? 'unknown', target: trailTargetOf(match?.args), status: null },
  ];
  return match;
};

/**
 * Settle the round's calls with their outcomes. processToolCalls yields one
 * result per dispatched call, in dispatch order, so the round's results close
 * the trail's still-open entries in order — each result also carries the
 * resolved `server/tool` label the dispatch site did not know yet.
 * impure — fills `tool` and `status` on `connection._benchmarkToolTrail` entries.
 * @param {object} connection the turn's portal connection
 * @param {Array<{tool?: string, status?: string}>} results the round's tool results
 */
export const settleBenchmarkToolTrail = (connection, results) => {
  if (!connection?._benchmarkControls || !Array.isArray(connection._benchmarkToolTrail)) return;
  const open = connection._benchmarkToolTrail.filter((e) => e.status === null);
  (results ?? []).forEach((r, i) => {
    if (!open[i]) return;
    if (typeof r?.tool === 'string') open[i].tool = r.tool;
    open[i].status = r?.status ?? 'unknown';
  });
};
