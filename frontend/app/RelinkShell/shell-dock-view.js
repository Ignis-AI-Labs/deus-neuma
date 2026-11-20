// shell-dock-view — what the ShellDock shows of what the chats left running (ShellDock.jsx). Pure.

/**
 * pure — this chat's processes, and every chat's. `everywhere` counts all of them; zero hides the ALL CHATS door.
 * @param {?{supported: boolean, groups: object[]}} board
 * @param {{laneId: ?string, sessionId: ?string, all?: boolean}} at
 */
export const processRows = (board, { laneId, sessionId }) => {
  const groups = board?.groups ?? [];
  const here = groups.filter((g) => g.laneId === laneId && (!sessionId || g.sessionId === sessionId));
  return { here, allRows: groups, everywhere: groups.length };
};

/** pure — how long ago a process started, in a few characters. */
export const ago = (at, now = Date.now()) => {
  const ms = now - Date.parse(at ?? '');
  if (!Number.isFinite(ms) || ms < 0) return 'started —';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'started just now';
  if (m < 60) return `started ${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `started ${h}h ${m % 60}m ago` : `started ${Math.floor(h / 24)}d ago`;
};
