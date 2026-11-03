// CodeEditor — CodeMirror 6 as a desk editor pane.
//
// Lazy-loaded (this whole module + CodeMirror is a dynamic-import chunk), so
// the editor only downloads when the witness opens a file. The view owns its
// document after init: `loadId` keys a fresh editor per opened file, onChange
// reports the live text (for dirty tracking / Save), and Mod-S saves without
// the browser's save dialog.

import { useEffect, useRef, useState } from 'react';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { loadLanguageFor } from './editor-language.js';

// THE LOOK reaches the editor chrome. CodeMirror injects these as real CSS
// rules, so var() resolves live against the dressed documentElement —
// background, gutters, cursor, selection all follow the dress while
// oneDark keeps carrying the SYNTAX voice (its highlight style selectors
// are untouched here).
const deskChrome = EditorView.theme({
  '&': { backgroundColor: 'var(--color-void)' },
  '.cm-scroller': { backgroundColor: 'var(--color-void)' },
  '.cm-content': { caretColor: 'var(--signal)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--signal)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-tertiary)',
    borderRight: '1px solid var(--line)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-glass-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--color-glass-hover)', color: 'var(--color-text-secondary)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'var(--signal-faint)' },
}, { dark: true });

const langFor = loadLanguageFor;

// `readOnly` uses EditorState.readOnly rather than EditorView.editable: the
// document is barred from changing, but the cursor and selection stay live, so
// the operator can still read, select and COPY out of a file the platform
// refuses to write back (#239). Mod-S is withheld too — a keyboard save must
// not reach a path the disabled SAVE button is guarding.
const CodeEditor = ({ path, doc, loadId, onChange, onSave, readOnly = false }) => {
  const hostRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const [languageError, setLanguageError] = useState(false);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return undefined;
    let disposed = false;
    setLanguageError(false);
    const saveKey = keymap.of([{
      key: 'Mod-s',
      preventDefault: true,
      run: (current) => {
        if (readOnly) return true; // swallowed, never forwarded
        onSaveRef.current?.(current.state.doc.toString());
        return true;
      },
    }]);
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
    });
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc,
        extensions: [
          basicSetup, oneDark, deskChrome, saveKey, listener,
          EditorView.lineWrapping,
          ...(readOnly ? [EditorState.readOnly.of(true)] : []),
        ],
      }),
    });
    langFor(path).then((language) => {
      if (!disposed) view.dispatch({ effects: StateEffect.appendConfig.of(language) });
    }).catch(() => { if (!disposed) setLanguageError(true); });
    return () => { disposed = true; view.destroy(); };
    // Recreate only on a new open (loadId), never on every keystroke — the view
    // owns the document after init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadId, readOnly, path]);

  return (
    <>
      {languageError ? <div className="files-note label-data">«WARNING» SYNTAX HIGHLIGHTING FAILED TO LOAD — THE DOCUMENT REMAINS EDITABLE.</div> : null}
      <div className="files-editor-host" ref={hostRef} />
    </>
  );
};

export default CodeEditor;
