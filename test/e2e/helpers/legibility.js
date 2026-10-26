// legibility.js — THE FLOOR, measured (Design note, 2026-10-26: […]). Every element under `root` that holds visible text of its own, with its computed font size, read
// in the real browser. Returns what reads under `floor` px as […]; [] = all legible.
// Hidden, zero-size and fully transparent elements are not read (a closed fold, a hover-only control at rest).

export const LEGIBLE_FLOOR_PX = 13;

/**
 * @param {import('@playwright/test').Locator} root
 * @param {number} [floor]
 * @returns {Promise<string[]>}
 */
export const underFloor = (root, floor = LEGIBLE_FLOOR_PX) => root.evaluate((el, min) => [...el.querySelectorAll('*')].flatMap((n) => {
  if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return [];
  const box = n.getBoundingClientRect();
  const cs = getComputedStyle(n);
  if (!box.width || !box.height || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return [];
  const px = parseFloat(cs.fontSize);
  return px < min ? [`${px}px <${n.tagName.toLowerCase()} class="${n.className}"> ${n.textContent.trim().slice(0, 40)}`] : [];
}), floor);
