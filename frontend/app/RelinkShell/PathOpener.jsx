// PathOpener — the desk's ear for […].
//
// A being names a place — in its speech (Markdown renders the door,
// path-link.js decides which spans are one) or on a tool line ("read /mnt/…",
// ToolChip). Plain click opens it; right-click or Ctrl/⌘+click raises the menu
// (path-menu.js). Relative paths resolve against this window's focused folder.
//
// FILE OPENING NEVER MOVES FOCUS (Design note, 2026-10-06: […] uses the
// file's viewer; a file outside every open Files root brings its folder in as
// a ROOT (the server's containment law), never as the window's focus. Opening
// a folder, or choosing […], deliberately moves the Files lens.
//
// It lives INSIDE both FocusContext and WindowManager because it needs the
// window's focus lens and the window registry. Mounted once at the desk host,
// so every surface that renders speech or tool lines gets the behavior.

import { memo, useCallback, useContext, useEffect, useState } from 'react';
import { FocusContext } from './use-desk-focus.js';
import { useOpenFolder } from './use-open-folder.js';
import { focusFolderPath } from './desk-focus.js';
import { useWindows } from '../windowing/use-windows.js';
import { browseDir, getRoots, openFolder as openFilesRoot, readFile } from '../../services/user-files.js';
import { getPressBoard, pressMarkdown } from '../../services/doc-press-client.js';
import { dirOf, isAbsolutePath } from '../../utils/path.js';
import { isImagePath } from './files/image-view-model.js';
import { uiSound } from '../../services/ui-sound.js';
import { CtxMenu } from './CtxMenu.jsx';
import { pathMenuItems } from './path-menu.js';

// How long a refusal stays on screen. Long enough to read, short enough that
// it never becomes furniture.
const NOTE_MS = 6000;

const desktopShell = () => (typeof window !== 'undefined' && typeof window.neuma?.showInFolder === 'function'
  ? window.neuma : null);
const within = (path, root) => path === root || path.startsWith(`${root.replace(/[\\/]$/, '')}/`)
  || path.startsWith(`${root.replace(/[\\/]$/, '')}\\`);

const PathOpenerView = () => {
  const focusLens = useContext(FocusContext);
  const { openFolder } = useOpenFolder();
  const windows = useWindows();
  const [note, setNote] = useState(null);
  const baseDir = focusFolderPath(focusLens?.focus ?? null);
  const resolvePath = useCallback((path) => {
    if (typeof path !== 'string') return null;
    if (isAbsolutePath(path)) return path;
    return baseDir ? `${baseDir.replace(/[\\/]$/, '')}/${path}` : null;
  }, [baseDir]);

  const [menu, setMenu] = useState(null); // { path, at } | null

  // Folder or file? `browseDir` is the picker's own un-contained walk, so it
  // answers for a path that is not yet an open root.
  const kindOf = useCallback(async (path) => {
    try {
      await browseDir(path);
      return { isDir: true };
    } catch (err) {
      const message = String(err?.message || '');
      if (/not a directory|ENOTDIR/i.test(message)) return { isDir: false };
      return { error: message || 'it is not reachable' };
    }
  }, []);

  // A file the desk may read: its folder joins the open Files ROOTS when no
  // root holds it yet (the server reads only inside roots) — never the focus.
  const readableFile = useCallback(async (path) => {
    const kind = await kindOf(path);
    if (kind.error) { setNote(`Could not open ${path} — ${kind.error}`); return false; }
    if (kind.isDir) { setNote(`${path} is a folder — use Show in file manager or Focus this folder.`); return false; }
    try {
      const roots = await getRoots();
      if (!roots.some((root) => within(path, root))) await openFilesRoot(dirOf(path));
      return true;
    } catch (err) {
      setNote(`Could not open ${path} — ${err?.message || 'its folder was refused'}`);
      return false;
    }
  }, [kindOf]);

  // Open in the file's own viewer; the window's focus is never touched.
  const openFile = useCallback(async (path) => {
    if (!(await readableFile(path))) return;
    uiSound('activate');
    const appId = /\.pdf$/i.test(path) ? 'pdf' : isImagePath(path) ? 'image' : 'editor';
    windows?.dispatch({ type: 'OPEN_NEW', appId, payload: path });
  }, [readableFile, windows]);

  // Press the file into a branded PDF and hand it over as a download (the
  // desktop app asks where to save it).
  const pressFile = useCallback(async (path, kitId) => {
    if (!(await readableFile(path))) return;
    try {
      const { content } = await readFile(path);
      if (typeof content !== 'string' || !content.trim()) { setNote(`${path} has no text to press.`); return; }
      const title = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      setNote(`Pressing ${title}…`);
      const { blob, filename } = await pressMarkdown({ markdown: content, title, kitId: kitId || undefined });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      uiSound('activate');
      setNote(`Pressed ${filename}.`);
    } catch (err) {
      setNote(`Could not press ${path} — ${err?.message || 'the press refused it'}`);
    }
  }, [readableFile]);

  // The deliberate lens move: the folder (or the file's folder) becomes this
  // window's focus.
  const focusFolder = useCallback(async (path) => {
    const kind = await kindOf(path);
    if (kind.error) { setNote(`Could not open ${path} — ${kind.error}`); return; }
    const folder = kind.isDir ? path : dirOf(path);
    const opened = await openFolder(folder);
    if (opened.status !== 'opened') { setNote(`Could not focus ${folder} — ${opened.message || 'the folder was refused'}`); return; }
    uiSound('activate');
  }, [kindOf, openFolder]);

  const openPath = useCallback(async (raw) => {
    const path = resolvePath(raw);
    if (!path) { setNote(`A relative path needs a focused folder: ${raw}`); return; }
    const kind = await kindOf(path);
    if (kind.error) { setNote(`Could not open ${path} — ${kind.error}`); return; }
    if (kind.isDir) await focusFolder(path);
    else await openFile(path);
  }, [resolvePath, kindOf, focusFolder, openFile]);

  const onAct = useCallback(async (id) => {
    const path = resolvePath(menu?.path);
    if (!path) { setNote('A relative path needs a focused folder.'); return; }
    if (id === 'open-file') await openFile(path);
    else if (id.startsWith('press:')) await pressFile(path, id.slice('press:'.length));
    else if (id === 'focus-folder') await focusFolder(path);
    else if (id === 'open-browser') {
      const r = await desktopShell()?.openInBrowser?.(path);
      if (!r?.ok) setNote(`The browser would not take ${path}.`);
    } else if (id === 'show-in-folder') {
      const r = await desktopShell()?.showInFolder(path);
      if (!r?.ok) setNote(`The file manager would not take ${path}.`);
    } else if (id === 'copy-path') {
      try { await navigator.clipboard.writeText(path); } catch { setNote('The clipboard refused the path.'); }
    }
  }, [menu, resolvePath, openFile, pressFile, focusFolder]);

  // The press's brand kits, read the first time a path menu opens (load on
  // demand) and kept; a machine that cannot press offers no Make PDF.
  const [kits, setKits] = useState(null);
  useEffect(() => {
    const onPathMenu = async (e) => {
      const { path, x, y } = e.detail || {};
      if (typeof path !== 'string' || path.length < 2) return;
      if (kits === null) {
        const board = await getPressBoard().catch(() => null);
        setKits(board?.chromium?.available === false ? [] : (board?.kits || []));
      }
      setMenu({ path, at: { x: Number(x) || 0, y: Number(y) || 0 } });
    };
    const onPathOpen = (e) => {
      const path = e.detail?.path;
      if (typeof path === 'string' && path.length >= 2) openPath(path);
    };
    window.addEventListener('neuma:path-menu', onPathMenu);
    window.addEventListener('neuma:path-open', onPathOpen);
    return () => {
      window.removeEventListener('neuma:path-menu', onPathMenu);
      window.removeEventListener('neuma:path-open', onPathOpen);
    };
  }, [kits, openPath]);

  // While the opening modifier is held, every door in view lights up — the
  // operator sees what is reachable BEFORE committing a click, instead of
  // discovering it by clicking and being surprised either way. Cleared on
  // blur too: holding Ctrl and alt-tabbing away must not leave the desk lit.
  useEffect(() => {
    const held = (e) => e.ctrlKey || e.metaKey;
    const apply = (on) => document.body.classList.toggle('mod-open', on);
    const onKeyDown = (e) => { if (held(e)) apply(true); };
    const onKeyUp = (e) => { if (!held(e)) apply(false); };
    const onBlur = () => apply(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      apply(false);
    };
  }, []);

  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  // A surface with no focus lens cannot land anywhere — but it must never
  // swallow the gesture silently, so the refusal still shows.
  return (
    <>
      {menu ? (
        <CtxMenu
          at={menu.at}
          items={pathMenuItems(menu.path, { desktop: Boolean(desktopShell()), kits: kits || [] })}
          onAct={onAct}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {note ? (
        <div className="relink-path-note label-data" role="alert">
          {focusLens ? note : 'This desk has no window focus lens — nothing was opened.'}
        </div>
      ) : null}
    </>
  );
};

// Behind a memo boundary: the desk host re-renders every streamed frame
// (2026-09-28 smoothness pass); this re-renders only when its own inputs do.
export const PathOpener = memo(PathOpenerView);
