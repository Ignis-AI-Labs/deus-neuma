// files-menu.js — the pure item tables of the desk's folder/file right-click
// menus (Design note, 2026-07-24: […]).
//
// Three surfaces, one shape: the FILES tree, the FolderPicker's rows (and its
// list background — the CURRENT folder's own actions), and the FolderShelf.
// Items are `{ kind:'item', id, label, danger? }` with `{ kind:'separator' }`
// between groups — the same shape the desktop context menu's pure helpers
// (moveSelection / clampPosition) already speak, so CtxMenu reuses them.
// Pure — no React, no browser globals; the HOSTS own what each id does.

const item = (id, label, opts = {}) => ({ kind: 'item', id, label, ...opts });
const sep = () => ({ kind: 'separator' });

/**
 * Collapse a build-up of groups into a clean menu: no leading/trailing
 * separators, never two in a row. Pure.
 * @param {Array<{kind:string}>} items
 */
export const pruneSeparators = (items) => {
  const out = [];
  for (const it of items) {
    if (it.kind === 'separator') {
      if (out.length === 0 || out[out.length - 1].kind === 'separator') continue;
    }
    out.push(it);
  }
  while (out.length && out[out.length - 1].kind === 'separator') out.pop();
  return out;
};

const pinLabel = (pinned) => (pinned ? 'UNPIN FAVORITE' : 'PIN TO FAVORITES');

/**
 * Is this path an HTML page a browser can open? Pure.
 * @param {unknown} p
 */
const isHtmlPath = (p) => {
  const lower = String(p || '').toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
};

/**
 * The FILES tree row menu. Every hover-action the row already offers, plus
 * the shelf pin and the focus lens — a file opens, a folder can become this
 * window's working focus. Roots keep their close; an open root still can't
 * be renamed or deleted (backend law, so the menu never offers it).
 * @param {{entry: {path:string, type:string}, isRoot: boolean, pinned: boolean}} p
 */
export const treeMenuItems = ({ entry, isRoot, pinned }) => {
  const isDir = entry.type === 'dir';
  return pruneSeparators([
    ...(isDir
      ? [item('focus', 'SET AS WORKING FOCUS'), sep(), item('new-file', 'NEW FILE'), item('new-folder', 'NEW FOLDER')]
      : [item('open-file', 'OPEN'), ...(isHtmlPath(entry.path) ? [item('open-in-browser', 'OPEN IN BROWSER')] : [])]),
    sep(),
    ...(!isRoot ? [item('rename', 'RENAME'), item('delete', 'DELETE', { danger: true })] : []),
    sep(),
    ...(isDir ? [item('pin', pinLabel(pinned))] : []),
    item('refresh', 'REFRESH'),
    item('copy-path', 'COPY PATH'),
    item('show-in-folder', 'OPEN CONTAINING FOLDER'),
    ...(isRoot ? [sep(), item('close-root', 'CLOSE FOLDER')] : []),
  ]);
};

/**
 * The FolderPicker menu — rows, and the list background as the CURRENT
 * folder's own menu. In file mode a folder is never itself the pick, so
 * OPEN THIS FOLDER only appears when the picker picks folders; a file row
 * exists only in file mode, where it IS the pick.
 * @param {{entry: {path:string, dir?:boolean}, pinned: boolean, pickFile: boolean, background?: boolean}} p
 */
export const pickerMenuItems = ({ entry, pinned, pickFile, background = false }) => {
  if (background) {
    return pruneSeparators([
      ...(!pickFile ? [item('pick', 'OPEN THIS FOLDER')] : []),
      item('new-folder-here', 'NEW FOLDER'),
      sep(),
      item('pin', pinLabel(pinned)),
      item('copy-path', 'COPY PATH'),
    ]);
  }
  if (entry.dir === false) {
    return pruneSeparators([
      ...(pickFile ? [item('choose-file', 'CHOOSE THIS FILE')] : []),
      item('copy-path', 'COPY PATH'),
    ]);
  }
  return pruneSeparators([
    item('enter', 'ENTER FOLDER'),
    ...(!pickFile ? [item('pick', 'OPEN THIS FOLDER')] : []),
    sep(),
    item('pin', pinLabel(pinned)),
    item('copy-path', 'COPY PATH'),
  ]);
};

/**
 * The FolderShelf row menu — the macros' own gestures, spelled out.
 * @param {{pinned: boolean, recent: boolean}} p - recent = a RECENTS row
 */
export const shelfMenuItems = ({ pinned, recent }) => pruneSeparators([
  item('open', 'OPEN'),
  sep(),
  item('pin', pinLabel(pinned)),
  ...(recent ? [item('dismiss', 'REMOVE FROM RECENTS')] : []),
  item('copy-path', 'COPY PATH'),
]);
