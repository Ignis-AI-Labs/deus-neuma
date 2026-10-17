// window-manager-reducer.js — pure state for the desk's open windows.
//
// Tracks which apps are open, focus, and a monotonic z used only for
// stacking ORDER (WindowLayer maps it to a small bounded zIndex by rank,
// so it can grow freely here). Single-instance apps keep id === appId;
// multiInstance apps spawn siblings as `appId#N` (N >= 2) — the first
// instance is always the bare appId, so pre-instancing ids and their
// persisted geometry keys survive byte-identical.
// A spawn may carry a PAYLOAD (a small string — the editor's file path):
// born with the window, persisted with the open-set, boundary-validated.
// Minimizing is an in-place window-shade owned by the window itself, not a
// manager concern; the manager only knows open / closed / focused.
// Deterministic, no IO: unit-testable.

export const initialState = Object.freeze({
  windows: [], // [{ id, z }]
  focusedId: null,
  nextZ: 1,
});

// Instance id law: `#` never appears in app ids (and geometry keys segment
// on `:`), so the suffix is unambiguous. Ordinals are system-generated —
// anything else found at a boundary is malformed and must be dropped there.

/** A well-formed instance suffix: positive integer, no leading zero. */
const SUFFIX = /^[1-9][0-9]*$/;

/** Hydratable ordinals cap at 10 — the multiInstance budget (set by the
 * backend terminal cap, applied generically to every instanced app). */
const HYDRATABLE_SUFFIX = /^(?:[2-9]|10)$/;

/**
 * Pure — boundary validation for a window's spawn payload (the desk open-set
 * persists through localStorage, a hostile boundary). A payload is a small
 * string (for the editor: the absolute path it was opened on); anything else
 * degrades to undefined, never a malformed object reaching a Body.
 * @param {unknown} raw
 * @returns {string|undefined}
 */
const normalizePayload = (raw) =>
  (typeof raw === 'string' && raw.length > 0 && raw.length <= 4096 ? raw : undefined);

/** Pure — the app id a window id belongs to: `terminal#2` -> `terminal`. */
export const appIdOf = (windowId) => {
  const hash = windowId.indexOf('#');
  return hash === -1 ? windowId : windowId.slice(0, hash);
};

/** Pure — 1 for a bare id (or a malformed suffix), N for `appId#N` (N >= 2). */
export const instanceOrdinal = (windowId) => {
  const hash = windowId.indexOf('#');
  if (hash === -1) return 1;
  const suffix = windowId.slice(hash + 1);
  if (!SUFFIX.test(suffix)) return 1;
  const n = Number(suffix);
  return n >= 2 ? n : 1;
};

/**
 * Pure — the id the next spawn of an app takes: the bare appId if instance 1
 * is free, else `appId#N` for the lowest free ordinal N >= 2. Reusing freed
 * ordinals IS the geometry-reclaim mechanism (design D5): the new window
 * inherits the closed sibling's persisted frame.
 */
export const nextInstanceId = (windows, appId) => {
  const taken = new Set(
    windows.filter((w) => appIdOf(w.id) === appId).map((w) => instanceOrdinal(w.id)),
  );
  if (!taken.has(1)) return appId;
  let n = 2;
  while (taken.has(n)) n += 1;
  return `${appId}#${n}`;
};

/**
 * Pure — the frontmost (highest z) open instance of an app, or null when none
 * is open. The dock's plain click focuses this instead of opening over it.
 */
export const frontmostInstanceId = (windows, appId) => {
  let top = null;
  for (const w of windows) {
    if (appIdOf(w.id) === appId && (!top || w.z > top.z)) top = w;
  }
  return top ? top.id : null;
};

/** Pure — drop duplicate ids from a persisted open-set (first occurrence wins). */
export const dedupeById = (list) => {
  const seen = new Set();
  return list.filter((w) => (seen.has(w.id) ? false : seen.add(w.id)));
};

/**
 * Pure — boundary validation for persisted window ids: the base app id must
 * be the registry's OWN key (hostile ids like `__proto__` must not resolve
 * through the prototype chain), and a `#` suffix is only legal as an ordinal
 * 2..10 on an app that declares `multiInstance: true`.
 */
export const isValidWindowId = (registry, id) => {
  if (typeof id !== 'string' || id.length === 0) return false;
  const hash = id.indexOf('#');
  const base = hash === -1 ? id : id.slice(0, hash);
  if (!Object.hasOwn(registry, base) || !registry[base]) return false;
  if (hash === -1) return true;
  return registry[base].multiInstance === true && HYDRATABLE_SUFFIX.test(id.slice(hash + 1));
};

const find = (windows, id) => windows.find((w) => w.id === id) || null;

/** The window with the highest z (frontmost), or null. */
const topId = (windows) => {
  let top = null;
  for (const w of windows) {
    if (!top || w.z > top.z) top = w;
  }
  return top ? top.id : null;
};

/** Raise a window to the top of the stack and focus it. */
const raise = (state, id) => ({
  ...state,
  windows: state.windows.map((w) => (w.id === id ? { ...w, z: state.nextZ } : w)),
  focusedId: id,
  nextZ: state.nextZ + 1,
});

/** Ensure a window is open, focused, and on top. A spawn payload (given only
 * at birth — the file an editor opens on) is stored with the window. */
const open = (state, id, payload) => {
  if (!find(state.windows, id)) {
    const born = payload === undefined ? { id, z: state.nextZ } : { id, z: state.nextZ, payload };
    return {
      ...state,
      windows: [...state.windows, born],
      focusedId: id,
      nextZ: state.nextZ + 1,
    };
  }
  return raise(state, id);
};

/** Build initial state from a persisted/seed list of { id, payload? }. */
export const hydrate = (list) => {
  const windows = (list || []).map((w, i) => {
    const payload = normalizePayload(w.payload);
    return payload === undefined ? { id: w.id, z: i + 1 } : { id: w.id, z: i + 1, payload };
  });
  return { windows, focusedId: topId(windows), nextZ: windows.length + 1 };
};

export const reducer = (state, action) => {
  const { id } = action;
  switch (action.type) {
    // The dock is a launcher: opening an already-open window just focuses it.
    case 'OPEN':
    case 'TOGGLE':
      return open(state, id);

    // Spawn semantics for multiInstance apps: ALWAYS a new window, at the
    // lowest free instance id, focused and on top. An optional payload (the
    // file an editor opens on) is born with the window and rides the
    // persisted open-set.
    case 'OPEN_NEW':
      return open(state, nextInstanceId(state.windows, action.appId), normalizePayload(action.payload));

    // Retarget every window of an app whose payload IS `from` onto `to` —
    // the tree renamed the file an editor has open; the window follows its
    // file. A hostile `from`/`to` is a no-op, never a malformed payload.
    case 'REPAYLOAD': {
      const from = normalizePayload(action.from);
      const to = normalizePayload(action.to);
      if (from === undefined || to === undefined) return state;
      let touched = false;
      const windows = state.windows.map((w) => {
        if (appIdOf(w.id) === action.appId && w.payload === from) {
          touched = true;
          return { ...w, payload: to };
        }
        return w;
      });
      return touched ? { ...state, windows } : state;
    }

    case 'CLOSE': {
      if (!find(state.windows, id)) return state;
      const windows = state.windows.filter((w) => w.id !== id);
      return { ...state, windows, focusedId: state.focusedId === id ? topId(windows) : state.focusedId };
    }

    case 'FOCUS': {
      const w = find(state.windows, id);
      if (!w || state.focusedId === id) return state;
      return raise(state, id);
    }

    default:
      return state;
  }
};
