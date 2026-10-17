// Context-menu template — pure derivation from Chromium's context-menu params.
//
// Chromium underlines misspellings, but Electron shows NO right-click menu
// unless the app builds one — so corrections were flagged yet unreachable.
// This module decides WHAT the menu offers (pure, unit-tested);
// desk-windows.cjs binds the items to webContents actions (impure, thin).

const MAX_SUGGESTIONS = 5;

/**
 * Declarative menu items for a right-click. Pure.
 * @param {{misspelledWord?: string, dictionarySuggestions?: string[],
 *          isEditable?: boolean, selectionText?: string}} params
 * @returns {Array<{kind: 'suggestion'|'add-to-dictionary', word: string}
 *         | {kind: 'separator'}
 *         | {kind: 'role', role: 'cut'|'copy'|'paste'|'selectAll'}>}
 */
const buildContextMenuTemplate = (params = {}) => {
  const items = [];

  if (params.misspelledWord) {
    for (const word of (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS)) {
      items.push({ kind: 'suggestion', word });
    }
    // Domain words (neuma, unavis, a being's chosen name…) land here —
    // once added, the substrate's world stops reading as a mistake.
    items.push({ kind: 'add-to-dictionary', word: params.misspelledWord });
    items.push({ kind: 'separator' });
  }

  if (params.isEditable) {
    items.push(
      { kind: 'role', role: 'cut' },
      { kind: 'role', role: 'copy' },
      { kind: 'role', role: 'paste' },
      { kind: 'role', role: 'selectAll' },
    );
  } else if ((params.selectionText || '').trim()) {
    items.push({ kind: 'role', role: 'copy' });
  }

  // A trailing separator with nothing after it is noise, not structure
  while (items.length && items[items.length - 1].kind === 'separator') items.pop();

  return items;
};

module.exports = { buildContextMenuTemplate, MAX_SUGGESTIONS };
