// PdfApp — one document, one window (the EditorApp law: a file opened from
// the FILES tree never renders squeezed into the Explorer rail — it gets
// its own floating desk window). multiInstance: every opened PDF spawns a
// sibling (`pdf#N`); clicking an already-open one focuses its window
// instead. The spawn payload is the file's absolute path — only ever a
// HINT: every read re-clears the backend's roots containment, exactly as
// the tree's own operations do. The window never launches from the dock
// (launcher: false) — it is born from the tree.

import { baseName } from '../../../utils/path.js';
import { Suspense } from 'react';
import './PdfApp.css';
import { AppTitle } from '../app-title.jsx';
import { EmptyState } from '../empty-state.jsx';
import { lazyChunk } from '../lazy-chunk.jsx';

const PdfView = lazyChunk(() => import('./PdfView.jsx'), 'THE READER');

const PdfIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M4 1.5 H9.5 L12.5 4.5 V14.5 H4 Z M9.5 1.5 V4.5 H12.5" />
    <path d="M6 8 H10.5 M6 10.5 H10.5" />
  </svg>
);

const PdfBody = ({ payload }) => {
  const path = payload || null; // absolute file path, born with the window
  if (!path) {
    return <div className="pdf-app"><EmptyState title="NO DOCUMENT — OPEN ONE FROM THE FILES TREE." /></div>;
  }
  return (
    <div className="pdf-app">
      <div className="files-panehead">
        <span className="files-panepath label-data">{path}</span>
      </div>
      <Suspense fallback={<EmptyState title="OPENING…" />}>
        <PdfView path={path} />
      </Suspense>
    </div>
  );
};

export const pdfApp = {
  label: 'PDF',
  labelKey: 'apps.pdf',
  icon: <PdfIcon />,
  Body: PdfBody,
  storageKey: 'pdf',
  multiInstance: true,
  // Never a dock/start launcher — windows are born from the FILES tree only.
  launcher: false,
  // The window is titled by its document; a payload-less window is just PDF.
  makeTitle: (ordinal, payload) => <AppTitle label={payload ? baseName(payload).toUpperCase() : 'PDF'} labelKey={payload ? undefined : 'apps.pdf'} />,
};
