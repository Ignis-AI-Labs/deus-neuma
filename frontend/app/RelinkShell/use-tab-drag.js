// use-tab-drag — the strip's whole drag gesture, in one place.
//
// Extracted from TabStrip.jsx (2026-08-30) when cross-stream transfer and the
// drop caret pushed that file to 494 of the 500-line cap. The gesture is a
// coherent concern with its own state and its own laws, so it becomes its own
// leaf rather than more weight in a component that also renders.
//
// THREE OUTCOMES, and which one happens is decided entirely by where the tab
// was released:
//
//   on THIS strip                 a reorder  → onMove
//   on ANOTHER strip              a transfer → stream-strips.transferTab
//   OUTSIDE its own window        a tear-out → the sitting gets its own window
//   anywhere else in its window   nothing    → the tab stays where it was
//
// THE DELIBERATE TEAR-OUT (Design note, 2026-10-05: […] A tab let go a few pixels below its strip used to
// launch a window; now only a release past the window's own edge does.
//
// Direction law: this imports the registry leaf, never TabStrip.

import { useRef, useState } from 'react';
import { claimDrag, takeDragClaim, transferTab } from './stream-strips.js';

/** The drag payload type. Named so a drag from ANYWHERE else — a file from the
 *  Explorer, a link, an OS drop — can never be read as a tab being reordered. */
export const TAB_MIME = 'application/x-neuma-tab';

/** WHICH strip the drag started on. Carried beside TAB_MIME so a drop can tell
 *  a reorder within one stream from a TRANSFER between two of them. */
export const STRIP_MIME = 'application/x-neuma-tab-strip';

/** Is a tab being dragged over us — from anywhere, including another stream?
 *  `types` is readable during dragover; `getData` deliberately is not, which is
 *  why the source strip cannot be identified until the drop itself. Pure. */
const carriesTab = (e) => {
  try { return Array.from(e.dataTransfer?.types || []).includes(TAB_MIME); } catch { return false; }
};

/** Which GAP the cursor is aiming at, given the tab's rectangle. Pure.
 *  The midpoint is the whole rule: left half is "before this one", right half
 *  is "after" (Design note, 2026-08-30. */
export const gapForPointer = (clientX, rect, i) =>
  (clientX < rect.left + rect.width / 2 ? i : i + 1);

/**
 * A GAP is not an INDEX. `moveTab` splices the tab out before inserting, so
 * every gap to the right of where it started shifts down by one — without this
 * a tab dragged rightwards lands one place short of the caret, every time.
 *
 * A tab arriving from another strip is NOT in this list, so nothing is spliced
 * ahead of it and the gap IS the index. Pure.
 */
export const indexForGap = (tabs, dragId, gap) => {
  const at = (tabs || []).findIndex((t) => t.id === dragId);
  return at !== -1 && at < gap ? gap - 1 : gap;
};

/**
 * Was a tab let go outside the window it lives in? `region` is that window's
 * rect at the drag's start (a DOMRect-like {left, top, right, bottom}); a
 * release that left the app altogether counts as outside. Pure.
 */
export const releasedOutside = ({ point, region, leftApp }) =>
  leftApp || !point || !region
  || point.x < region.left || point.x > region.right
  || point.y < region.top || point.y > region.bottom;

/** Is a drag event's pointer at the page's very edge or past it — the way out
 *  of the app? Within 2 px counts, since the last event inside reads the edge. */
const atPageEdge = (e) => e.clientX <= 1 || e.clientY <= 1
  || e.clientX >= window.innerWidth - 2 || e.clientY >= window.innerHeight - 2;

/**
 * @param {object} p
 * @param {Array} p.tabs - this strip's sittings, in order
 * @param {string|null} p.windowId - which stream window this strip is
 * @param {Function} p.onMove - reorder within this strip
 * @param {Function} p.onTearOut - pull a sitting into its own window
 * @param {Function} p.onRefusal - show the operator why something was refused
 */
export const useTabDrag = ({ tabs, windowId, onMove, onTearOut, onRefusal }) => {
  const [dragId, setDragId] = useState(null);
  // WHERE THE SITTING WOULD LAND — a GAP index, 0..tabs.length, not a tab id.
  // Lighting the whole TAB could never answer the operator's question: a tab is
  // a thing, and what they need to see is a PLACE BETWEEN things.
  const [dropGap, setDropGap] = useState(null);
  // Did the drag end ON the strip? A drag released anywhere else is the
  // operator pulling the sitting OUT. A ref, not state: it is read inside
  // dragend, after the last render.
  const landedOnStrip = useRef(false);
  // WHERE IT WAS LET GO, relative to its own window. The window's rect is read
  // once at the start (a tab drag never moves its window); the pointer is
  // followed by the document's own dragover, because dragend's coordinates
  // read 0,0 on some Linux hosts; and leaving the app's window altogether is
  // its own fact, since nothing inside the page sees the pointer out there.
  const release = useRef({ region: null, point: null, leftApp: false, stop: null });

  const followPointer = () => {
    const r = release.current;
    const over = (e) => { r.point = { x: e.clientX, y: e.clientY }; r.leftApp = false; };
    // NOT relatedTarget: a release on nothing that accepts it fires a dragleave
    // with no destination too, from the middle of the page. Leaving the app is
    // where the pointer IS — at the page's very edge, or past it.
    const leave = (e) => { if (atPageEdge(e)) r.leftApp = true; };
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    r.stop = () => {
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      r.stop = null;
    };
  };

  const startDrag = (e, t) => {
    setDragId(t.id);
    landedOnStrip.current = false;
    release.current.stop?.();
    const win = e.currentTarget?.closest?.('.fwin');
    const rect = win?.getBoundingClientRect();
    release.current = {
      region: rect
        ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
        : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight },
      point: { x: e.clientX, y: e.clientY },
      leftApp: false,
      stop: null,
    };
    followPointer();
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(TAB_MIME, t.id);
      // Without the source strip, a drop cannot tell a reorder from a transfer,
      // and every cross-window drop would read as a local move of a tab this
      // strip does not have.
      if (windowId) e.dataTransfer.setData(STRIP_MIME, windowId);
      // A plain-text fallback so dropping on a text surface reads as the
      // sitting's name rather than nothing.
      e.dataTransfer.setData('text/plain', t.name);
    } catch { /* some hosts hand back a locked dataTransfer */ }
  };

  // Set only on CHANGE. dragover fires continuously, and writing the same value
  // dozens of times a second re-renders the strip into a judder.
  const aim = (gap) => setDropGap((cur) => (cur === gap ? cur : gap));

  const dragOverTab = (e, i) => {
    // A drag from ANOTHER strip has no local dragId. The original guard returned
    // here, so preventDefault never ran, so the drop never fired — dragging a
    // tab into a second stream window did nothing at all.
    if (!carriesTab(e)) return;
    e.preventDefault();          // required, or the drop never fires
    e.stopPropagation();         // the strip's own handler must not overrule the side
    e.dataTransfer.dropEffect = 'move';
    aim(gapForPointer(e.clientX, e.currentTarget.getBoundingClientRect(), i));
  };

  /** Anywhere on the strip that is not a tab — the + TAB control, the gap past
   *  the last tab, the strip's own padding. Handlers first sat on the rail
   *  alone, which is only as wide as the tabs, so most of the bar refused the
   *  drop silently (Founder: […]). */
  const dragOverStrip = (e) => {
    if (!carriesTab(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    aim(tabs?.length ?? 0);
  };

  /** The caret must not outlive the cursor — but a tab holds a face, a tear
   *  mark and a close mark, and dragleave bubbles from each as the cursor
   *  crosses between them. Only a real departure counts. */
  const dragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropGap(null);
  };

  const landDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const gap = dropGap ?? (tabs?.length ?? 0);
    setDropGap(null);
    let from = '';
    let id = '';
    try {
      id = e.dataTransfer.getData(TAB_MIME) || '';
      from = e.dataTransfer.getData(STRIP_MIME) || '';
    } catch { /* locked dataTransfer */ }

    if (id && from && windowId && from !== windowId) {
      // Claim BEFORE the move: the source strip's dragend fires after this and
      // would otherwise read […] and tear out a third
      // window — the opposite of what the operator just did.
      claimDrag(id);
      // The caret promised a PLACE, so the sitting lands in it. Adopting alone
      // appends, and an indicator that points where the tab does not go is
      // worse than no indicator.
      const moved = transferTab(from, windowId, id, gap);
      if (!moved.ok) onRefusal?.({ allowed: false, reason: moved.error });
      setDragId(null);
      return;
    }

    landedOnStrip.current = true;
    if (dragId) onMove?.(dragId, indexForGap(tabs, dragId, gap));
    setDragId(null);
  };

  const endDrag = () => {
    // Released OUTSIDE its own window → the sitting becomes its own window.
    // Checked here rather than on a drop target because the place it was
    // released is precisely NOT one of ours. Released anywhere else inside its
    // window, off the strip → nothing: the tab stays where it was.
    //
    // Unless ANOTHER strip took it: a transfer also lands off this strip, and
    // opening a window for a tab that just moved would undo the gesture and
    // spend a portal doing it.
    const r = release.current;
    r.stop?.();
    const taken = dragId ? takeDragClaim(dragId) : false;
    if (dragId && !landedOnStrip.current && !taken && releasedOutside(r)) onTearOut?.(dragId);
    setDragId(null);
    setDropGap(null);
  };

  return { dragId, dropGap, startDrag, dragOverTab, dragOverStrip, dragLeave, landDrop, endDrag };
};
