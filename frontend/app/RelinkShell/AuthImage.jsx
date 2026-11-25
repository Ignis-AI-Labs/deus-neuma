// AuthImage — an <img> for bytes that live behind `requireAuth`.
//
// Some image routes NEUMA serves are authenticated and lane-scoped: the route
// reads a Bearer token and a laneId before it will hand over a single byte. A
// plain `<img src>` sends neither — the browser issues its own bare GET — so a
// thumbnail wired that way can only ever render as a broken-image glyph, which
// is exactly what the AI-activity rail was showing.
//
// So the bytes are FETCHED (headers and all), turned into an object URL, and
// that URL is what the <img> is given. The URL is revoked on unmount and on
// every src change: an object URL is a document-lifetime reference.
//
// THIS IS THE FALLBACK, not the pattern. Fetching by hand costs the HTTP cache,
// progressive decode, and native memory eviction, and it spends a rate-limit
// slot per image. Where a route offers an exact-resource ticket — /gallery/file
// takes `?ticket=`, and the gallery is a plain <img> because of it — prefer that
// and let the browser do what it is good at. Reach for AuthImage only when the
// route genuinely offers no such door.

import { useEffect, useState } from 'react';
import { Lightbox } from './Lightbox.jsx';
import { uiSound } from '../../services/ui-sound.js';
import { authHeadersOrNull } from '../../utils/http.js';
import { forgeImageIdOf, mediaMenuDoor } from './media-menu.js';
import './AuthImage.css';

/**
 * @param {{src: string, alt?: string, className?: string, onClick?: Function, video?: boolean,
 *   media?: {path?: string, name?: string, mime?: string}, menu?: boolean}} props
 *   `src` is an app-relative authenticated URL, already carrying any query the
 *   route needs (e.g. `?laneId=…`). `video` plays the same bytes in a player —
 *   a forge render can be a clip with sound (video.ltx.i2v), not only a still.
 *   Every loaded image and clip wears the media menu (media-menu.js): a forge
 *   render's id is read from its URL, so it can open in the gallery; `media`
 *   adds what only the caller knows (the file's path on disk). `menu={false}`
 *   is for what is not content (a pairing code). `zoom` makes a still a door to the Lightbox: one press and it hangs
 *   full size, wheel to zoom, drag to pan (Design note, 2026-11-20, a render in the chat: […]) — the same bytes, no second fetch.
 */
export const AuthImage = ({ src, alt = '', className, onClick, video = false, media = null, menu = true, zoom = false }) => {
  const [url, setUrl] = useState(null);
  const [mime, setMime] = useState('');
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setUrl(null);
    setFailed(false);

    (async () => {
      const headers = authHeadersOrNull();
      if (!headers || !src) { if (alive) setFailed(true); return; }
      try {
        const res = await fetch(src, { headers });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setMime(blob.type);
        setUrl(objectUrl);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) return <span className={`authimg-missing ${className || ''}`} title="could not load" aria-label={alt} />;
  if (!url) return <span className={`authimg-loading ${className || ''}`} aria-hidden="true" />;
  const door = menu
    ? mediaMenuDoor({ kind: video ? 'video' : 'image', src: url, mime, imageId: forgeImageIdOf(src), alt, ...media })
    : null;
  if (video) return <video className={className} src={url} aria-label={alt} controls playsInline preload="metadata" {...door} />;
  if (zoom) {
    return (
      <>
        <button type="button" className="authimg-zoom" aria-label={`view ${alt || 'the image'} full size`}
          onClick={() => { uiSound('toggle'); setZoomed(true); }} {...door}>
          <img className={className} src={url} alt={alt} />
        </button>
        {zoomed ? <Lightbox src={url} alt={alt} caption={media?.path || alt} onClose={() => setZoomed(false)} /> : null}
      </>
    );
  }
  return <img className={className} src={url} alt={alt} onClick={onClick} tabIndex={door ? 0 : undefined} {...door} />;
};
