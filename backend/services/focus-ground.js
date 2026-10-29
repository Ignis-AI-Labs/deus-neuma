/**
 * THE FOCUS GROUND — one folder, one field of attention.
 *
 * The operator binds a folder to each stream independently. Inside that
 * stream's focus, work happens under its normal act policy. Outside it,
 * ordinary path-grant rules hold. Focus is transient ownership; an explicit
 * ALWAYS grant has a separate lifetime. One stream never replaces another's
 * chosen folder or turns that folder into a permanent filesystem grant.
 *
 * The architecture this replaces asked the question three different ways —
 * project folders bounded a neuma's write grants, a witness saw only a
 * disposable snapshot, and the focused folder itself granted NOTHING. The one
 * place the operator's own open folder should have been authoritative was the
 * one place the permission system never looked.
 *
 * TWO AXES, AND THEY NEVER MIX:
 *
 *   FOCUS decides REACH   — WHERE a participant may act (this module).
 *   MODE  decides ASKING  — WHETHER an act needs the operator's yes
 *                           (tool-policy.js: ask / auto / observe, held
 *                           per participant on its own connection).
 *
 * Focus can never make ASK or OBSERVE more permissive. It retires the PATH
 * question ([…]) and never the ACT question ([…]). So delete_file still raises its card inside the focus ground while
 * the participant is on `ask`, and observe mode still holds every acting tool
 * no matter how plainly the folder is open. A participant on `auto` works
 * silently; its housemate on `ask` still asks. ONE meeting point (Founder,
 * 2026-10-28, open-folder-autonomy.js): on AUTO, the open folder is where a
 * being works FOR REAL — its shell runs live there (.git and secrets masked)
 * and a delete inside it needs no card.
 *
 * TRUST: `connection.toolWorkspace` is not raw client input by the time it
 * reaches here — portal-routes.js runs every incoming value through
 * `resolveFocusPath` (user-files.js), the one focus-path chokepoint, which
 * requires an absolute path, resolves symlinks, demands an existing
 * directory, and — decisively — demands it sit inside a root the operator
 * has explicitly OPENED. A focus ground is therefore always a folder the
 * operator opened by hand. That is what makes it safe to treat as standing
 * consent, and it is why this module can be a pure read of that field.
 *
 * The sandbox's denied-path list still fires first, inside the ground and
 * out: focus never opens .env, keys, another being's DNA, or the Neuma
 * install's own config.
 */

/**
 * The focus ground bound to a connection, or null when the desk is unfocused.
 * Pure — the value was validated at the portal boundary (see TRUST above).
 * @param {Object} connection - portal connection
 * @returns {string|null} absolute, symlink-resolved directory, or null
 */
export const focusGroundOf = (connection) => {
  const ground = connection?.toolWorkspace;
  return typeof ground === 'string' && ground.length > 0 ? ground : null;
};

/**
 * The focus ground as a roots array, ready to concatenate into any sandbox
 * root list. Empty when the desk is unfocused — an unfocused desk grants
 * nothing, so every participant falls back to its own lane exactly as before.
 * Pure.
 * @param {Object} connection - portal connection
 * @returns {string[]} zero or one absolute directory
 */
export const focusGroundRoots = (connection) => {
  const ground = focusGroundOf(connection);
  return ground ? [ground] : [];
};

/**
 * Land the focus ground at the layer that would otherwise refuse it underneath.
 *
 * The native filesystem organ enforces its own roots below policy and
 * sandbox checks. Declare this connection's transient ownership before tool
 * execution; rebuilds take the union of live owners and explicit grants.
 * Clearing focus must also reach this path so old transient reach retires.
 *
 * Never throws: a filesystem server that will not widen is a degraded turn, not
 * a dead one. The refusal is logged and the sandbox still fails closed on its
 * own terms, so nothing opens that should not.
 *
 * impure — updates native roots when the union of live stream focus changes.
 * @param {Object} connection - portal connection
 * @param {{logger?: Object}} [deps] - production logging context
 * @returns {Promise<void>}
 */
export const ensureFocusGroundReachable = async (connection, deps = {}) => {
  const ground = focusGroundOf(connection);
  const { logger } = deps;
  try {
    await (await import('./mcp-filesystem.js')).ensureFilesystemFocus(connection);
  } catch (err) {
    (logger ?? console).warn?.('Filesystem server did not accept the focus ground', {
      ground, error: err.message,
    });
  }
};
