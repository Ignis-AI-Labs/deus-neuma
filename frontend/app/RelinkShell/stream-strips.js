// stream-strips.js — the desk's view of every stream window's tab strip.
//
// WHY THIS EXISTS. Two features landed a day apart and their seams did not
// meet:
//
//   · Stream windows made the TAB STRIP per-window. Every stream window past
//     the first runs its own sitting, so it owns its own strip
//     (StreamWindowHost's OwnTabs).
//   · Per-tab focus made the GROUND per-tab — a tab carries the folder its
//     Explorer, its portal frames and its reach all answer to.
//
// But FocusContext was provided exactly ONCE, at the desk, bound to the desk's
// OWN strip. So the Explorer always wrote the operator's folder choice onto the
// desk window's focused tab, whichever stream they were actually looking at.
//
// Design note, 2026-08-30: […]
//
// A React context cannot answer this. The Explorer is its own desk window, a
// SIBLING of the stream windows rather than a child of one, so no provider
// nesting reaches it. What it needs is a way to ask […], and that question is about the desk, not about a subtree.
//
// So: every strip registers itself here, and the decision of which one owns a
// write is a PURE function of the window list (groundTargetId, below).
//
// This also makes tab TRANSFER possible — moving a sitting from one stream
// window to another is only expressible once a strip can be reached from
// outside its own window.

/** The app id every stream window shares. `chat`, `chat#2`, `chat#3`… */
export const STREAM_APP = 'chat';

// impure — module-level, because the thing being tracked IS module-level: the
// set of strips currently mounted anywhere on this desk. Every DECISION made
// from it is pure and lives below.
//
// WHY A LAST-FOCUSED STAMP RATHER THAN THE WINDOW LIST. The obvious answer is
// to ask the window manager for z-order. It cannot be asked from where the
// question is answered: FocusContext is provided by RelinkShell, which renders
// WindowManager and therefore sits ABOVE its provider — `useWindows()` is not
// callable there. Each stream window IS inside it, so each reports its own
// focus instead, and "most recently focused" is the same answer z-order would
// have given for the only question being asked.
const strips = new Map();
// Monotonic, so the ordering never depends on a clock.
let focusTick = 0;
// Which window holds focus right now — half of the no-op guard in
// markStripFocused, and the half that survives a remount.
let focusedWindow = null;
// Identifies one REGISTRATION, so a cleanup can tell "still mine" from […] without relying on object identity (which stamping
// breaks — see registerStrip).
let registrationTick = 0;
const listeners = new Set();
// A counter rather than the Map itself: useSyncExternalStore compares snapshots
// by identity, and a Map mutated in place never looks changed.
let version = 0;

const notify = () => {
  version += 1;
  for (const fn of listeners) fn();
};

/**
 * Publish this window's strip, or refresh what was already published.
 *
 * Called from an effect on every change to the strip's focused tab or ground,
 * so the desk's lens never reads a stale folder. Returns its own removal.
 *
 * impure — mutates the registry and notifies.
 * @param {string} windowId - the stream window's id (`chat`, `chat#2`, …)
 * @param {{focusedId: string|null, ground: object|null, setGround: Function,
 *   tabs: Array, open: Function, close: Function}} api
 */
export const registerStrip = (windowId, api) => {
  if (!windowId) return () => {};
  // Re-registration must not reset the stamp — a strip republishes on every
  // ground change, and losing its place in the order each time would hand the
  // write to whichever window happened to re-register last.
  const prev = strips.get(windowId);
  // React cleans up the old registration before publishing changed tab data.
  const focusedAt = prev?.focusedAt ?? (focusedWindow === windowId ? focusTick : 0);
  // A STABLE TOKEN, not object identity. markStripFocused rewrites the entry to
  // stamp it, so an identity check against the original `api` stops matching
  // the moment the window is focused — and the cleanup below then silently
  // does nothing. A focused-then-closed stream would stay registered forever
  // and keep swallowing the operator's folder choices into a dead window.
  registrationTick += 1;
  const token = registrationTick;
  const next = { ...api, focusedAt, token };
  strips.set(windowId, next);
  // ONLY WAKE THE DESK WHEN SOMETHING IT READS ACTUALLY MOVED.
  //
  // Re-registering with identical values is ordinary — any parent re-render
  // does it — and notifying then re-renders the desk, which re-renders this
  // window, which re-registers, forever (React error #185, hit live
  // 2026-08-30). The subscriber must not be woken by a no-op, no matter how
  // careful the caller's dependency list is; that carefulness is exactly the
  // thing a future edit will get wrong.
  const moved = !prev
    || prev.focusedId !== next.focusedId
    || prev.ground !== next.ground
    || prev.tabs !== next.tabs;
  if (moved) notify();
  return () => {
    // Only drop it if it is still OURS. A remount can register the replacement
    // before the old effect's cleanup runs, and a blind delete would then
    // unregister the live strip.
    if (strips.get(windowId)?.token === token) {
      strips.delete(windowId);
      notify();
    }
  };
};

/** Subscribe to registry changes (useSyncExternalStore's first argument). */
export const subscribeStrips = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The snapshot useSyncExternalStore compares. Changes only when the registry does. */
export const stripsVersion = () => version;

/** One registered strip, or null. impure — reads live state. */
export const stripFor = (windowId) => strips.get(windowId) ?? null;

/** This stream window just took focus. impure — stamps and notifies.
 *  Called by the window's own subtree, which CAN see the window manager. */
export const markStripFocused = (windowId) => {
  const strip = strips.get(windowId);
  if (!strip) return;
  // Already the most recently focused — restamping would notify for nothing,
  // and a notify-for-nothing is how the render loop starts.
  //
  // BOTH halves are load-bearing. The window id alone would go deaf after a
  // remount (the id is unchanged but the fresh strip carries no stamp), and
  // the stamp alone is ambiguous at zero, where an unstamped strip and the
  // initial counter read the same and the very FIRST focus gets skipped.
  if (focusedWindow === windowId && strip.focusedAt === focusTick) return;
  focusedWindow = windowId;
  focusTick += 1;
  strips.set(windowId, { ...strip, focusedAt: focusTick });
  notify();
};

/**
 * WHICH STREAM OWNS THE OPERATOR'S FOLDER CHOICE. Pure.
 *
 * The stream window the operator was LAST IN — not the frontmost window
 * outright, because clicking the Explorer to pick a folder makes the EXPLORER
 * frontmost, and the folder plainly does not belong to the Explorer.
 *
 * Ties break toward the desk's own strip (`chat`), which is the single-window
 * case and must keep behaving exactly as it always has: with nothing focused
 * yet every stamp is 0, and the answer has to be the desk.
 *
 * @param {Array<{id: string, focusedAt: number}>} entries - from stripEntries()
 * @returns {string|null} the window id, or null when no strip is mounted
 */
export const groundTargetId = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  let best = null;
  for (const e of entries) {
    if (!best
      || e.focusedAt > best.focusedAt
      || (e.focusedAt === best.focusedAt && e.id === STREAM_APP)) best = e;
  }
  return best ? best.id : null;
};

/** The registry as plain comparable records — the input groundTargetId reads.
 *  impure — reads live state; the DECISION over it stays pure. */
export const stripEntries = () => (
  [...strips.entries()].map(([id, s]) => ({ id, focusedAt: s.focusedAt ?? 0 }))
);

// ── TRANSFER ────────────────────────────────────────────────────────────────
//
// A cross-strip drag has a problem the same-strip drag does not: the SOURCE
// strip's `dragend` fires after the drop, sees that the tab was not released on
// its own strip, and would tear the sitting out into a third window — the exact
// opposite of what the operator just did.
//
// The receiving strip claims the drag on drop; the source checks the claim
// before tearing out. A plain module value is the right shape because a drag is
// a single global gesture: there is exactly one in flight at a time.

let claimedDragId = null;

/** The receiving strip took this drag — the source must NOT tear out. impure. */
export const claimDrag = (tabId) => { claimedDragId = tabId || null; };

/** Was this drag claimed by another strip? Reading it CONSUMES the claim, so a
 *  later unrelated drag of the same tab is judged on its own. impure. */
export const takeDragClaim = (tabId) => {
  const claimed = claimedDragId !== null && claimedDragId === tabId;
  if (claimed) claimedDragId = null;
  return claimed;
};

/**
 * Move a sitting from one stream window's strip to another's. Pure decision,
 * impure application — it calls into two live strips.
 *
 * The tab is CLOSED on the source as it OPENS on the target, never both at
 * once: the same conversation drawn in two frames is two composers writing into
 * one session, which the tear-out law already refuses.
 *
 * @param {number} [atIndex] the GAP the caret was pointing at. Adopting alone
 *   appends, and an indicator that promises a place the tab does not land in is
 *   worse than no indicator at all.
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export const transferTab = (fromWindowId, toWindowId, tabId, atIndex = null) => {
  if (fromWindowId === toWindowId) return { ok: false, error: 'that sitting is already in this stream' };
  const from = stripFor(fromWindowId);
  const to = stripFor(toWindowId);
  if (!from || !to) return { ok: false, error: 'that stream window is no longer open' };
  const tab = (from.tabs || []).find((t) => t.id === tabId);
  if (!tab) return { ok: false, error: 'that sitting is no longer on the strip it came from' };
  // THE ONLY THING A TRANSFER MAY NOT DO: empty a window.
  //
  // A strip with no tabs does not render (`if (!tabs?.length) return null`), and
  // the + TAB door lives ON the strip — so a window drained to zero has no way
  // to open another sitting. That is a trap, and it is the one refusal worth
  // making.
  //
  // ⚠️ THE HOUSE TAB USED TO BE REFUSED HERE, AND THAT WAS WRONG.
  // The house tab is simply the OLDEST (`houseTab` reads createdAt), which
  // makes it the first tab on the strip and the only tab in a fresh window —
  // exactly the one an operator reaches for. Founder hit that refusal repeatedly
  // and read it as the whole feature being broken. It was also unnecessary:
  // the role is DERIVED, so the source strip simply re-designates its next
  // oldest the moment this one leaves. Nothing is orphaned.
  //
  // THE DRAIN LAW, AMENDED (Design note, 2026-09-15: dragging the torn-out tab back
  // into the stream it came from […]). A popped-out window that drains to one sitting is not a trap —
  // it is the tear-out waiting to be undone: the move PROCEEDS and the
  // emptied window CLOSES (closeWindow, below). The refusal keeps standing
  // only for a strip with no close door — the desk's own, whose window is
  // never a side effect of a tab drag.
  const drained = (from.tabs || []).length <= 1;
  if (drained && typeof from.closeWindow !== 'function') {
    return { ok: false, error: 'that is the only sitting in this stream — a window with no tabs has no way to open one' };
  }

  // ADOPT, never `open`. `open` mints a fresh id and carries no session, which
  // is right for a NEW sitting and wrong for a moving one — the tab would land
  // as a different conversation wearing the same being's name, and the thread
  // the operator was reading would be gone. `adopt` hands the whole tab through
  // (id, sessionId, createdAt, and its working ground).
  const landed = to.adopt?.(tab);
  if (!landed) return { ok: false, error: 'that stream window cannot take a sitting' };
  if (landed.refusal) return { ok: false, error: landed.refusal.reason || 'the receiving stream refused it' };
  from.close?.(tabId);
  // The tab landed at the end; put it where the caret said. Clamped by the
  // model, so a gap past the strip's new length simply means "last".
  if (Number.isInteger(atIndex)) to.move?.(tabId, atIndex);
  // The move DRAINED the source — a popped-out window's whole existence was
  // that one sitting, so it closes: docking the tab back is the tear-out
  // undone, exactly the gesture the operator just made.
  if (drained) from.closeWindow?.();
  return { ok: true };
};
