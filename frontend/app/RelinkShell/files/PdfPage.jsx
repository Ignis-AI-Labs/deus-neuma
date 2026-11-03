// One page in the continuous reader. Each canvas owns its own cancelable
// raster so a zoom or unmount cannot land stale pixels over the current view.

import { useEffect, useRef, useState } from 'react';

const PdfPage = ({ doc, pageNumber, zoom, pageRef, onReady }) => {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas) return undefined;
    let cancelled = false;
    let task = null;
    setReady(false);
    setError(null);
    (async () => {
      try {
        const pdfPage = await doc.getPage(pageNumber);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: zoom * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        task = pdfPage.render({ canvas, viewport });
        await task.promise;
        if (!cancelled) {
          setReady(true);
          onReady?.(pageNumber);
        }
      } catch (e) {
        if (!cancelled && e?.name !== 'RenderingCancelledException') setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [doc, pageNumber, zoom, onReady]);

  return (
    <section className="pdf-page" data-page={pageNumber} ref={pageRef}>
      <canvas ref={canvasRef} className="pdf-canvas" aria-label={`PDF page ${pageNumber}`} />
      {!ready && !error ? <div className="pdf-page-loading label-data">OPENING PAGE {pageNumber}…</div> : null}
      {error ? <div className="pdf-page-loading label-data" role="alert">{error}</div> : null}
    </section>
  );
};

export default PdfPage;
