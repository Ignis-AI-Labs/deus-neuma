// ImageView — the picture, shown (the lazy chunk, exactly as PdfView carries
// pdf.js: nothing here loads until an image is actually opened).
//
// Design note, 2026-08-30: […] Opening a PNG rendered […] — true, and
// useless: the editor correctly refused to show bytes as text and then stopped
// there, with no one asking whether these particular bytes were a picture.
//
// WHY BLOB AND NOT A URL. `/raw` exists already, and `rawFileUrl` would be one
// line — but it carries the session token in the QUERY STRING (a native
// download cannot send a header, which is why that door exists). Pointing an
// <img> at it would write the operator's token into the DOM, and from there
// into any error report or screenshot of the element. `readRawBytes` sends the
// token as a HEADER, exactly as the PDF reader does. The route also serves
// every file as `application/octet-stream` with a download disposition, so the
// blob's type is restored from the extension or the browser will not decode it.

import { useEffect, useRef, useState } from 'react';
import { readRawBytes } from '../../../services/user-files.js';
import { imageMime, byteLabel, stepZoom, zoomLabel } from './image-view-model.js';
import { EmptyState } from '../empty-state.jsx';
import { mediaMenuDoor } from '../media-menu.js';

const ImageView = ({ path }) => {
  const [url, setUrl] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [dims, setDims] = useState(null);
  const [zoom, setZoom] = useState(0); // 0 = FIT
  const [error, setError] = useState(null);
  const imgRef = useRef(null);

  // One load per birth path; the settled flag absorbs an unmount mid-read.
  //
  // The object URL is REVOKED on the way out. A blob URL pins its bytes in
  // memory for the document's life, so a witness opening a folder of renders
  // one after another would hold every one of them until the desk reloaded.
  useEffect(() => {
    let settled = false;
    let objectUrl = null;
    setUrl(null);
    setError(null);
    setDims(null);
    (async () => {
      try {
        const buf = await readRawBytes(path);
        if (settled) return;
        objectUrl = URL.createObjectURL(new Blob([buf], { type: imageMime(path) }));
        setBytes(buf.byteLength);
        setUrl(objectUrl);
      } catch (e) {
        if (!settled) setError(e.message || 'The image would not open.');
      }
    })();
    return () => {
      settled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (error) return <EmptyState title={error} tone="error" />;
  if (!url) return <EmptyState title="OPENING…" />;

  const size = byteLabel(bytes);
  const natural = dims ? `${dims.w} × ${dims.h}` : null;

  return (
    <div className="imageview">
      <div className="imageview-bar label-data">
        {/* What the file IS — the two facts a person opening a render wants,
            and neither is discoverable from the picture alone. */}
        <span className="imageview-fact">{natural || '—'}</span>
        <span className="imageview-fact">{size || '—'}</span>
        <span className="imageview-zoomset">
          <button type="button" className="imageview-btn" onClick={() => setZoom((z) => stepZoom(z, -1))} aria-label="Zoom out">−</button>
          <button type="button" className="imageview-btn imageview-zoom" onClick={() => setZoom(0)} title="Fit to the window">
            {zoomLabel(zoom)}
          </button>
          <button type="button" className="imageview-btn" onClick={() => setZoom((z) => stepZoom(z, 1))} aria-label="Zoom in">+</button>
        </span>
      </div>
      {/* The CHECKER is not decoration: transparency is information about a
          render, and on this desk's pure-black ground a transparent PNG and a
          black one look identical. */}
      <div className={`imageview-stage${zoom === 0 ? ' is-fit' : ''}`}>
        <img
          ref={imgRef}
          src={url}
          alt={path}
          className="imageview-img"
          {...mediaMenuDoor({ kind: 'image', src: url, path, alt: path })}
          style={zoom === 0 ? undefined : { width: `${dims ? dims.w * zoom : 0}px`, height: 'auto' }}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setError('THESE BYTES ARE NOT AN IMAGE THIS BROWSER CAN DECODE.')}
        />
      </div>
    </div>
  );
};

export default ImageView;
