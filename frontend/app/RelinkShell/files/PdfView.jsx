// PdfView — the document, rendered (the lazy chunk: pdf.js loads only when
// a PDF is actually opened, exactly like CodeEditor carries its own weight).
//
// Bytes come over the backend's /raw with the Bearer header — the SAME
// roots containment every file act clears; this window's payload is only
// ever a hint. The render loop cancels the in-flight render when the
// witness moves faster than the raster (page flips, zoom steps) — pdf.js
// refuses a second render onto one canvas, and a stale page must never land
// over the current one.
//
// The math is the pure model (pdf-view-model.js): this file owns IO and
// pixels, never decisions.

import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readRawBytes } from '../../../services/user-files.js';
import { clampPage, stepZoom, zoomLabel, pageLabel } from './pdf-view-model.js';
import { EmptyState } from '../empty-state.jsx';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PdfView = ({ path }) => {
  const [doc, setDoc] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(null);
  const canvasRef = useRef(null);
  const renderRef = useRef(null); // the in-flight render task, cancelable

  // One load per birth path; the settled flag absorbs an unmount mid-read.
  // A dead document is destroyed — pdf.js holds the bytes and the worker
  // until told otherwise.
  useEffect(() => {
    let settled = false;
    let loaded = null;
    setDoc(null);
    setError(null);
    setPage(1);
    (async () => {
      try {
        const bytes = await readRawBytes(path);
        if (settled) return;
        loaded = await pdfjs.getDocument({ data: bytes }).promise;
        if (settled) { loaded.destroy(); return; }
        setDoc(loaded);
        setPageCount(loaded.numPages);
      } catch (e) {
        if (!settled) setError(e.message || 'The document would not open.');
      }
    })();
    return () => {
      settled = true;
      loaded?.destroy?.();
    };
  }, [path]);

  // The raster: current page at current zoom, device-pixel crisp. A render
  // already running is cancelled FIRST — the newest decision always wins,
  // and pdf.js's one-render-per-canvas law is never broken.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const pdfPage = await doc.getPage(clampPage(page, pageCount));
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: zoom * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        renderRef.current?.cancel?.();
        const task = pdfPage.render({ canvas, viewport });
        renderRef.current = task;
        await task.promise;
      } catch (e) {
        // A cancellation is the loop working, not an error.
        if (!cancelled && e?.name !== 'RenderingCancelledException') setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [doc, page, zoom, pageCount]);

  if (error) return <EmptyState title={error} tone="error" />;
  if (!doc) return <EmptyState title="OPENING…" />;

  return (
    <div className="pdf-view">
      <div className="pdf-bar label-data">
        <button type="button" className="pdf-act" disabled={page <= 1}
          onClick={() => setPage((p) => clampPage(p - 1, pageCount))} title="Previous page">‹</button>
        <span className="pdf-pos">{pageLabel(page, pageCount)}</span>
        <button type="button" className="pdf-act" disabled={page >= pageCount}
          onClick={() => setPage((p) => clampPage(p + 1, pageCount))} title="Next page">›</button>
        <span className="pdf-gap" />
        <button type="button" className="pdf-act" disabled={zoom <= 0.25}
          onClick={() => setZoom((z) => stepZoom(z, -1))} title="Zoom out">−</button>
        <span className="pdf-pos">{zoomLabel(zoom)}</span>
        <button type="button" className="pdf-act" disabled={zoom >= 4}
          onClick={() => setZoom((z) => stepZoom(z, 1))} title="Zoom in">+</button>
      </div>
      <div className="pdf-stage">
        <canvas ref={canvasRef} className="pdf-canvas" />
      </div>
    </div>
  );
};

export default PdfView;
