// FloatingWindow — a reusable draggable / resizable / snappable window.
//
// The platform's window primitive: every floating surface (chat, vessel,
// future config/social) wraps its content here to get free drag, 8-way
// resize, edge/corner snapping, maximize, minimize (an in-place window-shade
// that swallows the body and leaves the tab head), close (severs and removes
// it), focus/raise, persisted layout, and the Raphael entrance/exit
// choreography. The window manager supplies focus/z + the focus/close
// handlers; geometry is owned by useWindowFrame; collapse is local.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import './FloatingWindow.css';
import { useWindowFrame } from './use-window-frame.js';
import { subscribeFrames, isFrameOccluded } from './frame-registry.js';
import { SnapOverlay } from './SnapOverlay.jsx';
import { WindowShownContext } from './window-shown.js';
import { uiSound } from '../../services/ui-sound.js';

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const EXIT_MS = 400; // matches the close (sever) animation in FloatingWindow.css

const stop = (e) => e.stopPropagation();

const Svg = ({ children }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
    {children}
  </svg>
);
const MinIcon = () => <Svg><line x1="2.5" y1="9" x2="9.5" y2="9" /></Svg>;
const CloseIcon = () => <Svg><line x1="2.5" y1="2.5" x2="9.5" y2="9.5" /><line x1="9.5" y1="2.5" x2="2.5" y2="9.5" /></Svg>;
const MaxIcon = ({ maxed }) =>
  maxed ? (
    <Svg><rect x="1.5" y="3.5" width="7" height="7" /><path d="M3.5 3.5 V1.5 H10.5 V8.5 H8.5" /></Svg>
  ) : (
    <Svg><rect x="1.5" y="1.5" width="9" height="9" /></Svg>
  );

export const FloatingWindow = ({
  storageKey,
  title,
  controls,
  focused = false,
  restoreKey,
  z,
  onFocus,
  onClose,
  children,
}) => {
  const { t } = useTranslation('desk');
  // Window-shade: minimize swallows the body and leaves the tab head, in
  // place. Local to the window — the manager keeps the window open. The
  // section height animates only during the toggle (is-shading), so resize
  // stays instant.
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const [shading, setShading] = useState(false);
  const barRef = useRef(null);
  const [headerH, setHeaderH] = useState(40);
  useLayoutEffect(() => {
    if (barRef.current) setHeaderH(barRef.current.offsetHeight + 2); // + cham hairline
  }, []);
  const toggleCollapse = () => {
    uiSound('toggle');
    setShading(true);
    setCollapsed((c) => !c);
    window.setTimeout(() => setShading(false), 320);
  };
  // The taskbar raised this window on its turn (FOCUS with `restore`): a
  // shaded window opens, the same shading it would take from its own button.
  // A stamp, never a boolean — each ask is a fresh number, so a second click
  // on a window shaded again since the first still answers.
  useEffect(() => {
    if (restoreKey === undefined || !collapsedRef.current) return undefined;
    setShading(true);
    setCollapsed(false);
    const id = window.setTimeout(() => setShading(false), 320);
    return () => window.clearTimeout(id);
  }, [restoreKey]);
  const onToggleMax = () => {
    uiSound('toggle');
    toggleMax();
  };

  // The line of light lives only while it animates. Left in the tree at rest
  // (transparent, glowing), focus swapping the window's drop-shadow filter
  // re-rastered it into a hairline across the window (ruling, 2026-09-26). The
  // entrance ends it; the close mounts it again for the sever.
  const [lit, setLit] = useState(true);

  // Close choreography: play the sever, THEN tell the manager to remove the
  // window (a React unmount can't animate itself).
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onClose?.(), EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving, onClose]);

  // z and targetability feed the frame registry: a shaded or departing
  // window is never offered as a split target (its body isn't there to
  // divide); z decides which sibling a drop divides when frames overlap.
  const { rect, maxed, dragging, bounds, preview, startDrag, startResize, toggleMax } =
    useWindowFrame(storageKey, { z, targetable: !collapsed && !leaving });
  const occluded = useSyncExternalStore(subscribeFrames, () => isFrameOccluded(storageKey));

  return (
    <>
      {dragging ? <SnapOverlay bounds={bounds} active={preview} /> : null}

      <section
        className={`fwin${dragging ? ' is-dragging' : ''}${occluded ? ' is-occluded' : ''}${focused ? ' is-focused' : ''}${shading ? ' is-shading' : ''}${collapsed ? ' is-collapsed' : ''}${leaving ? ' is-leaving is-closing' : ''}`}
        style={{
          transform: `translate(${rect.x}px, ${rect.y}px)`,
          width: `${rect.w}px`,
          height: collapsed ? `${headerH}px` : `${rect.h}px`,
          zIndex: z,
        }}
        onPointerDownCapture={onFocus}
      >
        {lit || leaving ? <span className="fwin-light" aria-hidden="true" onAnimationEnd={() => setLit(false)} /> : null}
        <span className="fwin-brackets" aria-hidden="true" />
        {/* one shadow on the desk — the focused window's, and never a full-size one's */}
        {focused && !maxed ? <span className="fwin-shadow" aria-hidden="true"><span className="fwin-shadow-shape cham" /></span> : null}

        <div className="fwin-frame cham">
          <div className="fwin-inner cham-in">
            <header ref={barRef} className="fwin-bar" onPointerDown={startDrag} onDoubleClick={onToggleMax}>
              <div className="fwin-bar-title">{title}</div>
              <div className="fwin-bar-controls" onPointerDown={stop} onDoubleClick={stop}>
                {controls}
                <button
                  type="button"
                  className="fwin-ctl"
                  onClick={toggleCollapse}
                  aria-label={collapsed ? t('chrome.expand') : t('chrome.minimize')}
                  aria-pressed={collapsed}
                >
                  <MinIcon />
                </button>
                <button
                  type="button"
                  className="fwin-ctl"
                  onClick={onToggleMax}
                  aria-label={maxed ? t('chrome.restore') : t('chrome.maximize')}
                >
                  <MaxIcon maxed={maxed} />
                </button>
                {onClose ? (
                  <button type="button" className="fwin-ctl fwin-ctl-close" onClick={() => { uiSound('close'); setLeaving(true); }} aria-label={t('chrome.close')}>
                    <CloseIcon />
                  </button>
                ) : null}
              </div>
            </header>
            <div className="fwin-body">
              <WindowShownContext.Provider value={!collapsed}>{children}</WindowShownContext.Provider>
            </div>
          </div>
        </div>

        {maxed || collapsed
          ? null
          : EDGES.map((edge) => (
              <span
                key={edge}
                className={`fwin-rz fwin-rz-${edge}`}
                onPointerDown={startResize(edge)}
              />
            ))}
      </section>
    </>
  );
};
