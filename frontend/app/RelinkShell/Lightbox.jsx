// Lightbox — the desk-level loupe over any preview image (Design note, 2026-09-01:
// […]). The staged
// queue thumbnails and the brand marks are decided with eyes at 120px tall
// — too small to judge the content the house is about to put out.
//
// The lens is the gallery room's own (viewer-zoom.js + use-lean.js): the
// browser hangs the work (max 100% never magnifies), the wheel leans in, a
// drag pans, double-click goes to the file's own pixels. This is the room
// without the museum — no walking, no plaques; Esc walks the operator back
// to the desk.
//
// The room is a separate export from the portal only so a static render can
// speak about the dialog itself (the house's jsdom-less boundary: portals
// need a document, renderToStaticMarkup has none).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FIT, displayPercent, transformOf } from './gallery/viewer-zoom.js';
import { useLean } from './gallery/use-lean.js';
import './Lightbox.css';

export const LightboxRoom = ({ src, alt, caption, ground, vector, onClose }) => {
  const ref = useRef(null);
  const stageRef = useRef(null);
  const artRef = useRef(null);

  const {
    view, setView, natural, setNatural, zoomed, base, zoomKey, stageProps,
  } = useLean(stageRef, artRef, src);

  // Take the dialog on open, and give the operator their place BACK on close
  // (aria-modal claims modal focus behaviour; delivering it is not optional).
  // Both call sites open from a real <button>, so the restore target is
  // always a live element.
  useEffect(() => {
    const from = document.activeElement;
    ref.current?.focus();
    return () => from?.focus?.();
  }, []);

  const onKeyDown = (e) => {
    // Escape is CONSUMED here — a modal dialog answers it itself and owes it
    // to no ancestor. React portals bubble through the React tree, so
    // without this a future host with its own Escape handler would close
    // twice over: the loupe and the window behind it.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    // aria-modal claims modal focus behaviour; delivering it is not optional.
    // The trap is recomputed per keypress because FIT is disabled at rest —
    // a mount-time snapshot would cage Tab on a button that cannot take it.
    if (e.key === 'Tab') {
      const list = Array.from(ref.current?.querySelectorAll('button:not(:disabled)') || []);
      if (list.length) {
        e.preventDefault();
        const idx = list.indexOf(document.activeElement);
        const next = e.shiftKey
          ? list[(idx <= 0 ? list.length : idx) - 1]
          : list[idx === -1 || idx === list.length - 1 ? 0 : idx + 1];
        next.focus();
      }
      return;
    }
    // The lens keys are the loupe's own too — a modal owes consumed keys to
    // no ancestor, or one + would lean the art AND whatever sits behind it.
    if (zoomKey(e)) { e.stopPropagation(); return; }
  };

  // Clicking the wall (not the work) leaves — but never while leaned in:
  // there the pointer is a hand holding the image, and a miss at its edge
  // must not throw the operator back out. Pans only ever happen zoomed, so
  // the zoomed check covers the after-drag click too.
  const onStageClick = (e) => {
    if (zoomed) return;
    if (e.target === stageRef.current) onClose();
  };

  // FIT can disable itself with its own click (the click ends the lean it
  // returns from), and a disabled button cannot keep focus — so the dialog
  // takes it back or a later Escape would land on <body>, where the portal's
  // keydown never reaches.
  const fitToHang = () => { setView(FIT); ref.current?.focus(); };

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-label={alt || caption || 'image preview'}
      aria-modal="true"
      tabIndex={-1}
      ref={ref}
      onKeyDown={onKeyDown}
    >
      <div className="lightbox-bar">
        <span className="label-data lightbox-zoom" title="of the image's own resolution">
          {displayPercent(base, natural, view.zoom)}%
        </span>
        <button
          type="button"
          className="lightbox-act"
          disabled={!zoomed}
          onClick={fitToHang}
        >FIT</button>
        <span className="lightbox-spacer" />
        <button type="button" className="lightbox-act" onClick={onClose}>CLOSE</button>
      </div>
      <div
        className={`lightbox-stage${zoomed ? ' is-zoomed' : ''}`}
        ref={stageRef}
        onClick={onStageClick}
        // A judgment surface keeps its own ground: a brand mark opened ON
        // WHITE must hang on white, or the caption says one thing and the
        // wall another. No ground given — the queue's staged art — keeps
        // the room's own void wall.
        style={ground ? { background: ground } : undefined}
        {...stageProps}
      >
        <img
          ref={artRef}
          className={`lightbox-media${vector ? ' is-vector' : ''}`}
          src={src}
          alt={alt || ''}
          style={{ transform: transformOf(view) }}
          draggable="false"
          onError={(e) => e.currentTarget.classList.add('is-missing')}
          onLoad={(e) => {
            e.currentTarget.classList.remove('is-missing');
            setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
          }}
        />
      </div>
      {caption ? <div className="lightbox-caption label-data">{caption}</div> : null}
    </div>
  );
};

// The desk-level door: body portal at the modal tier (DeleteConfirm pattern),
// so the loupe stands over whichever window opened it.
export const Lightbox = (props) => createPortal(<LightboxRoom {...props} />, document.body);
