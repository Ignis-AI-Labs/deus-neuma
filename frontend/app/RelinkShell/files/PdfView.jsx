// PdfView — a continuous document, rendered one real page at a time as the
// operator reaches it. Earlier pages stay mounted above; the center of the
// viewport decides which page the instrument names.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readRawBytes } from '../../../services/user-files.js';
import { clampPage, stepZoom, zoomLabel, pageLabel } from './pdf-view-model.js';
import { EmptyState } from '../empty-state.jsx';
import PdfPage from './PdfPage.jsx';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PdfView = ({ path }) => {
  const [doc, setDoc] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [renderCount, setRenderCount] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(null);
  const stageRef = useRef(null);
  const pageRefs = useRef({});
  const pendingPageRef = useRef(null);
  const renderCountRef = useRef(1);
  const appendLockRef = useRef(false);
  const revealNextRef = useRef(false);

  useEffect(() => {
    let settled = false;
    let loaded = null;
    setDoc(null);
    setError(null);
    setCurrentPage(1);
    setRenderCount(1);
    renderCountRef.current = 1;
    appendLockRef.current = false;
    revealNextRef.current = false;
    setPageCount(0);
    pageRefs.current = {};
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

  const updateCurrentPage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const center = stage.getBoundingClientRect().top + (stage.clientHeight / 2);
    let nearest = 1;
    let nearestDistance = Infinity;
    for (const [page, node] of Object.entries(pageRefs.current)) {
      const rect = node.getBoundingClientRect();
      const distance = rect.top > center ? rect.top - center : center > rect.bottom ? center - rect.bottom : 0;
      if (distance < nearestDistance) {
        nearest = Number(page);
        nearestDistance = distance;
      }
    }
    setCurrentPage(nearest);
  }, []);

  useEffect(() => {
    const target = pendingPageRef.current;
    const node = target ? pageRefs.current[target] : null;
    if (!node) return;
    pendingPageRef.current = null;
    node.scrollIntoView({ block: 'start' });
    setCurrentPage(target);
  }, [renderCount]);

  const goToPage = useCallback((page) => {
    const target = clampPage(page, pageCount);
    pendingPageRef.current = target;
    setRenderCount((count) => Math.max(count, target));
    const node = pageRefs.current[target];
    if (node) {
      pendingPageRef.current = null;
      node.scrollIntoView({ block: 'start' });
      setCurrentPage(target);
    }
  }, [pageCount]);

  useEffect(() => {
    renderCountRef.current = renderCount;
    appendLockRef.current = false;
    if (!revealNextRef.current) updateCurrentPage();
  }, [renderCount, updateCurrentPage]);

  const onPageReady = useCallback((pageNumber) => {
    if (!revealNextRef.current || renderCountRef.current !== pageNumber) return;
    revealNextRef.current = false;
    const stage = stageRef.current;
    const node = pageRefs.current[pageNumber];
    if (stage && node) {
      const offset = node.getBoundingClientRect().top - stage.getBoundingClientRect().top;
      stage.scrollTop += offset;
    }
    setCurrentPage(pageNumber);
  }, []);

  const showNextPage = useCallback(() => {
    if (appendLockRef.current || renderCountRef.current >= pageCount) return;
    appendLockRef.current = true;
    revealNextRef.current = true;
    setRenderCount(renderCountRef.current + 1);
  }, [pageCount]);

  const onScroll = useCallback((event) => {
    updateCurrentPage();
    if (event.deltaY < 0) return;
    const stage = event.currentTarget;
    if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 120) showNextPage();
  }, [showNextPage, updateCurrentPage]);

  if (error) return <EmptyState title={error} tone="error" />;
  if (!doc) return <EmptyState title="OPENING…" />;

  return (
    <div className="pdf-view">
      <div className="pdf-bar label-data">
        <button type="button" className="pdf-act" disabled={currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)} title="Previous page">‹</button>
        <span className="pdf-pos">{pageLabel(currentPage, pageCount)}</span>
        <button type="button" className="pdf-act" disabled={currentPage >= pageCount}
          onClick={() => goToPage(currentPage + 1)} title="Next page">›</button>
        <span className="pdf-gap" />
        <button type="button" className="pdf-act" disabled={zoom <= 0.25}
          onClick={() => setZoom((z) => stepZoom(z, -1))} title="Zoom out">−</button>
        <span className="pdf-pos">{zoomLabel(zoom)}</span>
        <button type="button" className="pdf-act" disabled={zoom >= 4}
          onClick={() => setZoom((z) => stepZoom(z, 1))} title="Zoom in">+</button>
      </div>
      <div className="pdf-stage" ref={stageRef} onScroll={onScroll} onWheel={onScroll}>
        {Array.from({ length: renderCount }, (_, index) => index + 1).map((pageNumber) => (
          <PdfPage
            key={`${path}:${pageNumber}`}
            doc={doc}
            pageNumber={pageNumber}
            zoom={zoom}
            onReady={onPageReady}
            pageRef={(node) => {
              if (node) pageRefs.current[pageNumber] = node;
              else delete pageRefs.current[pageNumber];
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default PdfView;
