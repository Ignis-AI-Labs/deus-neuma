// EditorApp — one file, one window (witness law: a file opened from the
// FILES tree never renders squeezed into the Explorer rail — it gets its own
// floating desk window). multiInstance: every opened file spawns a sibling
// (`editor#N`); clicking an already-open file focuses its window instead of
// duplicating it. The spawn payload is the file's absolute path — only ever
// a HINT: every read and write re-clears the backend's roots containment,
// exactly as the tree's own operations do. The window never launches from
// the dock (launcher: false) — it is born from the tree.

import { baseName } from '../../../utils/path.js';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import './EditorApp.css';
import { readFile, writeFile } from '../../../services/user-files.js';
import { createTrailingBatch } from '../../../utils/trailing-batch.js';
import { AppTitle } from '../app-title.jsx';
import { EmptyState } from '../empty-state.jsx';
import { lazyChunk } from '../lazy-chunk.jsx';

const CodeEditor = lazyChunk(() => import('./CodeEditor.jsx'), 'THE EDITOR');

const EditorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M4 1.5 H9.5 L12.5 4.5 V14.5 H4 Z M9.5 1.5 V4.5 H12.5" />
  </svg>
);

const EditorBody = ({ payload }) => {
  const path = payload || null; // absolute file path, born with the window
  const [file, setFile] = useState(null); // null = loading; {doc} | {binary, truncated}
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [note, setNote] = useState('');
  const [loadId, setLoadId] = useState(1);
  const draftRef = useRef('');
  const baselineRef = useRef('');
  const mtimeRef = useRef(null); // mtimeMs the buffer was read at — SAVE's precondition (#235)
  const selfEventRef = useRef(false); // our own files-changed dispatch is not an external change

  // One load per birth path; the settled flag absorbs an unmount mid-read.
  // A payload CHANGE mid-session is the tree renaming this file under us
  // (REPAYLOAD): a clean buffer re-reads at the new path, a dirty buffer is
  // kept — the save retargets, the witness's edits are never silently
  // dropped (the retired in-panel editor behaved the same).
  useEffect(() => {
    if (!path) return undefined;
    if (draftRef.current !== baselineRef.current) return undefined;
    let settled = false;
    (async () => {
      try {
        const r = await readFile(path);
        if (settled) return;
        if (r.binary || r.truncated) {
          setFile({ binary: r.binary, truncated: r.truncated });
          return;
        }
        baselineRef.current = r.content;
        draftRef.current = r.content;
        mtimeRef.current = r.mtimeMs ?? null;
        // `lossy` — the bytes on disk are not UTF-8, so this buffer is a
        // READING of the file, not the file. SAVE would rewrite every legacy
        // byte as U+FFFD, including ones the operator never touched (#239).
        setFile({ doc: r.content, lossy: r.lossy === true, lossyChars: r.lossyChars ?? 0 });
      } catch (e) { if (!settled) setNote(e.message); }
    })();
    return () => { settled = true; };
  }, [path]);

  const onEditorChange = useCallback((text) => {
    draftRef.current = text;
    setDirty(text !== baselineRef.current);
  }, []);

  // impure — re-read disk as the new baseline. The clean-buffer fast path and
  // the operator's explicit RELOAD both land here; a dirty buffer never does
  // on its own (a conflict is surfaced, not resolved).
  const reload = useCallback(async () => {
    try {
      const r = await readFile(path);
      if (r.binary || r.truncated) {
        setFile({ binary: r.binary, truncated: r.truncated });
        setConflict(false);
        return;
      }
      baselineRef.current = r.content;
      draftRef.current = r.content;
      mtimeRef.current = r.mtimeMs ?? null;
      setFile({ doc: r.content, lossy: r.lossy === true, lossyChars: r.lossyChars ?? 0 });
      setDirty(false);
      setConflict(false);
      setLoadId((n) => n + 1); // a fresh editor view — the document changed underneath
      setNote(`Reloaded ${baseName(path)}`);
    } catch (e) { setNote(e.message); }
  }, [path]);

  // impure — land the buffer on disk and stamp the new baseline/mtime.
  const landWrite = useCallback(async (expectedMtimeMs) => {
    const r = await writeFile(path, draftRef.current, expectedMtimeMs);
    baselineRef.current = draftRef.current;
    mtimeRef.current = r.mtimeMs ?? null;
    setDirty(false);
    setConflict(false);
    // The tree re-reads the dir and re-probes git so the badges track.
    selfEventRef.current = true;
    window.dispatchEvent(new CustomEvent('neuma:files-changed', { detail: { path } }));
    selfEventRef.current = false;
  }, [path]);

  const save = useCallback(async () => {
    if (!file?.doc && file?.doc !== '') return;
    if (file?.lossy) return; // the backend refuses this too — the button is not the guarantee
    try {
      await landWrite(mtimeRef.current ?? undefined);
      setNote(`Saved ${baseName(path)}`);
    } catch (e) {
      // Disk moved since this buffer was read (#235): nothing was written —
      // surface the choice instead of destroying work the buffer never held.
      if (e.code === 'CONFLICT' || e.http === 409) { setConflict(true); setNote(''); return; }
      setNote(e.message);
    }
  }, [file, path, landWrite]);

  // The operator's explicit second half of the conflict choice: write the
  // buffer unconditionally, destroying the disk version — said, never silent.
  const overwrite = useCallback(async () => {
    try {
      await landWrite(undefined);
      setNote(`Saved ${baseName(path)} — the disk version was overwritten`);
    } catch (e) { setNote(e.message); }
  }, [path, landWrite]);

  // The editor publishes on this bus after its own save and listened to
  // nothing (#235) — a being's act on this file (both streams announce via
  // announceFileChange) was invisible, and the next SAVE destroyed it. A
  // clean buffer re-reads; a dirty buffer raises the conflict. Writes that
  // announce nothing (a shell, a build) are still caught — by the mtime
  // precondition on SAVE, which is the guarantee; this is the fast path.
  // The reload rides the SAME burst folding as the tree: a churned file (a
  // log, an agent's rewrite) fires per path per frame, and an unbatched
  // metered read per event was the one storm producer the 429 fix never
  // touched (audit, 2026-09-02). One reload per quiet window.
  useEffect(() => {
    const batch = createTrailingBatch(() => {
      if (draftRef.current === baselineRef.current) reload();
      else setConflict(true);
    });
    const onChanged = (e) => {
      if (selfEventRef.current) return;
      if (e.detail?.path !== path) return;
      batch.push(null);
    };
    window.addEventListener('neuma:files-changed', onChanged);
    return () => {
      window.removeEventListener('neuma:files-changed', onChanged);
      batch.cancel();
    };
  }, [path, reload]);

  if (!path) {
    return <div className="editor"><EmptyState title="NO FILE — OPEN ONE FROM THE FILES TREE." /></div>;
  }

  return (
    <div className="editor">
      <div className="files-panehead">
        <span className="files-panepath label-data">{path}{dirty ? ' •' : ''}</span>
        {file?.lossy ? <span className="files-readonly label-data">READ-ONLY</span> : null}
        <button type="button" className="files-save" onClick={save} disabled={!dirty || file?.lossy === true}>SAVE</button>
      </div>
      {file?.lossy ? (
        <div className="files-lossy label-data">
          «NOTICE» NOT UTF-8 — SAVE IS DISABLED. Writing this file back would destroy{' '}
          {file.lossyChars} character{file.lossyChars === 1 ? '' : 's'}, including ones you never
          touched. Shown with each byte read as Latin-1; if this text looks wrong, the file uses
          another encoding (Shift-JIS, GBK, …) that this editor cannot yet write.
        </div>
      ) : null}
      {conflict ? (
        <div className="files-conflict label-data">
          «WARNING» THE FILE CHANGED ON DISK — this buffer no longer matches what is there.
          Nothing was written. RELOAD takes the disk version and discards this buffer&apos;s
          unsaved edits; OVERWRITE writes this buffer and destroys the disk version.
          <span className="files-conflict-actions">
            <button type="button" className="files-conflict-btn" onClick={reload}>RELOAD FROM DISK</button>
            <button type="button" className="files-conflict-btn" onClick={overwrite}>OVERWRITE</button>
          </span>
        </div>
      ) : null}
      <div className="files-editor">
        {note && !file ? (
          <EmptyState title={note} tone="error" />
        ) : !file ? (
          <EmptyState title="OPENING…" />
        ) : file.binary ? (
          <EmptyState title="BINARY FILE — NOT SHOWN." />
        ) : file.truncated ? (
          <EmptyState title="FILE TOO LARGE TO OPEN IN THE EDITOR." />
        ) : (
          <Suspense fallback={<EmptyState title="OPENING…" />}>
            <CodeEditor
              path={path}
              doc={file.doc}
              loadId={loadId}
              onChange={onEditorChange}
              onSave={save}
              readOnly={file.lossy === true}
            />
          </Suspense>
        )}
      </div>
      {note && file ? <div className="files-note label-data">{note}</div> : null}
    </div>
  );
};

export const editorApp = {
  label: 'EDITOR',
  labelKey: 'apps.editor',
  icon: <EditorIcon />,
  Body: EditorBody,
  storageKey: 'editor',
  multiInstance: true,
  // Never a dock/start launcher — windows are born from the FILES tree only.
  launcher: false,
  // The window is titled by its file; a payload-less window is just EDITOR.
  makeTitle: (ordinal, payload) => <AppTitle label={payload ? baseName(payload).toUpperCase() : 'EDITOR'} labelKey={payload ? undefined : 'apps.editor'} />,
};
