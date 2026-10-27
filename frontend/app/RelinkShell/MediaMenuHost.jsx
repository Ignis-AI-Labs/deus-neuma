// MediaMenuHost — the desk's hand for […].
//
// Every content image and clip on the desk wears the media menu's door
// (media-menu.js mediaMenuDoor): right-click, a long press, or the keyboard
// menu key asks for the menu, and this host — mounted once beside PathOpener,
// inside the window manager — draws it (CtxMenu) and does the acting: the
// player's own controls, the loupe, the download and clipboard, and the two
// ways home — OPEN IN GALLERY (the gallery lands on the item, card-landing.js)
// and SHOW IN FILES (the Explorer rail opens down to its folder). Showing a
// folder NEVER moves the window's focus (PathOpener's law, Design note, 2026-10-06, so
// a folder the focus lens hides is offered in the system file manager instead.
//
// Renders nothing until asked. A refusal is said, never swallowed.

import { memo, useCallback, useContext, useEffect, useState } from 'react';
import { useWindows } from '../windowing/use-windows.js';
import { FocusContext } from './use-desk-focus.js';
import { useProjects } from './projects/project-context.js';
import { focusRootsOf } from './desk-focus.js';
import { getRoots, openFolder as openFilesRoot } from '../../services/user-files.js';
import { dirOf } from '../../utils/path.js';
import { CtxMenu } from './CtxMenu.jsx';
import { Lightbox } from './Lightbox.jsx';
import { requestCardLanding } from './card-landing.js';
import { explorerShows, revealChain } from './files/reveal-chain.js';
import {
  MEDIA_MENU_EVENT, downloadNameOf, galleryLandingOf, isLocalPath, mediaMenuItems, speedMenuItems, speedOfItem,
} from './media-menu.js';
import {
  actOnPlayer, clipboardTakesImages, copyImageFrom, downloadFrom, fullscreenAllowed, playerIn, playerStateOf,
} from './media-acts.js';

// How long a refusal stays on screen (PathOpener's measure).
const NOTE_MS = 6000;
const PLAYER_ACTS = new Set(['play', 'mute', 'loop', 'controls', 'pip']);

const desktopShell = () => (typeof window !== 'undefined' && typeof window.neuma?.showInFolder === 'function'
  ? window.neuma : null);

const MediaMenuHostView = () => {
  const windows = useWindows();
  const focusLens = useContext(FocusContext);
  const projects = useProjects();
  // The roots the Explorer tree SHOWS through this desk's focus (null: all).
  const within = focusRootsOf(focusLens?.focus ?? null, projects?.projects || null, null);
  const [menu, setMenu] = useState(null); // { media, player, at, page } | null
  const [loupe, setLoupe] = useState(null); // { src, alt } | null
  const [note, setNote] = useState(null);

  useEffect(() => {
    const onMenu = (e) => {
      const { media, x, y, el } = e.detail || {};
      if (!media || (media.kind !== 'image' && media.kind !== 'video')) return;
      setMenu({ media, player: media.kind === 'video' ? playerIn(el) : null, at: { x: Number(x) || 0, y: Number(y) || 0 }, page: 'main' });
    };
    window.addEventListener(MEDIA_MENU_EVENT, onMenu);
    return () => window.removeEventListener(MEDIA_MENU_EVENT, onMenu);
  }, []);

  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  // An unscoped tree takes the file's folder as a root when no open root
  // holds it yet (the tree shows nothing outside its roots). Then the
  // announcement opens a collapsed rail (ExplorerPanel) and the tree walks
  // down to the folder (use-files-roots.js).
  const showInFiles = useCallback(async (path) => {
    const dir = dirOf(path);
    try {
      if (within === null && !revealChain(await getRoots(), dir).length) await openFilesRoot(dir);
    } catch (err) {
      setNote(`Could not show ${path} in files — ${err?.message || 'its folder was refused'}`);
      return;
    }
    window.dispatchEvent(new CustomEvent('neuma:files-focus-root', { detail: { root: dir, reveal: dir, within } }));
  }, [within]);

  const onAct = useCallback((id) => {
    if (!menu) return;
    const { media, player } = menu;
    if (id === 'speed-page' || id === 'speed-back') {
      setMenu((m) => (m ? { ...m, page: id === 'speed-page' ? 'speed' : 'main' } : m));
      return;
    }
    const rate = speedOfItem(id);
    if (rate !== null && player) { player.playbackRate = rate; return; }
    // Called at once, inside the menu's click: the browser grants full screen,
    // picture in picture, play and the clipboard only to a live gesture.
    if (PLAYER_ACTS.has(id) && player) {
      actOnPlayer(player, id).catch((err) => setNote(`The player refused — ${err?.message || 'not allowed here'}`));
      return;
    }
    if (id === 'full-screen') {
      if (player) actOnPlayer(player, 'full-screen').catch(() => setNote('Full screen was refused here.'));
      else setLoupe({ src: media.src, alt: media.alt || media.name || 'image' });
    } else if (id === 'download') {
      downloadFrom(media.src, downloadNameOf(media));
    } else if (id === 'copy-image') {
      copyImageFrom(media.src).then(() => setNote(null), (err) => setNote(`The clipboard refused the image — ${err?.message || 'not allowed here'}`));
    } else if (id === 'copy-path') {
      navigator.clipboard.writeText(media.path).catch(() => setNote('The clipboard refused the path.'));
    } else if (id === 'open-gallery') {
      requestCardLanding('gallery', galleryLandingOf(media));
      windows?.dispatch({ type: 'OPEN', id: 'gallery' });
    } else if (id === 'show-in-files') {
      showInFiles(media.path);
    } else if (id === 'show-in-file-manager') {
      Promise.resolve(desktopShell()?.showInFolder(media.path)).then((r) => { if (!r?.ok) setNote(`The file manager would not take ${media.path}.`); });
    }
  }, [menu, windows, showInFiles]);

  const items = !menu ? []
    : menu.page === 'speed' && menu.player ? speedMenuItems(menu.player.playbackRate)
      : mediaMenuItems(menu.media, {
        player: playerStateOf(menu.player),
        fullscreen: fullscreenAllowed(),
        inGallery: Boolean(menu.media.inGallery),
        canCopyImage: clipboardTakesImages(),
        explorer: isLocalPath(menu.media.path) && explorerShows(within, dirOf(menu.media.path)),
        desktop: Boolean(desktopShell()),
      });

  return (
    <>
      {menu && items.length ? (
        // Keyed by page: turning to the speeds is a fresh menu at the same spot.
        <CtxMenu key={menu.page} at={menu.at} items={items} onAct={onAct} onClose={() => setMenu(null)} />
      ) : null}
      {loupe ? <Lightbox src={loupe.src} alt={loupe.alt} caption={loupe.alt} onClose={() => setLoupe(null)} /> : null}
      {note ? <div className="relink-path-note label-data" role="alert">{note}</div> : null}
    </>
  );
};

// Behind a memo boundary, as PathOpener is: the desk host re-renders every
// streamed frame; this re-renders only on its own state.
export const MediaMenuHost = memo(MediaMenuHostView);
