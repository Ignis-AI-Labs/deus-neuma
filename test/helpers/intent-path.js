/**
 * Drive an act the way a being does — through the INTENT path.
 *
 * The catalog cut (#414) retired ~20 mutating tools to intents: their policy
 * rows moved with them, so a test that still drives the old tool name fails
 * `checkToolAccess` closed and raises an approval card no harness answers. That
 * is a 30-second timeout, not a failure message, which is how it hid in
 * api-memory-tools for days.
 *
 * A being files `intents/<name>.json` into its own lane with ordinary
 * filesystem tools; the sweep settles it. These helpers do exactly that and
 * nothing more.
 *
 * ⚠️ ALWAYS GO THROUGH `sweep`. The sweep IS the dispatch layer, and dispatch is
 * where the ACTS tier and the session mode gate live. Calling an intent's
 * `execute()` directly sails past both and will report a pass on a security
 * property it never exercised.
 *
 * THE OBSERVE CONTRACT, because it surprises people: a held intent yields NO
 * receipt and leaves the filing PENDING on disk. Watching is not a verdict — the
 * act was never judged, so it waits for a mode that can judge it. Asserting
 * 'denied' there would claim a rejection that never happened.
 */
import fs from 'fs/promises';
import path from 'path';
import workspace from '../../core/workspace/neuma-workspace.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';

const FILING = 'act';

/** The lane's intents directory — the same one `intentsDirFor` resolves. Pure-ish. */
export const intentDir = (connection) =>
  path.join(workspace.pathFor(connection.companion.neumaId), 'intents');

/**
 * File exactly one intent, clearing anything left over so the sweep returns
 * exactly one receipt and no test inherits another's pending filing.
 */
export const fileIntent = async (connection, type, payload) => {
  const dir = intentDir(connection);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${FILING}.json`), JSON.stringify({ type, ...payload }));
};

/**
 * Settle whatever is filed, through the REAL sweep. Receipts share the tool
 * result shape ({status, content, error}), so assertions read the same as they
 * did through the tool.
 *
 * `lanePolicy` is the being's own persisted policy, exactly as the turn path
 * reads it — needed for any intent whose row is `requireApproval` (publish,
 * every tasks/leads/campaigns mutation), because otherwise the sweep raises a
 * card no harness answers and the test hangs with no message.
 */
export const sweep = (connection, mode = 'ask', lanePolicy = null, emit = () => {}) =>
  sweepIntents(connection, { mode, lanePolicy, emit });

/**
 * A persisted ALWAYS grant on one or more intents — what the operator's chip
 * leaves behind, expressed as the lane policy the sweep reads.
 * @param {...string} policyTools e.g. 'vault.publish', 'tasks.add'
 */
export const granting = (...policyTools) =>
  ({ intents: { allowed: [...policyTools] } });

/** Was the filing SETTLED, or is it still waiting? A settled intent has a result beside it. */
export const settled = (connection) =>
  fs.stat(path.join(intentDir(connection), `${FILING}.result.json`)).then(() => true, () => false);

/** File one intent and settle it — the common case. */
export const viaIntent = async (connection, type, payload, mode = 'ask', lanePolicy = null, emit = () => {}) => {
  await fileIntent(connection, type, payload);
  return sweep(connection, mode, lanePolicy, emit);
};
