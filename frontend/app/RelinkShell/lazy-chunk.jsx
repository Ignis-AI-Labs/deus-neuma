// lazy-chunk.jsx — lazy() over a code-split chunk, honest about rebuilds.
//
// A desk window that outlives a rebuild holds a main bundle whose chunk
// hashes no longer exist on disk — the first lazy surface it opens (editor,
// terminal, vessel) then dies as an uncaught fetch error and takes the desk
// with it ("RUNTIME ERROR", Design note, 2026-07-24. That failure is not the
// surface's fault and not fatal: the build on disk is coherent; only THIS
// window is stale. So a failed chunk import resolves to an honest in-window
// notice carrying the one real remedy — RELOAD — and the WITNESS chooses the
// moment: an auto-reload would silently drop dirty buffers in sibling
// windows, and the crash overlay dropped the whole desk.

import { lazy } from 'react';
import './lazy-chunk.css';

const StaleChunkNotice = ({ what }) => (
  <div className="chunkfail">
    <div className="chunkfail-head label-data">«WARNING» {what} FAILED TO LOAD</div>
    <p className="chunkfail-body">
      The desk was likely rebuilt underneath this window — its code moved.
      Reloading picks up the current build. Save any unsaved buffers in other
      windows first: they will not survive the reload.
    </p>
    <button type="button" className="chunkfail-reload" onClick={() => window.location.reload()}>
      RELOAD DESK
    </button>
  </div>
);

/**
 * Drop-in for `lazy(importer)` on code-split surfaces: a chunk that fails to
 * fetch renders the stale-build notice instead of throwing to the nearest
 * boundary (or, absent one, the global overlay).
 * @param {() => Promise<{default: import('react').ComponentType}>} importer
 * @param {string} what - the surface's name, spoken in the notice
 */
export const lazyChunk = (importer, what) => lazy(() =>
  importer().catch(() => ({ default: () => <StaleChunkNotice what={what} /> })),
);
