// HistoryImage — a pasted image in a chat's history. The display view leaves the
// image itself at the server (session-display.js); this holds its place, says
// how large it is, and reads it once it comes near the screen. A live image
// (or one from before the display view) draws exactly as it always did.

import { useEffect, useRef, useState } from 'react';
import { useLazyDetail } from './use-lazy-detail.js';
import { mediaMenuDoor } from './media-menu.js';

const kb = (bytes) => (Number.isFinite(bytes) ? `${Math.round(bytes / 1024).toLocaleString()} KB` : '');

export const HistoryImage = ({ segment }) => {
  const box = useRef(null);
  const [near, setNear] = useState(false);
  const lazyRef = segment.src ? null : segment.ref ?? null;
  useEffect(() => {
    if (!lazyRef || near || !box.current) return undefined;
    // impure — one screen of lead, so it is there by the time it is seen
    const watch = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: '100% 0px' });
    watch.observe(box.current);
    return () => watch.disconnect();
  }, [lazyRef, near]);
  const lazy = useLazyDetail(lazyRef, near);
  const src = segment.src || lazy.value;
  // A pasted picture lives in the record only — no file, no gallery — so its
  // menu holds the loupe, the download and the clipboard (media-menu.js).
  if (src) {
    return (
      <img className="relink-msg-image" src={src} alt="shared image" loading="lazy" tabIndex={0}
        {...mediaMenuDoor({ kind: 'image', src, alt: 'shared image' })} />
    );
  }
  return (
    <div ref={box} className="relink-msg-image relink-msg-image--pending label-data" role="img" aria-label="shared image, loading">
      {lazy.state === 'failed' ? 'IMAGE COULD NOT BE READ' : lazy.state === 'missing' ? 'IMAGE NO LONGER IN THE RECORD' : `IMAGE ${kb(segment.bytes)}`}
    </div>
  );
};
