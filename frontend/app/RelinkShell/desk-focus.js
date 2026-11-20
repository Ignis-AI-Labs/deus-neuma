// desk-focus.js — the pure core of a desk window's working focus.
//
// A window's FOCUS is the lens its status strip and portal frames look
// through: a folder, or nothing (Projects were removed 2026-11-10 — the folder
// in focus is the workspace; a saved project focus loads as nothing). Kept
// free of React and browser globals so it is node-testable on its own (D1). Persisted focus is
// UNTRUSTED on the way back in — normalizeFocus is the boundary validator.
// NO-IMPORT LAW (D8): this module never imports backend, MCP, or grant
// plumbing — focus is a display/memory-scoping lens, never a grant source.

import { baseName, isAbsolutePath } from '../../utils/path.js';

// A focus string may end up in a portal frame or a persisted key — control
// characters have no place in a POSIX folder path, and
// rejecting them here closes label/frame injection at the boundary.
const hasControlChars = (s) => {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};

/**
 * Boundary validator for anything claiming to be a focus (parsed JSON from
 * localStorage, a future wire field). Explicit field-picking — the input is
 * NEVER spread into the result, so hostile extras (__proto__ included) are
 * dropped on the floor. Own-property discipline: inherited fields don't count.
 * @param {unknown} raw
 * @returns {{kind:'folder',path:string}|null}
 */
export const normalizeFocus = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  if (!Object.hasOwn(raw, 'kind')) return null;
  if (raw.kind === 'folder') {
    if (!Object.hasOwn(raw, 'path') || typeof raw.path !== 'string') return null;
    // Absolute paths only — a relative path is meaningless as a window lens
    // and a hostile one is a traversal attempt. (The backend re-validates
    // every focus path via containWithinRoots regardless, D3.)
    if (!isAbsolutePath(raw.path) || hasControlChars(raw.path)) return null;
    return Object.freeze({ kind: 'folder', path: raw.path });
  }
  return null;
};

/**
 * The slot a desk identifies as, normalized to the integer ≥ 1 law shared
 * with slotSegment — one definition so window-storage and the focus hook can
 * never drift on fallback semantics.
 * @param {unknown} slot
 * @returns {number}
 */
export const normalizeSlot = (slot) => (Number.isInteger(slot) && slot >= 1 ? slot : 1);

/**
 * Value equality over normalized focus values (null included).
 * @param {ReturnType<typeof normalizeFocus>} a
 * @param {ReturnType<typeof normalizeFocus>} b
 * @returns {boolean}
 */
export const focusEquals = (a, b) => {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.path === b.path;
};

/**
 * The folder a focus points the desk's tools at (terminal cwd, map scan):
 * the folder in focus, or nothing. Whatever this returns is only a HINT: the
 * backend re-validates it through resolveFocusPath before any use (D3).
 * @param {ReturnType<typeof normalizeFocus>} focus
 * @returns {string|null}
 */
export const focusFolderPath = (focus) => (focus?.kind === 'folder' ? focus.path : null);

/**
 * What the status strip shows for a focus (D7): the folder's basename, or
 * null with nothing in focus (the strip renders nothing).
 * @param {ReturnType<typeof normalizeFocus>} focus
 * @returns {{kind:'folder', folder:{name:string}}|null}
 */
export const focusLabel = (focus) => (
  focus?.kind === 'folder' ? { kind: 'folder', folder: { name: baseName(focus.path) } } : null
);

/**
 * A sitting owns its folder; an unassigned tab never borrows the window lens.
 * Pure. Missing assignments stay visible until the operator chooses a folder.
 * @param {ReturnType<typeof normalizeFocus>} tabFocus - the sitting's own ground
 * @returns {ReturnType<typeof normalizeFocus>}
 */
export const sittingGround = (tabFocus) => tabFocus ?? null;

/**
 * A ground in ONE WORD, for a tab on the strip. Pure.
 *
 * Design note, 2026-08-29, on showing which sitting works where: […]
 *
 * So this is deliberately the smallest true thing: a basename. Never a path — a strip of full paths is the exact noise he is asking
 * not to have, and the path is one hover away in `full`.
 *
 * It returns null for a tab with NO ground of its own, and that is what keeps
 * the strip clean: a mark appears only where there is something to say. Most
 * tabs ride the window's lens and wear nothing at all, so a desk nobody has
 * focused per-tab looks exactly as it always did.
 *
 * @param {ReturnType<typeof normalizeFocus>} focus
 * @returns {{short: string, full: string}|null}
 */
export const groundMark = (focus) => {
  const label = focusLabel(focus);
  if (!label?.folder?.name) return null;
  // The FULL path, not the basename again — the hover is where the whole truth
  // belongs, and two folders called `src` are told apart only by it.
  return Object.freeze({ short: label.folder.name, full: focus.path });
};

/**
 * The untrusted execution-location hint carried on portal frames. The backend
 * re-validates it against opened roots; it selects the coding shell's ground —
 * shell writes still land lane-side, never in the live folder. A folder lens
 * never scopes a being's memory or contributes any grant surface (D8): the
 * chat stays general.
 * @param {ReturnType<typeof normalizeFocus>} focus
 * @returns {{toolWorkspace:string}|{}}
 */
export const focusToolFrame = (focus) => {
  const toolWorkspace = focusFolderPath(focus);
  return toolWorkspace ? { toolWorkspace } : {};
};

/**
 * D11 — what focus a window opens with. The main desk (slot 1, and anything
 * that isn't an integer slot ≥ 2 — same discipline as slotSegment) always
 * restores its persisted focus, fresh launch included. Desks ≥ 2 restore
 * only on reload (spawn-marker present); a fresh spawn opens unfocused.
 * @param {unknown} slot
 * @param {boolean} hasSpawnMarker
 * @param {ReturnType<typeof normalizeFocus>} storedFocus
 * @returns {ReturnType<typeof normalizeFocus>}
 */
export const resolveSpawnFocus = (slot, hasSpawnMarker, storedFocus) => {
  if (Number.isInteger(slot) && slot >= 2) return hasSpawnMarker ? storedFocus : null;
  return storedFocus;
};

/**
 * D6 — the Files roots a focus scopes the Explorer tree to. Folder focus →
 * exactly that folder; no focus falls back to allRoots (null = unscoped:
 * every open root). Scoping only: the tree intersects this with the
 * really-open roots, and every file operation stays backend-validated
 * regardless (D3).
 * @param {ReturnType<typeof normalizeFocus>} focus
 * @param {string[]|null} allRoots
 * @returns {string[]|null}
 */
export const focusRootsOf = (focus, allRoots = null) => (focus?.kind === 'folder' ? [focus.path] : allRoots);

/**
 * D9 (second half) — closing a Files root releases a window focus that
 * pointed at it. True exactly when the focus IS that folder root; the strip
 * then empties loudly (setFocus(null)) — never a silent refocus elsewhere.
 * @param {ReturnType<typeof normalizeFocus>} focus
 * @param {string} closedRoot
 * @returns {boolean}
 */
export const releaseFocusOnRootClose = (focus, closedRoot) =>
  focus?.kind === 'folder' && focus.path === closedRoot;
