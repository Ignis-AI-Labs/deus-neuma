/**
 * Write metering — the team-workspace SPACE budget's two pure halves,
 * extracted from tool-sandbox.js (#171 gave them life, the #290 wall's
 * net-shrink law gave them their own home). The sandbox reads the meter and
 * commits the spend; nothing here touches disk or state.
 */

/**
 * Bytes a write op will land on disk — the meter the team-workspace space
 * budget reads (#171). Counts every content-bearing string arg the
 * filesystem MCP write tools carry: `content` (write/create), and each
 * edit's `newText` (edit_file). Structure-only ops (mkdir, move) meter 0.
 * Pure.
 * @param {Object} args - Tool call arguments
 * @returns {number}
 */
export const writePayloadBytes = (args) => {
  if (!args || typeof args !== 'object') return 0;
  let bytes = 0;
  if (typeof args.content === 'string') bytes += Buffer.byteLength(args.content, 'utf8');
  if (Array.isArray(args.edits)) {
    for (const e of args.edits) {
      if (typeof e?.newText === 'string') bytes += Buffer.byteLength(e.newText, 'utf8');
    }
  }
  return bytes;
};

/**
 * Meter a write against a team workspace's space budget. Pure over the
 * passed state; the caller commits with recordWorkspaceBytes on success.
 * @param {{budgetBytes: number, usedBytes: number}} workspace
 * @param {number} bytes - what this write will add
 * @returns {{allowed: boolean, used: number, budget: number, reason: string|null}}
 */
export const checkWorkspaceBudget = (workspace, bytes) => {
  const used = workspace.usedBytes || 0;
  const budget = workspace.budgetBytes;
  if (used + bytes > budget) {
    return {
      allowed: false, used, budget,
      reason: `Workspace space budget exhausted — ${used.toLocaleString()} of ${budget.toLocaleString()} bytes used; this write needs ${bytes.toLocaleString()} more. Trim the workspace or ask your operator for a larger budget.`,
    };
  }
  return { allowed: true, used, budget, reason: null };
};
