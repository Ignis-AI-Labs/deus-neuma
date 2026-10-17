// path-menu — what a named path offers when the operator reaches for it.
//
// Design note, 2026-10-06: […] So a path is never acted on by a plain click: right-click
// (or Ctrl/⌘+click) raises a menu, and focusing the folder is its own,
// explicitly named choice. Opening a file never moves the window's focus.
//
// Pure decisions, plus the one event that asks for the menu; PathOpener.jsx
// (mounted at the desk host) does the acting.

import { openablePath } from './path-link.js';

/**
 * Pure — does this path read as a file (its last segment carries an
 * extension)? A guess for the menu's wording only; the act checks the disk.
 * @param {string} path
 * @returns {boolean}
 */
export const looksLikeFile = (path) => /\.[A-Za-z0-9_-]{1,12}$/.test(String(path || '').split(/[\\/]/).pop());

/**
 * Pure — the menu a path raises. Files open in the editor; any path can be
 * shown in the system file manager (desktop app only); focusing the folder is
 * the one item that moves the window's lens, and says so.
 * @param {string} path
 * @param {{desktop?: boolean, kits?: Array<{id: string, name?: string}>}} [env] kits — the press's brand kits
 * @returns {Array<{kind: 'item'|'separator', id?: string, label?: string}>}
 */
export const pathMenuItems = (path, { desktop = false, kits = [] } = {}) => {
  const file = looksLikeFile(path);
  // THE PRESS (Design note, 2026-10-06: […]): a markdown or text file presses into a PDF — one
  // item per brand kit, and the neutral look.
  const pressable = file && /\.(md|markdown|txt)$/i.test(path);
  return [
    ...(file ? [{ kind: 'item', id: 'open-file', label: 'Open file' }] : []),
    // a page (a benchmark's report) reads as a page — in the browser, not the editor
    ...(desktop && file && /\.html?$/i.test(path) ? [{ kind: 'item', id: 'open-browser', label: 'Open in browser' }] : []),
    ...(pressable ? [
      ...kits.map((kit) => ({ kind: 'item', id: `press:${kit.id}`, label: `Make PDF — ${kit.name || kit.id}` })),
      { kind: 'item', id: 'press:', label: kits.length ? 'Make PDF — plain' : 'Make PDF' },
    ] : []),
    ...(desktop ? [{ kind: 'item', id: 'show-in-folder', label: 'Show in file manager' }] : []),
    { kind: 'item', id: 'copy-path', label: 'Copy path' },
    { kind: 'separator' },
    { kind: 'item', id: 'focus-folder', label: file ? 'Focus its folder (changes this window’s focus)' : 'Focus this folder (changes this window’s focus)' },
  ];
};

// A filesystem act's line is "<verb> <path>" — built from the act's own args
// (backend portal-tools/tool-events.js toolSummary, TOOL_VERBS). Only those
// verbs make a door: any other tool's line is free text ([…]), and a command's argument must never become a place.
const FS_LINE = /^(read|wrote|edited|created|moved|copied|deleted|listed|searched|grepped) (.+)$/;

/**
 * Pure — the absolute path a filesystem tool line names, or null. Same
 * openablePath law as speech; a relative path stays text.
 * @param {unknown} summary the chip's one-line summary
 * @returns {{path: string, start: number, end: number}|null} the path and where it sits in the line
 */
export const toolLinePath = (summary) => {
  if (typeof summary !== 'string') return null;
  const found = FS_LINE.exec(summary.split('\n')[0]);
  if (!found) return null;
  // A failed act reads […]: the path ends at the dash.
  const target = found[2].replace(/\s+[—–]\s.*$/, '');
  const path = openablePath(target);
  if (!path || !target.startsWith(path)) return null;
  const start = found[1].length + 1;
  return { path, start, end: start + path.length };
};

/**
 * impure — ask the desk host for a path's menu at a screen point.
 * @param {string} path
 * @param {number} x
 * @param {number} y
 */
export const openPathMenu = (path, x, y) => window.dispatchEvent(new CustomEvent('neuma:path-menu', { detail: { path, x, y } }));

/**
 * impure (reads layout) — where a keyboard-raised menu opens: under the door.
 * @param {Element} el
 * @returns {[number, number]}
 */
export const pathMenuAnchor = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.bottom]; };
