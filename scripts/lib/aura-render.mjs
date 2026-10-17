/**
 * Sheet assembly for the headless aura tools.
 *
 * The DRAWING itself moved to `core/aura/render.js` (#405): the desk draws
 * these forms too, and a second copy of the accumulate-then-tone-map step
 * would mean the contact sheet stopped being evidence about what a witness
 * sees. `renderTile` is re-exported here so the scripts keep their one import.
 *
 * What stays is the only thing that is genuinely sheet-shaped: laying tiles
 * out beside each other.
 */

export { renderTile } from '../../core/aura/render.js';

/**
 * Blit a square tile into a larger sheet. Impure: it writes into `sheet`.
 * @param {Uint8Array} sheet
 * @param {number} sheetWidth
 * @param {Uint8Array} tile
 * @param {number} tileSize
 * @param {number} atX
 * @param {number} atY
 */
export const blit = (sheet, sheetWidth, tile, tileSize, atX, atY) => {
  for (let y = 0; y < tileSize; y++) {
    for (let x = 0; x < tileSize; x++) {
      sheet[(atY + y) * sheetWidth + (atX + x)] = tile[y * tileSize + x];
    }
  }
};
