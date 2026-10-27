// gallery-landing — which gallery item a landing names, and where an item
// lives on disk. Pure.
//
// The gallery opens ON an item from outside: a tray card names its render
// (card-landing.js), and since 2026-10-23 any image or clip's menu does too
// ("Open in gallery", media-menu.js) — by the render's id when it has one, and
// by the file's path when it is on disk. The client never sends the gallery an
// absolute path (gallery-routes.js); the match is made here, against the roots
// and the root-relative items the scan already returned.

import { itemOfImage } from './gallery-view.js';

const holds = (dir, path) => path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`);
const trimSep = (p) => String(p || '').replace(/[\\/]+$/, '');

/**
 * Pure — the absolute path of a scanned item, from its root's folder and its
 * root-relative name; null when its root is unknown.
 * @param {{rootId: string, rel: string}} item
 * @param {Array<{id: string, dir: string}>} roots
 * @returns {string|null}
 */
export const pathOfItem = (item, roots) => {
  const root = (Array.isArray(roots) ? roots : []).find((r) => r?.id === item?.rootId);
  if (!root?.dir || typeof item?.rel !== 'string' || !item.rel) return null;
  const dir = trimSep(root.dir);
  return `${dir}${dir.includes('\\') && !dir.includes('/') ? '\\' : '/'}${item.rel}`;
};

/**
 * Pure — the scanned item a file's absolute path names: the innermost root
 * that holds it, then its root-relative name.
 * @param {Array<object>} items
 * @param {Array<{id: string, dir: string}>} roots
 * @param {unknown} path
 * @returns {object|null}
 */
export const itemOfPath = (items, roots, path) => {
  if (typeof path !== 'string' || !path) return null;
  const list = Array.isArray(items) ? items : [];
  const holders = (Array.isArray(roots) ? roots : [])
    .filter((r) => typeof r?.dir === 'string' && r.dir && holds(trimSep(r.dir), path))
    .sort((a, b) => trimSep(b.dir).length - trimSep(a.dir).length);
  for (const root of holders) {
    const rel = path.slice(trimSep(root.dir).length + 1);
    const hit = list.find((it) => it?.rootId === root.id && (it.rel === rel || it.rel === rel.replace(/\\/g, '/')));
    if (hit) return hit;
  }
  return null;
};

/**
 * Pure — the item a landing names: by render id first (a being's art folder
 * names its files by id), then by path.
 * @param {Array<object>} items
 * @param {Array<object>} roots
 * @param {{imageId?: string, path?: string}|null} landing
 * @returns {object|null}
 */
export const itemOfLanding = (items, roots, landing) => {
  if (!landing) return null;
  return itemOfImage(items, landing.imageId) || itemOfPath(items, roots, landing.path);
};
