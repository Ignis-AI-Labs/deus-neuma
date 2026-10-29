// media-menu — what a piece of content media offers when the operator reaches
// for it: one menu for every image and clip the desk shows.
//
// Design note, 2026-10-23, right-clicking a forge clip on a TikTok queue card: […]
//
// So the menu keeps what the browser's own video options held (full screen,
// download, mute, playback speed, picture in picture — and loop, show controls)
// and what an image needs (view full screen, download, copy image, copy path),
// and adds the two ways home: OPEN IN GALLERY and SHOW IN FILES. An item that
// cannot apply is absent, never greyed: no file on disk means no path items, a
// relayed remote picture has no gallery to go to.
//
// Pure decisions (no React, no browser globals), plus the one event that asks
// the desk host for the menu and the handlers a media surface wears;
// MediaMenuHost.jsx does the acting. Items speak CtxMenu's shape
// (files-menu.js): `{kind:'item', id, label, checked?, stay?}` / separators.

import { baseName, isAbsolutePath } from '../../utils/path.js';
import { pruneSeparators } from './files/files-menu.js';

const item = (id, label, opts = {}) => ({ kind: 'item', id, label, ...opts });
const sep = () => ({ kind: 'separator' });

/** The speeds the browser's own menu offers. */
export const SPEEDS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);

/** Pure — a speed as a person reads it. */
const speedLabel = (rate) => (rate === 1 ? 'Normal' : `${rate}×`);

const FORGE_IMAGE = /^\/api\/v1\/image-forge\/images\/([^/?#]+)(?:[?#]|$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure — the forge render id an image URL names, or null. Every forge still and
 * clip the desk shows rides the lane-scoped `/api/v1/image-forge/images/<id>`
 * route, so the URL alone says which render it is.
 * @param {unknown} src
 * @returns {string|null}
 */
export const forgeImageIdOf = (src) => {
  const found = typeof src === 'string' ? FORGE_IMAGE.exec(src) : null;
  if (!found) return null;
  try { return decodeURIComponent(found[1]) || null; } catch { return null; }
};

/**
 * Pure — the render id a stored file's NAME carries, or null. A being's render
 * is written as `<imageId>.<ext>` (image-store.js), so a queued clip's path
 * still says which render it is.
 * @param {unknown} path
 * @returns {string|null}
 */
const renderIdOfPath = (path) => {
  if (typeof path !== 'string' || !path) return null;
  const name = baseName(path);
  const stem = name.lastIndexOf('.') > 0 ? name.slice(0, name.lastIndexOf('.')) : name;
  return UUID.test(stem) ? stem : null;
};

/** Pure — a path the desk can name on disk (absolute, no NUL). */
export const isLocalPath = (path) => typeof path === 'string' && !path.includes('\0') && isAbsolutePath(path);

const EXT_OF_MIME = Object.freeze({
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
});

/**
 * Pure — the file name a download is saved under: the file's own name when it
 * has one, else its render id, else what it is — always with an extension.
 * @param {{kind?: string, name?: string, path?: string, imageId?: string, mime?: string}} media
 * @returns {string}
 */
export const downloadNameOf = (media = {}) => {
  const own = media.name || (isLocalPath(media.path) ? baseName(media.path) : '');
  if (own && /\.[A-Za-z0-9]{2,5}$/.test(own)) return own;
  const ext = EXT_OF_MIME[String(media.mime || '').split(';')[0]] || (media.kind === 'video' ? 'mp4' : 'png');
  const stem = own || media.imageId || (media.kind === 'video' ? 'video' : 'image');
  return `${stem}.${ext}`;
};

/**
 * Pure — the menu a piece of media raises.
 *
 * `player` is the live clip's state (null for a still, or for a clip that is
 * only a tile with no player under it); `fullscreen` whether the page may go
 * full screen; `inGallery` drops the gallery door inside the gallery itself;
 * `canCopyImage` whether the clipboard takes pictures here; `explorer` whether
 * the desk's Explorer can show the file's folder through the window's focus
 * lens (opening never moves the focus, so a folder the lens hides is not
 * offered there); `desktop` whether the system file manager is reachable.
 *
 * @param {{kind: 'image'|'video', src?: string, path?: string, imageId?: string}} media
 * @param {{player?: {paused: boolean, muted: boolean, loop: boolean, controls: boolean, rate: number, pip: boolean, pipOn: boolean}|null,
 *   fullscreen?: boolean, inGallery?: boolean, canCopyImage?: boolean, explorer?: boolean, desktop?: boolean}} [env]
 * @returns {Array<{kind: 'item'|'separator', id?: string, label?: string, checked?: boolean, stay?: boolean}>}
 */
export const mediaMenuItems = (media, env = {}) => {
  const video = media?.kind === 'video';
  const player = video ? env.player || null : null;
  const shown = typeof media?.src === 'string' && media.src !== '';
  const local = isLocalPath(media?.path);
  const renderId = media?.imageId || renderIdOfPath(media?.path);
  return pruneSeparators([
    // A still opens in the desk's loupe; a clip goes full screen on its player.
    ...(shown && (video ? player && env.fullscreen : true) ? [item('full-screen', 'View full screen')] : []),
    ...(player?.pip ? [item('pip', player.pipOn ? 'Leave picture in picture' : 'Picture in picture')] : []),
    sep(),
    ...(player ? [
      item('play', player.paused ? 'Play' : 'Pause'),
      item('mute', player.muted ? 'Unmute' : 'Mute'),
      item('loop', 'Loop', { checked: Boolean(player.loop) }),
      item('controls', 'Show controls', { checked: Boolean(player.controls) }),
      item('speed-page', `Playback speed: ${speedLabel(player.rate)}  ›`, { stay: true }),
    ] : []),
    sep(),
    ...(!env.inGallery && (renderId || local) ? [item('open-gallery', 'Open in gallery')] : []),
    ...(local && env.explorer !== false ? [item('show-in-files', 'Show in files')] : []),
    ...(local && env.desktop ? [item('show-in-file-manager', 'Show in file manager')] : []),
    sep(),
    ...(shown ? [item('download', 'Download')] : []),
    ...(shown && !video && env.canCopyImage ? [item('copy-image', 'Copy image')] : []),
    ...(local ? [item('copy-path', 'Copy path')] : []),
  ]);
};

/**
 * Pure — the playback-speed page: the way back, then every speed with the
 * current one marked.
 * @param {number} rate
 */
export const speedMenuItems = (rate) => [
  item('speed-back', '‹  Playback speed', { stay: true }),
  sep(),
  ...SPEEDS.map((s) => item(`speed:${s}`, speedLabel(s), { checked: Math.abs(s - Number(rate)) < 1e-6 })),
];

/**
 * Pure — the speed a `speed:<n>` item names, only if it is one the menu offers.
 * @param {unknown} id
 * @returns {number|null}
 */
export const speedOfItem = (id) => {
  if (typeof id !== 'string' || !id.startsWith('speed:')) return null;
  const rate = Number(id.slice('speed:'.length));
  return SPEEDS.includes(rate) ? rate : null;
};

/**
 * Pure — what the gallery is asked to land on (card-landing.js's gallery item):
 * the render id when the media has one, and the file's path when it is on disk.
 * @param {{imageId?: string, path?: string}} media
 * @returns {{imageId?: string, path?: string}|null}
 */
export const galleryLandingOf = (media = {}) => {
  const imageId = media.imageId || renderIdOfPath(media.path);
  const path = isLocalPath(media.path) ? media.path : null;
  if (!imageId && !path) return null;
  return { ...(imageId ? { imageId } : {}), ...(path ? { path } : {}) };
};

export const MEDIA_MENU_EVENT = 'neuma:media-menu';

/**
 * impure — ask the desk host for a piece of media's menu at a screen point.
 * `el` is the element the gesture landed on (the host finds the player in it).
 */
const openMediaMenu = (media, x, y, el = null) => window.dispatchEvent(
  new CustomEvent(MEDIA_MENU_EVENT, { detail: { media, x, y, el } }),
);

// A keyboard-raised menu (the menu key, Shift+F10) carries no pointer, so it
// opens under the element instead of at the window's corner.
const anchorOf = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.bottom]; };

/**
 * impure — the handlers a media surface wears so right-click, a long press
 * (Chromium raises contextmenu for it) and the keyboard menu key all open the
 * one media menu. `media` may be a function of the element, for a surface whose
 * src is only known once its bytes have loaded.
 * @param {object|((el: Element) => object)} media
 */
export const mediaMenuDoor = (media) => {
  const raise = (e, x, y) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    openMediaMenu(typeof media === 'function' ? media(el) : media, x, y, el);
  };
  return {
    onContextMenu: (e) => {
      if (e.clientX || e.clientY) raise(e, e.clientX, e.clientY);
      else raise(e, ...anchorOf(e.currentTarget));
    },
    onKeyDown: (e) => {
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) raise(e, ...anchorOf(e.currentTarget));
    },
  };
};
