/**
 * Where a new window opens: on the operator's PRIMARY screen (Design note, 2026-10-14:
 * […]). Without an explicit
 * position the window manager drops a window on whatever screen it calls
 * active — on a six-screen desk that is rarely the primary one.
 *
 * Pure geometry below; `primaryBounds` / `parentBounds` read the live layout.
 * A child window (the wallet's confirm) opens over its parent instead, so it
 * stays with a desk the operator has moved on purpose.
 *
 * Under native Wayland a client may not position itself and these are
 * ignored; they hold under X11 and XWayland, where every launch path keeps
 * the desk (display-flags.cjs).
 */

/**
 * Centre a size inside an area, shrunk to fit it. Pure.
 * @param {{x: number, y: number, width: number, height: number}} area
 * @param {{width: number, height: number}} size
 * @returns {{x: number, y: number, width: number, height: number}}
 */
const centerIn = (area, { width, height }) => {
  const w = Math.min(width, area.width);
  const h = Math.min(height, area.height);
  return {
    x: area.x + Math.round((area.width - w) / 2),
    y: area.y + Math.round((area.height - h) / 2),
    width: w,
    height: h,
  };
};

/**
 * Centre a size over another window's bounds, never shrunk. Pure.
 * @param {{x: number, y: number, width: number, height: number}} over
 * @param {{width: number, height: number}} size
 * @returns {{x: number, y: number}}
 */
const centerOver = (over, { width, height }) => ({
  x: over.x + Math.round((over.width - width) / 2),
  y: over.y + Math.round((over.height - height) / 2),
});

// impure — reads the display layout; the primary is the one the operator set
const primaryBounds = (size) => {
  const { screen } = require('electron');
  return centerIn(screen.getPrimaryDisplay().workArea, size);
};

// impure — reads the parent's live bounds
const parentBounds = (parent, size) => ({ ...size, ...centerOver(parent.getBounds(), size) });

module.exports = { centerIn, centerOver, primaryBounds, parentBounds };
