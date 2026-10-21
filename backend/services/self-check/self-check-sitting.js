/**
 * THE SELF-CHECK SITTING. The being's own flight check (Design note, 2026-10-19: […]) asks it to FIND its own memories, records, tools, house and
 * seat — so unlike a benchmark sitting, its memory server and recall stay ON.
 * And unlike a chat, it leaves NOTHING behind: a check that wrote what it was
 * asked into memory would grade the next item on its own questions.
 *
 * Two halves, each enforced at an existing seam:
 *   - nothing of the platform's memory machinery persists (session rows,
 *     crystallization, affect, the usual-tools record, the turn card) — the
 *     ephemeral predicates in portal-turn-persist.js include this sitting;
 *   - only acts that cannot change state run (OBSERVATION_TOOLS, the platform's
 *     own list), minus anything that leaves the machine and minus post_check,
 *     which collects — moves the being's read cursor. Everything else is
 *     refused on the spot with a reason the being reads.
 *
 * Pure.
 */
import { OBSERVATION_TOOLS } from '../tool-policy.js';
import { catalogEntryOf } from '../closed-book.js';

// Observation that reaches off the machine, or moves a cursor: not a self-read.
const NOT_SELF_READS = Object.freeze(new Set([
  'web_search', 'web_fetch', 'platform_data', 'read_x', 'image_search',
  'chain_chains', 'chain_balance', 'chain_token', 'chain_call', 'chain_logs', 'chain_holders',
  'post_check',
]));

/** The tools a self-check sitting runs: every state-free read of the being's own world, and the tool door. */
export const SELF_CHECK_TOOLS = Object.freeze(new Set([
  ...[...OBSERVATION_TOOLS].filter((name) => !NOT_SELF_READS.has(name)),
  // The vault's reads went live again (vault-being-tools.js); OBSERVATION_TOOLS' note predates that.
  'vault_list', 'vault_read', 'vault_search', 'vault_history',
  'substrate_facts', 'tool_search', 'board_list', 'house_state',
]));

/** The refusal a self-check act receives. */
export const SELF_CHECK_REFUSAL = 'This is a read-only self-check: only reads of your own records, house and tools run here. '
  + 'Nothing is written, sent or changed during it. Answer from what you can read.';

/** pure — is this sitting a self-check? */
export const isSelfCheckSitting = (connection) => connection?._selfCheck === true;

/**
 * pure — split a round's acts into those a self-check runs and those it refuses
 * (each with the refusal result it settles as). Outside a self-check nothing is
 * refused. The server a model writes is a claim: only a (server, name) pair the
 * turn's catalog carries resolves (closed-book.js catalogEntryOf).
 * @returns {{allowed: Array, refused: Array<{act: object, result: object}>}}
 */
export const selfCheckSplit = (connection, acts) => {
  if (!isSelfCheckSitting(connection)) return { allowed: acts, refused: [] };
  const allowed = [];
  const refused = [];
  for (const act of acts) {
    const entry = catalogEntryOf(connection, act);
    if (entry && SELF_CHECK_TOOLS.has(entry.name)) allowed.push(act);
    else {
      refused.push({
        act,
        result: { tool: `${act?.server ?? 'unknown'}/${act?.toolName ?? 'unknown'}`, status: 'denied', error: SELF_CHECK_REFUSAL },
      });
    }
  }
  return { allowed, refused };
};
