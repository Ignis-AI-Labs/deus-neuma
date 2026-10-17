// Viewer — THE ROOM, extracted verbatim from GalleryApp.jsx (size-law
// breakdown, 2026-08-26): Viewer + isTyping, and the shared missing-mark
// handlers the grid's tiles import back from here. The measuring and the
// lean moved out to their own modules (use-box-size.js, use-lean.js) when
// the Lightbox took up the same lens — two copies would drift.

import { useEffect, useRef, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { fileSrc } from '../../../services/gallery-client.js';
import { itemKey, plaqueOf } from './gallery-view.js';
import { useLean } from './use-lean.js';
import { FIT, displayPercent, transformOf } from './viewer-zoom.js';
import { forgeRefOf } from './verdict-view.js';
import { ImageVerdict } from './ImageVerdict.jsx';

// A broken tile has to still LOOK like a tile — the grid must not reflow around
// a failure, and a silent blank square is indistinguishable from a black image.
// Cleared on a later load because React reuses the same <img> node across a src
// change, so the mark would otherwise outlive the failure that set it.
export const markMissing = (e) => e.currentTarget.classList.add('is-missing');
export const clearMissing = (e) => e.currentTarget.classList.remove('is-missing');

const isTyping = (target) =>
  Boolean(target) && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

// THE ROOM. One work on a dark wall, its label beneath it, and the being's own
// account of it under that.
//
// Design note, 2026-08-05: […]
//
// So the chrome names itself and gets out of the way: the top rail is walking
// and looking, nothing else; the work takes every pixel left over; the label
// and the account sit below it on a shelf that can never take more than its
// share, however long the being's thinking runs.
//
// ← → walk the CURRENT view (filtered and sorted, so arrowing inside VIDEOS
// never lands on a hidden image); Esc closes; the wheel leans in. Keys are
// bound on the dialog itself and it takes focus on open, so the shortcuts
// cannot leak into the desk behind it — and a key struck while the cursor is
// in the note field belongs to the note, not to the gallery.
export const Viewer = ({ item, position, onClose, onStep }) => {
  const ref = useRef(null);
  const stageRef = useRef(null);
  const artRef = useRef(null);

  const key = itemKey(item);
  const isImage = item.kind === 'image';
  // The account is fetched by the panel itself, but the rail has to know
  // whether there is one to offer a switch for — and that is decidable here,
  // purely, from the item's own identity.
  const hasAccount = Boolean(forgeRefOf(item));

  const [account, setAccount] = useState(true);

  // The lens (shared with the Lightbox). The wheel is suspended for videos:
  // nothing to lean into.
  const {
    view, setView, natural, setNatural, zoomed, base, zoomKey, stageProps,
  } = useLean(stageRef, artRef, key, { wheel: isImage });

  useEffect(() => { ref.current?.focus(); }, []);

  const onKeyDown = (e) => {
    // Escape is the one key that still answers from inside a text field — it
    // is how you leave. Everything else there is the operator writing.
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (isTyping(e.target)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); return; }
    zoomKey(e);
  };

  const plaque = plaqueOf(item, natural);
  const atStart = !position || position.index <= 1;
  const atEnd = !position || position.index >= position.total;

  return (
    <div
      className="gallery-viewer"
      role="dialog"
      aria-label={item.name}
      aria-modal="true"
      tabIndex={-1}
      ref={ref}
      onKeyDown={onKeyDown}
    >
      <div className="gallery-viewer-bar">
        <button type="button" className="gallery-act gallery-step" onClick={() => onStep(-1)} disabled={atStart} aria-label="Previous (left arrow)">‹</button>
        <span className="label-data gallery-viewer-pos">{position ? `${position.index} / ${position.total}` : ''}</span>
        <button type="button" className="gallery-act gallery-step" onClick={() => onStep(1)} disabled={atEnd} aria-label="Next (right arrow)">›</button>
        <span className="gallery-viewer-spacer" />
        {isImage ? (
          <>
            <span className="label-data gallery-viewer-zoom" title="of the work's own resolution">
              {displayPercent(base, natural, view.zoom)}%
            </span>
            <button type="button" className="gallery-act" onClick={() => setView(FIT)} disabled={!zoomed}>FIT</button>
          </>
        ) : null}
        {hasAccount ? (
          <button
            type="button"
            className={`gallery-act${account ? ' is-on' : ''}`}
            onClick={() => { uiSound('toggle'); setAccount((on) => !on); }}
            aria-pressed={account}
          >
            CONTEXT
          </button>
        ) : null}
        <button type="button" className="gallery-act" onClick={onClose}>CLOSE</button>
      </div>

      <div
        className={`gallery-viewer-stage${zoomed ? ' is-zoomed' : ''}`}
        ref={stageRef}
        {...stageProps}
      >
        {isImage
          // The hang is the browser's own: max-width/max-height fill the frame
          // and stop at the work's own resolution, because a max never
          // magnifies. Resizing the window rehangs it with no state at all.
          // The transform is the operator's lean ON TOP of that hang.
          ? (
            <img
              ref={artRef}
              className="gallery-viewer-media"
              src={fileSrc(item)}
              alt={item.name}
              style={{ transform: transformOf(view) }}
              draggable="false"
              onError={markMissing}
              onLoad={(e) => {
                clearMissing(e);
                setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
              }}
            />
          )
          // A real src is what the route's 206 support was BUILT for: the
          // element range-requests as it plays and can start on the first
          // chunk. Pulling the whole file into a blob first — the old path —
          // threw that away and made a large video sit black until every byte
          // had landed.
          // eslint-disable-next-line jsx-a11y/media-has-caption -- operator's own local media
          : <video className="gallery-viewer-media" src={fileSrc(item)} controls autoPlay loop />}

        {/* Walking the room by hand. Withdrawn while the operator is leaning
            in, because there a drag is a pan and an edge is somewhere to grab,
            not somewhere to click. */}
        {!zoomed && !atStart ? (
          <button type="button" className="gallery-walk gallery-walk-back" onClick={() => onStep(-1)} aria-label="Previous (left arrow)">‹</button>
        ) : null}
        {!zoomed && !atEnd ? (
          <button type="button" className="gallery-walk gallery-walk-on" onClick={() => onStep(1)} aria-label="Next (right arrow)">›</button>
        ) : null}
      </div>

      {/* THE WALL LABEL. Under the work, where a label goes. */}
      <div className="gallery-plaque">
        <span className="gallery-plaque-maker">{plaque.maker}</span>
        <span className="label-data gallery-plaque-facts">{plaque.facts.join(' · ')}</span>
        <span className="label-data gallery-plaque-accession" title={item.rel}>{plaque.accession}</span>
      </div>

      {/* THE OPERATOR'S EYE — renders itself only for a forge render in a
          being's own art folder; anything else in the gallery has no prompt
          behind it and nothing to be judged for adherence against. */}
      {account ? <ImageVerdict item={item} /> : null}
    </div>
  );
};
