// Dock — THE TASKBAR at the desk's edge (Design note, 2026-10-05: […]). Ledger: docs/work/os-taskbar-launcher.md.
//
//   ⊞ launcher │ pinned apps │ open, not pinned │ … │ tray: SUBSTRATE · WALLET · clock
//
// The launcher (Launcher.jsx, ⊞ or Ctrl+Space) holds every app, by category,
// with search. The pinned set, its order, names on/off and the bar's edge are
// the person's own (taskbar-model.js prefs, taskbar-storage.js per wallet):
// right-click an app to pin / unpin / open another / close it; right-click the
// bar for names and position; drag a pinned app along the bar to reorder it.
// The rules are pure in taskbar-model.js; this file is the view and its hands.
//
// The component keeps its name (Dock) and props so the desk shell is unchanged.

import './Dock.css';
import './Taskbar.css';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindows } from './use-windows.js';
import { appIdOf } from './window-manager-reducer.js';
import { clickTarget, instanceRows, listPlace } from './instance-cycle.js';
import { useHoverIntent } from './use-hover-intent.js';
import { DockInstances } from './DockInstances.jsx';
import { setBarEdge } from './use-window-frame.js';
import { BAR_EDGES, TRAY_APPS, barItems, movePin, normalizePrefs, togglePin } from './taskbar-model.js';
import { loadTaskbarPrefs, saveTaskbarPrefs } from './taskbar-storage.js';
import { Launcher } from './Launcher.jsx';
import { playSound } from '../../services/sound-engine.js';
import { disconnectSession } from '../../services/session.js';
import { DepartureVeil } from '../RelinkShell/DepartureVeil.jsx';
import { BrandMark } from '../RelinkShell/brand-marks.jsx';
import { MARKETING_PLATFORMS, MARKETING_WINDOW, PLATFORM_LABELS } from './retired-windows.js';

const PLATFORM_ENTRIES = MARKETING_PLATFORMS.map((id) => [id, Object.freeze({
  label: PLATFORM_LABELS[id], icon: <BrandMark id={id} />, keywords: ['marketing', 'social', 'platform'],
})]);

const LauncherGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
    <rect x="1" y="1" width="5" height="5" />
    <rect x="8" y="1" width="5" height="5" />
    <rect x="1" y="8" width="5" height="5" />
    <rect x="8" y="8" width="5" height="5" />
  </svg>
);

// A context menu opens toward the room it has: up from a point in the lower
// half, left from one near the right edge. Pure.
const menuPlace = ({ x, y }) => ({
  left: Math.max(8, Math.min(x + 4, window.innerWidth - 260)),
  ...(y > window.innerHeight / 2 ? { bottom: window.innerHeight - y + 6 } : { top: y + 6 }),
});

const clockOf = (d) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const DockView = ({ panelState = null, onPanelToggle = null }) => {
  const { registry, state, dispatch } = useWindows();
  const { t } = useTranslation('taskbar');
  const { t: tDesk } = useTranslation('desk');

  // Every app a person can launch, its label in their language. launcher:false
  // apps are born from elsewhere (the editor from the FILES tree) — never here.
  // Each public platform is a tile too, though its window is MARKETING's now: OPEN of its id lands MARKETING on
  // it (WindowManager.jsx redirectAction), so TikTok, X and the rest are always one press away, and pinnable.
  const entries = useMemo(() => [
    ...Object.entries(registry)
      .filter(([, app]) => app.launcher !== false)
      .map(([id, app]) => [id, app.labelKey ? { ...app, label: tDesk(app.labelKey) } : app]),
    ...(registry[MARKETING_WINDOW] ? PLATFORM_ENTRIES : []),
  ], [registry, tDesk]);
  const ids = useMemo(() => entries.map(([id]) => id), [entries]);
  const byId = useMemo(() => new Map(entries), [entries]);

  const [prefs, setPrefs] = useState(() => normalizePrefs(loadTaskbarPrefs(), ids));
  const [launcher, setLauncher] = useState(false);
  const [menu, setMenu] = useState(null); // { kind: 'app'|'bar', id?, x, y }
  const [dragId, setDragId] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [departing, setDeparting] = useState(false);
  const navRef = useRef(null);
  const hover = useHoverIntent();

  // The person's prefs: saved on change; the bar's edge moves the desk's bounds.
  useEffect(() => { saveTaskbarPrefs(prefs); }, [prefs]);
  useEffect(() => {
    setBarEdge(prefs.edge);
    document.documentElement.dataset.taskbarEdge = prefs.edge;
  }, [prefs.edge]);

  // The tray clock — minutes, so a half-minute tick is plenty.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Windows think in instances (terminal#2), the bar in apps.
  const openAppIds = state.windows.map((w) => appIdOf(w.id));
  const focusedAppId = state.focusedId === null ? null : appIdOf(state.focusedId);
  const stateOf = (id) => {
    if (registry[id]?.panel) return panelState?.[id] ? 'open' : 'closed';
    if (!openAppIds.includes(id)) return 'closed';
    return focusedAppId === id ? 'focused' : 'open';
  };
  const countOf = (id) => openAppIds.filter((a) => a === id).length;

  const closeAll = () => { setLauncher(false); setMenu(null); hover.hide(); };

  // Open-or-raise: a panel app (FILES) toggles the desk's rail; a multi-window
  // app steps through its windows, one per click (instance-cycle.js — Founder,
  // 2026-10-23: […]), restoring a minimized one
  // when its turn comes; anything else opens or raises its one window.
  const raiseOrOpen = (id) => {
    if (registry[id]?.panel) { onPanelToggle?.(id); return; }
    const next = registry[id]?.multiInstance ? clickTarget(state.windows, state.focusedId, id) : null;
    dispatch(next ? { type: 'FOCUS', id: next.id, restore: next.restore } : { type: 'OPEN', id });
  };

  // THE HOVER LIST: a multi-window app's button, with two or more open, lists
  // them in a drop-up on a rested pointer or on keyboard focus. Never while the
  // launcher, a menu or a drag has the bar.
  const listable = (id) => Boolean(registry[id]?.multiInstance) && countOf(id) > 1 && !launcher && !menu && !dragId;
  const placeFor = (el) => listPlace(prefs.edge, el.getBoundingClientRect(), navRef.current.getBoundingClientRect());
  const inList = (node) => Boolean(node && navRef.current?.querySelector('.taskbar-instances')?.contains(node));
  const listButton = (id) => navRef.current?.querySelector(`.taskbar-app[data-app-id="${id}"]`);
  const hoverBind = (id) => ({
    onPointerEnter: (e) => { if (e.pointerType !== 'touch' && listable(id)) hover.enter(id, placeFor(e.currentTarget)); },
    onPointerLeave: hover.leave,
    onFocus: (e) => { if (e.currentTarget.matches(':focus-visible') && listable(id)) hover.show(id, placeFor(e.currentTarget)); },
    onBlur: (e) => { if (hover.open?.id === id && !inList(e.relatedTarget)) hover.hide(); },
    // Into the list from the button: the arrow that points at it.
    onKeyDown: (e) => {
      const into = { bottom: 'ArrowUp', top: 'ArrowDown', left: 'ArrowRight' }[prefs.edge];
      if (e.key !== into || hover.open?.id !== id) return;
      e.preventDefault();
      const list = navRef.current?.querySelector('.taskbar-instances');
      (list?.querySelector('.dock-menu-item.is-focused') || list?.querySelector('.dock-menu-item'))?.focus();
    },
  });
  const pickInstance = (windowId) => {
    playSound('menuClose');
    dispatch({ type: 'FOCUS', id: windowId, restore: true });
    hover.hide();
  };
  const open = (id) => {
    playSound(stateOf(id) === 'closed' ? 'menuOpen' : 'menuClose');
    raiseOrOpen(id);
    // An open hover list STAYS: its focused mark moving to the window this
    // click raised is the click's answer, read where the eye already is.
    setLauncher(false);
    setMenu(null);
  };

  const toggleLauncher = () => {
    playSound(launcher ? 'menuClose' : 'menuOpen');
    setMenu(null);
    hover.hide();
    setLauncher((v) => !v);
  };

  // Ctrl+Space opens the launcher from anywhere; a click outside or Escape closes
  // whatever the bar has open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' && e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); toggleLauncher(); }
      else if (e.key === 'Escape' && (launcher || menu || hover.open)) closeAll();
    };
    const onDown = (e) => { if ((launcher || menu) && navRef.current && !navRef.current.contains(e.target)) closeAll(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  });

  const openMenu = (kind, id, e) => {
    e.preventDefault();
    e.stopPropagation();
    playSound('menuOpen');
    hover.hide();
    setMenu({ kind, id, x: e.clientX, y: e.clientY });
  };

  const setPref = (next) => { playSound('menuClose'); setPrefs(next); setMenu(null); };

  const closeApp = (id) => {
    for (const w of state.windows.filter((x) => appIdOf(x.id) === id)) {
      registry[id]?.onClose?.(w.id);
      dispatch({ type: 'CLOSE', id: w.id });
    }
    setMenu(null);
  };

  // Spawn a sibling desk on this session (the desktop shell only).
  const newDesk = window.neuma?.desk ? () => {
    playSound('menuOpen');
    closeAll();
    window.neuma.desk.open().catch(() => { /* main shows its own error dialog */ });
  } : null;

  // Leave for the gateway, on one calm frame first (the DepartureVeil).
  const disconnect = () => {
    playSound('menuClose');
    closeAll();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      disconnectSession().catch(() => { /* never rejects — teardown is guarded */ });
      return;
    }
    setDeparting(true);
    setTimeout(() => { disconnectSession().catch(() => { /* never rejects */ }); }, 1200);
  };

  // Drag a pinned app along the bar to reorder it.
  const onDragOver = (e, to) => {
    if (!dragId || dragId === to) return;
    e.preventDefault();
    const at = prefs.pins.filter((p) => p !== dragId).indexOf(to);
    const rect = e.currentTarget.getBoundingClientRect();
    const after = prefs.edge === 'left' ? e.clientY > rect.top + rect.height / 2 : e.clientX > rect.left + rect.width / 2;
    setPrefs((p) => movePin(p, dragId, at + (after ? 1 : 0)));
  };

  const { pinned, running } = barItems(prefs, openAppIds.filter((id) => byId.has(id)));

  const appButton = (id, isPinned) => {
    const app = byId.get(id);
    if (!app) return null;
    const s = stateOf(id);
    const n = countOf(id);
    return (
      <button
        key={id}
        type="button"
        className={`taskbar-app is-${s}${isPinned ? ' is-pinned' : ''}${dragId === id ? ' is-dragging' : ''}`}
        data-app-id={id}
        onClick={() => open(id)}
        onContextMenu={(e) => openMenu('app', id, e)}
        draggable={isPinned}
        onDragStart={isPinned ? (e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
        onDragOver={isPinned ? (e) => onDragOver(e, id) : undefined}
        onDragEnd={() => setDragId(null)}
        aria-pressed={s !== 'closed'}
        aria-haspopup={app.multiInstance ? 'menu' : undefined}
        aria-expanded={app.multiInstance ? hover.open?.id === id : undefined}
        title={app.label}
        {...(app.multiInstance ? hoverBind(id) : null)}
      >
        <span className="taskbar-app-icon">{app.icon}</span>
        {prefs.labels ? <span className="taskbar-app-label label-data">{app.label}</span> : null}
        {n > 1 ? <span className="taskbar-app-count label-data">{n}</span> : null}
        <span className="taskbar-app-dot" aria-hidden="true" />
      </button>
    );
  };

  const menuApp = menu?.kind === 'app' ? byId.get(menu.id) : null;
  const listApp = hover.open && listable(hover.open.id) ? byId.get(hover.open.id) : null;

  return (
    <nav
      ref={navRef}
      className={`taskbar edge-${prefs.edge}${prefs.labels ? ' with-names' : ''}`}
      aria-label={t('aria')}
    >
      {departing ? <DepartureVeil /> : null}
      {launcher ? (
        <Launcher
          entries={entries}
          stateOf={stateOf}
          pins={prefs.pins}
          onOpen={open}
          onMenu={(id, e) => openMenu('app', id, e)}
          onNewDesk={newDesk}
          onDisconnect={disconnect}
          onClose={closeAll}
        />
      ) : null}

      {listApp ? (
        <DockInstances
          app={listApp}
          rows={instanceRows(state.windows, state.focusedId, hover.open.id)}
          place={hover.open.place}
          onPick={pickInstance}
          onEnter={hover.keep}
          onLeave={hover.leave}
          onBlur={(e) => { if (!inList(e.relatedTarget) && e.relatedTarget !== listButton(hover.open.id)) hover.hide(); }}
          onEscape={() => { listButton(hover.open.id)?.focus(); hover.hide(); }}
        />
      ) : null}

      {menu ? (
        <div className="taskbar-menu dock-menu cham" role="menu" style={menuPlace(menu)}>
          <div className="dock-menu-in cham-in">
            {menuApp ? (
              <>
                <button type="button" className="dock-menu-item" role="menuitem" onClick={() => setPref(togglePin(prefs, menu.id))}>
                  <span className="dock-menu-label label-data">{prefs.pins.includes(menu.id) ? t('unpin') : t('pin')}</span>
                </button>
                {menuApp.multiInstance ? (
                  <button type="button" className="dock-menu-item" role="menuitem"
                    onClick={() => { playSound('menuOpen'); dispatch({ type: 'OPEN_NEW', appId: menu.id }); closeAll(); }}>
                    <span className="dock-menu-label label-data">{t('newInstance', { app: menuApp.label })}</span>
                  </button>
                ) : null}
                {countOf(menu.id) > 0 ? (
                  <button type="button" className="dock-menu-item" role="menuitem" onClick={() => closeApp(menu.id)}>
                    <span className="dock-menu-label label-data">{countOf(menu.id) > 1 ? t('closeAll', { app: menuApp.label }) : t('close')}</span>
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button type="button" className="dock-menu-item" role="menuitem" onClick={() => setPref({ ...prefs, labels: !prefs.labels })}>
                  <span className="dock-menu-label label-data">{prefs.labels ? t('iconsOnly') : t('showNames')}</span>
                </button>
                <span className="dock-menu-sep" aria-hidden="true" />
                <span className="taskbar-menu-head label-data">{t('position')}</span>
                {BAR_EDGES.map((edge) => (
                  <button key={edge} type="button" role="menuitemradio" aria-checked={prefs.edge === edge}
                    className={`dock-menu-item${prefs.edge === edge ? ' is-focused' : ''}`}
                    onClick={() => setPref({ ...prefs, edge })}>
                    <span className="dock-menu-label label-data">{t(`edges.${edge}`)}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="taskbar-bar cham" onContextMenu={(e) => openMenu('bar', null, e)}>
        <div className="taskbar-in cham-in">
          <button
            type="button"
            className={`taskbar-launcher${launcher ? ' is-open' : ''}`}
            onClick={toggleLauncher}
            aria-label={t('launcher')}
            aria-expanded={launcher}
            title={t('launcher')}
          >
            <LauncherGlyph />
          </button>
          <span className="taskbar-sep" aria-hidden="true" />
          <div className="taskbar-apps" role="toolbar" aria-label={t('pinned')}>
            {pinned.map((id) => appButton(id, true))}
            {running.length > 0 ? <span className="taskbar-sep" aria-hidden="true" /> : null}
            {running.map((id) => appButton(id, false))}
          </div>
          <span className="taskbar-fill" aria-hidden="true" />
          <div className="taskbar-tray" aria-label={t('tray')}>
            {TRAY_APPS.filter((id) => byId.has(id)).map((id) => appButton(id, false))}
            <time className="taskbar-clock label-data" dateTime={now.toISOString()}>{clockOf(now)}</time>
          </div>
        </div>
      </div>
    </nav>
  );
};

// Behind a memo boundary: the desk host re-renders every streamed frame
// (2026-09-28 smoothness pass); this re-renders only when its own inputs do.
export const Dock = memo(DockView);
