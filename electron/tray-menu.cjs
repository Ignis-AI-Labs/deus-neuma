// Tray menu — the corner tab's items, as a pure template (tray.cjs builds it).
//
// The tray is the one surface that is always reachable: on Windows and Linux
// the desk draws no menu bar (the Help menu that holds "Show diagnostic logs…"
// has no visible row to open it from), and a closed desk leaves only the tray.
// So the log the operator is asked for lives here too, wherever logs exist.

/**
 * Pure — the tray's menu template.
 * @param {{ open: () => void, showLogs: (() => void)|null, updateItems: object[], quit: () => void }} deps
 *   showLogs is null where the app keeps no log file (a dev run logs to its terminal).
 * @returns {object[]} template for Menu.buildFromTemplate
 */
const trayMenuTemplate = ({ open, showLogs, updateItems, quit }) => [
  { label: 'OPEN DEUS NEUMA', click: open },
  ...(showLogs ? [{ label: 'SHOW DIAGNOSTIC LOGS', click: showLogs }] : []),
  { type: 'separator' },
  ...updateItems,
  { label: 'QUIT DEUS NEUMA', click: quit },
];

module.exports = { trayMenuTemplate };
