// pocket-opening — the pocket's panes, and which one an address opens. Pure.

export const PANES = Object.freeze([
  ['stream', 'STREAM'],
  ['chats', 'CHATS'],
  ['tasks', 'TASKS'],
  ['dreams', 'DREAMS'],
  ['me', 'THIS PHONE'],
]);

/**
 * Where a pocket opens: the pane its address names (the app icon's shortcuts
 * open `/?pane=dreams&record=1`), else the stream. Pure.
 * @param {string} search — location.search
 * @returns {{ pane: string, record: boolean }}
 */
export const openingOf = (search) => {
  const query = new URLSearchParams(search);
  const named = query.get('pane');
  const pane = PANES.some(([id]) => id === named) ? named : 'stream';
  return { pane, record: pane === 'dreams' && query.get('record') === '1' };
};
