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
// slot per image. Where a route can accept the token another way — /gallery/file
// takes `?token=`, and the gallery is a plain <img> because of it — prefer that
// and let the browser do what it is good at. Reach for AuthImage only when the
// route genuinely offers no such door.

import { useEffect, useState } from 'react';
import { authHeadersOrNull } from '../../utils/http.js';
import './AuthImage.css';

/**
 * @param {{src: string, alt?: string, className?: string, onClick?: Function}} props
 *   `src` is an app-relative authenticated URL, already carrying any query the
 *   route needs (e.g. `?laneId=…`).
 */
export const AuthImage = ({ src, alt = '', className, onClick }) => {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

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
  return <img className={className} src={url} alt={alt} onClick={onClick} />;
};
