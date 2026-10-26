/**
 * THE ONE SPELLING EVERY WRITE WALL COMPARES IN (#587).
 *
 * A wall is a place; a path is only a spelling of one. On a case-insensitive,
 * normalization-insensitive volume (macOS APFS and HFS+, ext4 and tmpfs with
 * casefold) `é` composed (U+00E9) and `e` + U+0301 decomposed name one
 * directory, and `HOUſE-MANDATE.JSON` opens house-mandate.json: the kernel
 * full-case-folds, so the long s is an s and the sharp s is "ss". A plain
 * toLowerCase does neither, and every wall that compared lower-cased strings
 * let those spellings onto the walled file itself (proven on a real casefold
 * volume, test/integration/sandbox-unicode-wall.test.js).
 *
 * So every wall folds both sides here first: decompose, full case fold (upper
 * then lower is the full fold for every letter a path can carry), recompose.
 * Folding more than a volume does only refuses an exotic name a case-sensitive
 * volume would have kept apart — the safe direction for a wall.
 */
import path from 'path';

/**
 * pure — a name or path as a case- and normalization-insensitive volume reads it.
 * @param {string} text
 * @returns {string}
 */
export const foldName = (text) => String(text).normalize('NFD').toUpperCase().toLowerCase().normalize('NFC');

/**
 * pure — a path resolved (`.`, `..`, `//`, a trailing slash collapsed) and folded.
 * @param {string} filePath
 * @returns {string}
 */
export const wallSpelling = (filePath) => foldName(path.resolve(filePath));
