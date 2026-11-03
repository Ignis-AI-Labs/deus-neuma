// files-refresh — which acts change what the Explorer is showing.
//
// Founder, live 2026-07-26: two beings worked in his focused repository — created
// `repos/chronicle`, wrote the first file into it — and the Explorer went on
// showing the tree it had fetched at mount. Real work looked like nothing had
// happened. The FILES tree already listens for `neuma:files-changed` (the
// editor fires it on save); nothing ever fired it for a being's act.
//
// Pure decision so both streams — the one-on-one portal and the council room —
// share one rule instead of drifting apart.

// Acts that CHANGE the tree. A read never does: re-listing a directory because
// somebody looked at a file would put the Explorer in a refresh loop during
// ordinary work, for no visible gain.
const MUTATING_TOOLS = new Set([
  'write', 'edit', 'copy', 'move', // the fs primitives (edit also covers legacy transfer/delete sub-ops)
  'write_file', 'edit_file', 'create_file', 'create_directory',
  'move_file', 'copy_file', 'rename_file', 'delete_file', // retired spellings (council frames, old records)
]);

/**
 * The path whose DIRECTORY the Explorer should re-list after an act, or null
 * when the act changed nothing on disk.
 *
 * @param {{tool?: string, status?: string, ok?: boolean, path?: string}} act
 *   a `tool:usage` or `council:tool` frame
 * @returns {string|null}
 */
export const changedPath = (act) => {
  if (!act || typeof act !== 'object') return null;
  // A refused or errored act moved nothing — refreshing on it would make a
  // denial look like a change.
  if (act.ok === false) return null;
  if (act.status && act.status !== 'ok') return null;
  const path = typeof act.path === 'string' && act.path.length > 0 ? act.path : null;
  if (!path) return null;
  // `server/tool` or a bare tool name — both reach this from different frames.
  const tool = String(act.tool || '').split('/').pop().toLowerCase();
  return MUTATING_TOOLS.has(tool) ? path : null;
};

/**
 * impure — tell every mounted FILES surface that this path's directory moved.
 * A no-op for acts that changed nothing, so callers can hand it every frame.
 * @param {object} act - a `tool:usage` or `council:tool` frame
 */
export const announceFileChange = (act) => {
  const path = changedPath(act);
  if (!path) return;
  window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { path } }));
};
