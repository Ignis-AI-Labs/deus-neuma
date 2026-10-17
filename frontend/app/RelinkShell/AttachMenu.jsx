// AttachMenu — the composer's "+" affordance: everything a witness can bring
// into the conversation, in one place beside the field.
//
//   ADD FILES…       real file chooser → the same admission path as paste/drop
//                    (honest note when the substrate cannot see images)
//   OPEN FOLDER…     browse the disk → the shared open-folder flow (the chat's
//                    working folder / repository focus)
//   PROJECT          activate a project right here, or open the Projects window
//
// The drop-up must render OUTSIDE the chamfered input box (its clip-path clips
// positioned descendants — the palette learned this live), so the whole control
// sits beside the box in the composer row and anchors its menu to
// .relink-compose, exactly like the slash palette.

import { memo, useEffect, useRef, useState } from 'react';
import { useProjects } from './projects/project-context.js';
import { useWindows } from '../windowing/use-windows.js';
import { FolderOpenFlow } from './projects/FolderOpenFlow.jsx';
import { attachMenuModel } from './composer-attach.js';
import { uiSound } from '../../services/ui-sound.js';

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * @param {{
 *   disabled: boolean,
 *   vision: boolean|null,
 *   onFiles: (files: File[]) => void,
 *   onNote: (message: string) => void,
 * }} props
 */
const AttachMenuView = ({ disabled, vision, onFiles, onNote }) => {
  const { projects, activeProjectId, activate } = useProjects();
  const { dispatch } = useWindows();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef(null);
  const rootRef = useRef(null);

  // Esc or a click anywhere outside closes the menu — same manners as the dock.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const model = attachMenuModel({ vision, projects, activeProjectId });

  const chooseFiles = () => {
    setOpen(false);
    fileRef.current?.click();
  };
  const focusFolder = () => {
    setOpen(false);
    setPicking(true);
  };
  const pickProject = async (p) => {
    setOpen(false);
    if (p.active) return;
    try { await activate(p.id); } catch (e) { onNote(e.message); }
  };
  const manageProjects = () => {
    setOpen(false);
    dispatch({ type: 'OPEN', id: 'projects' });
  };

  return (
    <div className="relink-attach-root" ref={rootRef}>
      <button
        type="button"
        className="relink-plus"
        disabled={disabled}
        aria-label="Add to this conversation"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Add files, focus a folder, or switch project"
        onClick={() => { uiSound(open ? 'close' : 'tick'); setOpen((o) => !o); }}
      >
        <PlusIcon />
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = ''; // choosing the same file twice must fire again
          if (files.length > 0) onFiles(files);
        }}
      />
      {open ? (
        <div className="relink-attach-menu" role="menu" aria-label="Add to this conversation">
          <button type="button" role="menuitem" className="relink-attach-menu-row" onClick={chooseFiles}>
            <span className="relink-attach-menu-name">ADD FILES…</span>
            <span className={`relink-attach-menu-desc${model.visionOff ? ' is-limit' : ''}`}>{model.filesDesc}</span>
          </button>
          <button type="button" role="menuitem" className="relink-attach-menu-row" onClick={focusFolder}>
            <span className="relink-attach-menu-name">OPEN FOLDER…</span>
            <span className="relink-attach-menu-desc">focus the working folder or repository</span>
          </button>
          <div className="relink-attach-menu-sect label-data">PROJECT</div>
          {model.projects.length === 0 ? (
            <span className="relink-attach-menu-empty label-data">NONE YET — OPEN A FOLDER OR CREATE ONE</span>
          ) : model.projects.map((p) => (
            <button
              key={p.id} type="button" role="menuitemradio" aria-checked={p.active}
              className={`relink-attach-menu-row is-project${p.active ? ' is-active' : ''}`}
              onClick={() => pickProject(p)}
            >
              <span className="relink-attach-menu-mark" aria-hidden="true" />
              <span className="relink-attach-menu-name">{p.name}</span>
              {p.active ? <span className="relink-attach-menu-desc">active</span> : null}
            </button>
          ))}
          <button type="button" role="menuitem" className="relink-attach-menu-row" onClick={manageProjects}>
            <span className="relink-attach-menu-name">MANAGE PROJECTS…</span>
          </button>
        </div>
      ) : null}
      <FolderOpenFlow
        open={picking}
        onDone={(opened, message) => {
          setPicking(false);
          if (message) onNote(message);
        }}
      />
    </div>
  );
};

// Memoized: the composer re-renders on every keystroke; this does not need to
// (2026-09-28 smoothness pass).
export const AttachMenu = memo(AttachMenuView);
