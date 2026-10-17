// ImageApp — one picture, one window (the EditorApp law: a file opened from
// the FILES tree never renders squeezed into the Explorer rail — it gets its
// own floating desk window). multiInstance: every opened image spawns a
// sibling (`image#N`); clicking an already-open one focuses its window
// instead. The spawn payload is the file's absolute path — only ever a HINT:
// every read re-clears the backend's roots containment, exactly as the tree's
// own operations do. The window never launches from the dock
// (launcher: false) — it is born from the tree.
//
// Design note, 2026-08-30: […]
//
// A THIRD APP rather than a branch inside the editor, because that is the
// shape already here: PDFs took their own window for the same reason, and the
// tree routes by extension in one place (FilesApp). An image is not a document
// with an unreadable body — it is a different KIND of thing, and the editor's
// SAVE, dirty marker and conflict machinery mean nothing for it.

import { baseName } from '../../../utils/path.js';
import { Suspense } from 'react';
import './ImageApp.css';
import { AppTitle } from '../app-title.jsx';
import { EmptyState } from '../empty-state.jsx';
import { lazyChunk } from '../lazy-chunk.jsx';

const ImageView = lazyChunk(() => import('./ImageView.jsx'), 'THE VIEWER');

const ImageIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" />
    <circle cx="5.5" cy="6.5" r="1" />
    <path d="M2.5 12 L6.5 8 L9 10.5 L11 9 L13.5 11.5" />
  </svg>
);

const ImageBody = ({ payload }) => {
  const path = payload || null; // absolute file path, born with the window
  if (!path) {
    return <div className="image-app"><EmptyState title="NO IMAGE — OPEN ONE FROM THE FILES TREE." /></div>;
  }
  return (
    <div className="image-app">
      <div className="files-panehead">
        <span className="files-panepath label-data">{path}</span>
      </div>
      <Suspense fallback={<EmptyState title="OPENING…" />}>
        <ImageView path={path} />
      </Suspense>
    </div>
  );
};

export const imageApp = {
  label: 'IMAGE',
  labelKey: 'apps.image',
  icon: <ImageIcon />,
  Body: ImageBody,
  storageKey: 'image',
  multiInstance: true,
  // Never a dock/start launcher — windows are born from the FILES tree only.
  launcher: false,
  // The window is titled by its picture; a payload-less window is just IMAGE.
  makeTitle: (ordinal, payload) => <AppTitle label={payload ? baseName(payload).toUpperCase() : 'IMAGE'} labelKey={payload ? undefined : 'apps.image'} />,
};
