// ExplorerPanel — the desk's persistent left rail (D6/D12).
//
// The witness's working surface: this window's focus (name + branch) up top,
// OPEN FOLDER riding the existing FolderOpenFlow, and the FILES tree HOSTED,
// never forked — the one mount of filesApp.Body anywhere
// (panel-only law D12), scoped through the pure focusRootsOf lens — and the
// FolderShelf (FAVORITES/RECENTS macros) at the rail's foot. Collapsed
// it thins to a rail; the body stays MOUNTED (hidden) so the one-mount law
// holds and delivery focus-root events still land in the tree. LINE & CYCLE:
// cham chamfers, var(--token) only, --font-data labels, monochrome at rest.

import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react';
import './ExplorerPanel.css';
import { FocusContext } from './use-desk-focus.js';
import { focusLabel, focusRootsOf } from './desk-focus.js';
import { FolderOpenFlow } from './FolderOpenFlow.jsx';
import { FolderShelf } from './FolderShelf.jsx';
import { filesApp } from './files/FilesApp.jsx';
import { gitStatus } from '../../services/user-files.js';
import { createTrailingBatch } from '../../utils/trailing-batch.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, clampPanelWidth } from '../windowing/window-storage.js';
import { divergenceLabel, repoState } from './files/git-status-view.js';

// The hosted FILES surface — the same Body the registry names (D6: no fork).
const FilesSurface = filesApp.Body;

const RailGlyph = ({ open }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
    {open ? <path d="M7 1 L3 5 L7 9 Z" /> : <path d="M3 1 L7 5 L3 9 Z" />}
  </svg>
);

const ExplorerPanelView = ({ collapsed, onToggle, width = PANEL_WIDTH_DEFAULT, onWidth }) => {
  const focusLens = useContext(FocusContext);
  const focus = focusLens?.focus ?? null;
  const label = focusLabel(focus);
  const focusRoots = focusRootsOf(focus, []);

  // THE RESIZE. The rail's width is the operator's, not the design's — a
  // fixed 300px is a guess about someone else's monitor, their font size, and
  // how deep their tree is nested.
  //
  // Live during the drag (a resize you cannot see while doing it is a guess),
  // persisted only on release: the width goes through localStorage, and
  // writing on every pointermove would be dozens of writes per gesture.
  const asideRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const onGripDown = useCallback((e) => {
    if (e.button !== 0) return; // left drag only; right-click belongs to the menu
    e.preventDefault();
    const el = e.currentTarget;
    // The rail is anchored at the window's left edge, so the width IS the
    // pointer's distance from that edge — no start-offset bookkeeping, and it
    // stays correct even if the gesture outruns the pointer.
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    let latest = clampPanelWidth(width);
    setDragging(true);
    el.setPointerCapture?.(e.pointerId);

    const move = (ev) => {
      latest = clampPanelWidth(ev.clientX - left);
      // Paint straight onto the node during the drag: React state here would
      // re-render the whole desk on every pointermove.
      if (asideRef.current) asideRef.current.style.setProperty('--xp-width', `${latest}px`);
    };
    const up = () => {
      el.releasePointerCapture?.(e.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragging(false);
      onWidth?.(latest); // the one write, on release
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up); // a cancelled gesture still settles
  }, [width, onWidth]);

  const onGripKey = useCallback((e) => {
    const step = e.shiftKey ? 50 : 10;
    const at = clampPanelWidth(width);
    const next = {
      ArrowLeft: at - step,
      ArrowRight: at + step,
      Home: PANEL_WIDTH_MIN,
      End: PANEL_WIDTH_MAX,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onWidth?.(clampPanelWidth(next));
  }, [width, onWidth]);

  const [picking, setPicking] = useState(false);
  const [openNote, setOpenNote] = useState('');
  // The focus repo's live truth: branch, divergence, and the STATE the
  // focus name wears (clean = green, dirty = amber, conflicted = red —
  // witness law). The path is only a HINT — the server contains it against
  // the open roots (D3); a refusal or error degrades to no color.
  const focusPath = focus?.kind === 'folder' ? focus.path : null;
  const [liveGit, setLiveGit] = useState(null); // { branch, ahead, behind, state } | null

  const gitPathRef = useRef(focusPath);
  gitPathRef.current = focusPath;
  const probeGit = useCallback(() => {
    const path = gitPathRef.current;
    if (!path) return;
    gitStatus(path)
      .then((r) => {
        if (gitPathRef.current === path && r?.isRepo) {
          setLiveGit({ branch: r.branch ?? null, ahead: r.ahead ?? 0, behind: r.behind ?? 0, state: repoState(r.files) });
        }
      })
      .catch(() => { /* outside the open roots or unreadable — no badge */ });
  }, []);
  useEffect(() => { setLiveGit(null); }, [focusPath]);
  // A calm poll catches what the terminal did — only while the badges are
  // seen (the rail shows none; use-visible-interval.js), probing at once on a
  // new path or on return.
  useVisibleInterval(probeGit, 30000, { enabled: Boolean(focusPath) && !collapsed, key: focusPath });
  useEffect(() => {
    if (!focusPath) return undefined;
    // Editor saves tell us directly. The bus can fire dozens a second under
    // real churn and the probe is a METERED call, so a burst folds to one
    // probe per quiet window instead of one per event (the Explorer 429
    // storm, live 2026-08-27).
    const batch = createTrailingBatch(() => { probeGit(); });
    const onChanged = () => batch.push(null);
    window.addEventListener('neuma:files-changed', onChanged);
    return () => {
      window.removeEventListener('neuma:files-changed', onChanged);
      batch.cancel();
    };
  }, [focusPath, probeGit]);

  // A root was registered (delivery, open-folder gesture) and wants to be in
  // front of the witness — a collapsed rail opens so the tree (which already
  // expands the root) shows. The window's FOCUS is never touched here: moving
  // the lens uninvited is exactly the silent refocus D9 forbids.
  useEffect(() => {
    if (!collapsed) return undefined;
    const onFocusRoot = () => onToggle?.();
    window.addEventListener('neuma:files-focus-root', onFocusRoot);
    return () => window.removeEventListener('neuma:files-focus-root', onFocusRoot);
  }, [collapsed, onToggle]);

  const branch = liveGit?.branch ?? null;
  const divergence = divergenceLabel(liveGit?.ahead ?? 0, liveGit?.behind ?? 0);
  // The focus name wears the repo's state (clean/dirty/conflicted); a
  // non-repo focus stays uncolored.
  const state = liveGit?.state ?? null;

  return (
    <aside
      className={`xp${collapsed ? ' is-collapsed' : ''}${dragging ? ' is-resizing' : ''}`}
      ref={asideRef}
      aria-label="Explorer panel"
      // The collapsed rail is a fixed 34px affordance, not a sized panel — its
      // width is the CSS's to state, so the custom property is withheld there.
      style={collapsed ? undefined : { '--xp-width': `${clampPanelWidth(width)}px` }}
    >
      <FolderOpenFlow
        open={picking}
        onDone={(opened, message) => { setPicking(false); setOpenNote(opened ? '' : (message || '')); }}
      />

      {collapsed ? (
        <button type="button" className="xp-expand" onClick={onToggle} title="Expand explorer" aria-expanded="false">
          <RailGlyph open={false} />
          <span className="xp-expand-word">EXPLORER</span>
        </button>
      ) : (
        <div className="xp-head cham">
          <div className="xp-head-in cham-in">
            <div className="xp-titlerow">
              <span className="xp-title">EXPLORER</span>
              <button type="button" className="xp-collapse" onClick={onToggle} title="Collapse explorer" aria-label="Collapse explorer" aria-expanded="true">
                <RailGlyph open />
              </button>
            </div>

            <div className="xp-focus">
              {label?.kind === 'folder' ? (
                <>
                  <span className="xp-kind label-data">FOLDER</span>
                  <span className={`xp-name${state ? ` is-${state}` : ''}`} title={label.folder.name}>{label.folder.name}</span>
                  {branch ? <span className="xp-sub label-data">{branch}{divergence ? ` · ${divergence}` : ''}</span> : null}
                </>
              ) : (
                <span className="xp-none label-data">CHOOSE A FOLDER</span>
              )}
            </div>

            <button type="button" className="xp-open" onClick={() => setPicking(true)}>OPEN FOLDER…</button>

            {openNote ? <p className="xp-note label-data">{openNote}</p> : null}
          </div>
        </div>
      )}

      <div className="xp-body">
        <FilesSurface focusRoots={focusRoots} />
      </div>

      <FolderShelf />

      {/* THE GRIP — drag the rail's edge to size it (Design note, 2026-07-30: […]). Pointer capture, so a fast drag that
          leaves the 6px strip keeps resizing instead of dropping the gesture.
          Also a real separator for the keyboard: arrows nudge, Home/End take
          the bounds, and double-click returns it to the default — the grip is
          two pixels wide, which is a poor target for anyone who is not using
          a mouse well. */}
      {collapsed ? null : (
        <div
          className="xp-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize explorer"
          aria-valuenow={clampPanelWidth(width)}
          aria-valuemin={PANEL_WIDTH_MIN}
          aria-valuemax={PANEL_WIDTH_MAX}
          tabIndex={0}
          onPointerDown={onGripDown}
          onDoubleClick={() => onWidth?.(PANEL_WIDTH_DEFAULT)}
          onKeyDown={onGripKey}
          title="Drag to resize — double-click to reset"
        />
      )}
    </aside>
  );
};

// Behind a memo boundary: the desk host re-renders every streamed frame
// (2026-09-28 smoothness pass); this re-renders only when its own inputs do.
export const ExplorerPanel = memo(ExplorerPanelView);
