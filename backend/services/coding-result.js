// The one text rendering of a finished coding-shell command — the shape both
// seats read. Lives apart from witness-tools.js and being-tool-surface.js so
// the being surface can import it STATICALLY: it reaches witness-tools.js
// dynamically by design, and a static import there would close a cycle.

/**
 * Render a finished command result as the text the model reads.
 * @param {{exitCode: number|null, timedOut: boolean, truncated: boolean, stdout: string, stderr: string, mode?: string}} result
 * @returns {string}
 */
export const renderCommandResult = (result) => [
  ...(result.direct === true ? [
    '[direct] SANDBOX OFF — this command ran directly in the focused folder with the operator\'s normal OS user and environment.',
  ] : result.mode === 'write' ? [
    '[overlay] Writes and deletes in the focused folder affect only this shell\'s overlay; the live folder is unchanged. Exit 0 alone does not prove a path existed or changed. Use filesystem tools for live-folder changes.',
  ] : []),
  `exit_code: ${result.exitCode === null ? 'none' : result.exitCode}`,
  `timed_out: ${result.timedOut}`,
  `output_truncated: ${result.truncated}`,
  ...(result.timing ? [
    `execution_started_at: ${result.timing.startedAt}`,
    `execution_finished_at: ${result.timing.finishedAt}`,
    `execution_duration_ms: ${result.timing.durationMs}`,
  ] : []),
  ...(result.truncated ? ['display: final 50 KiB per stream retained; earlier output omitted. Output truncation did not terminate the command.'] : []),
  result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
  result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
].join('\n');
