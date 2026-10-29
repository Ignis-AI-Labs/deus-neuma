// use-notifications.js — the tray's one subscription to the portal.
//
// impure hook: owns the socket, the clock, the browser's visibility state, and
// the Electron bridge. Every decision it makes is delegated to a pure module —
// the reducer for state, shouldRaise/shouldNotifyOS for suppression,
// notificationTarget for routing — so the only thing that cannot be tested
// headlessly is the three-line OS-notification call itself.
//
// Teardown is symmetric and exact. `WebSocketService.off` splices by function
// identity, so every handler is a named const registered once and removed once;
// an inline arrow would never detach. Both live bugs in that file (#112, #109)
// were unsubscribe-discipline failures, and a leaked listener here does not
// look like a leak — it looks like the tray showing the same card twice.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { notificationReducer, initialNotifications } from './NotificationTray/notification-reducer.js';
import { shouldRaise, shouldNotifyOS } from './NotificationTray/notification-suppression.js';
import { notificationTarget } from './NotificationTray/notification-target.js';
import { KIND } from '../../../core/runtime/notification-record.js';
// The SAME pure text helper the transcript used, reused verbatim rather than
// reworded — the warning's wording is already tested and already right.
import { storageWarningText } from './storage-warning.js';
import { isOsNoticeOn } from '../../services/os-notice.js';

/**
 * The reload offer is a DEV-LANE card, and the gate is compile-time.
 *
 * `vite build` substitutes `import.meta.env.DEV` with the literal `false` and
 * the minifier then drops the branch — including its strings — from the bundle
 * entirely. Electron always loads the built `dist/` and spawns its backend with
 * NODE_ENV=production and no watcher, so the card could never be honest there:
 * it would offer to reload a page whose backend nobody is editing.
 *
 * ⚠ WRITE IT EXACTLY LIKE THIS. `import.meta.env?.DEV` — with optional chaining
 * — is NOT statically replaced, the branch survives minification, and the card
 * ships to every packaged install. Verified by grepping `dist/` for the card's
 * own text after a build; that grep is the only thing that proves the gate, and
 * this repo had no prior use of `import.meta.env` to copy from.
 */
const RELOAD_CARD_ENABLED = import.meta.env.DEV;

export const useNotifications = (wsService) => {
  const [state, dispatch] = useReducer(notificationReducer, initialNotifications);

  // THIS WINDOW'S SITUATION, as a ref rather than state.
  //
  // Three sources feed it and none of them should re-render the tray: the
  // shell's binding (below), the browser's visibility, and which desk app is
  // frontmost (written by the tray, which is the only component inside the
  // window manager). Suppression reads it at the instant a frame lands, so a
  // stale render would be worse than no memoisation.
  const viewerRef = useRef({
    documentVisible: true,
    frontmostAppId: null,
    activeSessionId: null,
    activeNeumaId: null,
  });

  // The binding comes from the socket's own session state rather than a prop.
  // `setSessionState` emits `session:state` at the moment the binding MOVES —
  // a being switch, a resume, a fresh mint — which is exactly when suppression's
  // answer changes. Reading it from the source means the tray cannot drift from
  // what the portal actually holds.
  useEffect(() => {
    if (!wsService) return undefined;
    const apply = (session) => {
      viewerRef.current.activeSessionId = session?.sessionId ?? null;
      viewerRef.current.activeNeumaId = session?.neumaId ?? null;
    };
    apply(wsService.getSessionState?.());
    wsService.on('session:state', apply);
    return () => wsService.off('session:state', apply);
  }, [wsService]);

  // Is this document actually on screen? Covers the tab being backgrounded and,
  // in Electron, the desk being hidden to the tray — which `close` does rather
  // than destroying the window, so it is the COMMON state, not a rare one.
  useEffect(() => {
    const read = () => {
      viewerRef.current.documentVisible = document.visibilityState === 'visible' && document.hasFocus();
    };
    read();
    document.addEventListener('visibilitychange', read);
    window.addEventListener('focus', read);
    window.addEventListener('blur', read);
    return () => {
      document.removeEventListener('visibilitychange', read);
      window.removeEventListener('focus', read);
      window.removeEventListener('blur', read);
    };
  }, []);

  const setFrontmostApp = useCallback((appId) => {
    viewerRef.current.frontmostAppId = appId ?? null;
  }, []);

  // The boot id this window first saw. A CHANGE means the backend restarted
  // under us and this page may be running against different code.
  const bootIdRef = useRef(null);
  // Cards this window has already raised an OS notification for, so a reconnect
  // that re-delivers cannot fire a second popup for the same event.
  const notifiedRef = useRef(new Set());
  // Ids read locally but not yet acknowledged — batched so clearing a full tray
  // is one frame, not one per card (the inbound window is 30 frames/60s).
  const pendingReadRef = useRef(new Set());
  // Ids dismissed locally, batched the same way (one frame for a whole CLEAR).
  const pendingDismissRef = useRef(new Set());
  const flushTimerRef = useRef(null);

  const flushReads = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const dismissed = [...pendingDismissRef.current];
    pendingDismissRef.current.clear();
    const ids = [...pendingReadRef.current].filter((id) => !dismissed.includes(id));
    pendingReadRef.current.clear();
    if (!wsService) return;
    if (ids.length) wsService.send('notification:read', { ids });
    if (dismissed.length) wsService.send('notification:read', { ids: dismissed, dismiss: true });
  }, [wsService]);

  const queueRead = useCallback((ids) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string' && id);
    if (list.length === 0) return;
    // Optimistic locally so the badge responds to the click, authoritative from
    // the server frame — the same fold either way, so the two cannot diverge.
    dispatch({ type: 'MARK_READ', ids: list });
    for (const id of list) pendingReadRef.current.add(id);
    if (flushTimerRef.current === null) {
      flushTimerRef.current = setTimeout(flushReads, 250);
    }
  }, [flushReads]);

  // The ×, and CLEAR for every card: out of the tray here at once, and out of
  // every desk and every later hydrate once the server has written it down.
  const queueDismiss = useCallback((ids) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string' && id);
    if (list.length === 0) return;
    dispatch({ type: 'DISMISS', ids: list });
    for (const id of list) pendingDismissRef.current.add(id);
    if (flushTimerRef.current === null) {
      flushTimerRef.current = setTimeout(flushReads, 250);
    }
  }, [flushReads]);

  useEffect(() => {
    if (!wsService) return undefined;

    const onHydrate = (frame) => {
      dispatch({ type: 'HYDRATE', records: frame?.records ?? [] });
    };

    const onNew = (frame) => {
      const record = frame?.record;
      if (!record) return;
      dispatch({ type: 'RECEIVE', record });

      const viewer = viewerRef.current;
      if (!shouldRaise(record, viewer)) {
        // Seen, not shown. It stays in the account and is marked read so the
        // operator's other desks agree it needs no attention.
        queueRead([record.id]);
        return;
      }

      // DESKTOP ALERTS (the tray's switch, os-notice.js) governs every OS notice.
      if (shouldNotifyOS(record, viewer) && isOsNoticeOn() && !notifiedRef.current.has(record.id)) {
        notifiedRef.current.add(record.id);
        const target = notificationTarget(record);
        // Feature-probe rather than an isElectron check: a partial bridge is a
        // real state, and the browser lane simply has no OS leg.
        window.neuma?.notifications?.notify?.({
          id: record.id,
          // Metadata only. The record's own text is already capped and carries
          // no being speech, but the OS notification centre persists and may
          // sync, so what leaves the app stays deliberately thin.
          title: record.actor?.name ? `${record.actor.name}` : 'NEUMA',
          body: record.title,
          appId: target?.appId ?? null,
        });
      }
    };

    // A sibling desk marked something read. Fold it exactly like a local click.
    const onRead = (frame) => {
      dispatch({ type: 'MARK_READ', ids: frame?.ids ?? [] });
    };
    // A sibling desk dismissed something. Fold it exactly like a local press.
    const onDismissed = (frame) => {
      dispatch({ type: 'DISMISS', ids: frame?.ids ?? [] });
    };

    // THE DISK. Deliberately NOT routed through the notification bus.
    //
    // This warning used to land in the chat transcript, where it read as though
    // the being had said it. Moving it here is a correction — but it is also a
    // SAFETY path, and the bus can be switched off wholesale by an operator who
    // decides notifications are too noisy. If the warning rode the bus, that
    // switch would silently take the low-disk alarm with it, right after this
    // change removed its only other surface.
    //
    // So it is synthesised client-side from the frame the backend already
    // broadcasts. It needs no durability either: the heartbeat re-emits while
    // the disk is still full, so a restart re-raises it on its own. A stable id
    // per level means a repeat replaces the card rather than stacking.
    const onStorage = (frame) => {
      const level = frame?.level;
      if (level !== 'low' && level !== 'critical') return;
      dispatch({
        type: 'RECEIVE',
        record: {
          v: 1,
          id: `storage-${level}`,
          ts: Date.now(),
          kind: KIND.storageWarning,
          standing: 'system',
          title: storageWarningText(frame),
          detail: null,
          actor: null,
          ref: { level },
          read: false,
        },
      });
    };

    const onEstablished = (frame) => {
      const seen = frame?.bootId;
      // Diff ONLY when both sides are defined strings. An older backend sends no
      // bootId; storing `undefined` as the baseline would make the first frame
      // that DOES carry one read as "the code changed" and fire a false reload
      // offer on the operator's very first connection.
      if (typeof seen !== 'string' || seen === '') return;
      if (bootIdRef.current === null) {
        bootIdRef.current = seen;
        return;
      }
      if (bootIdRef.current === seen) return;
      bootIdRef.current = seen;
      if (!RELOAD_CARD_ENABLED) return;
      dispatch({
        type: 'RECEIVE',
        record: {
          v: 1,
          // Stable id: one reload offer, replaced rather than stacked, however
          // many times the backend restarts during an editing burst.
          id: 'code-reload',
          ts: Date.now(),
          kind: KIND.codeReload,
          standing: 'system',
          title: 'New code — reload to pick it up',
          detail: 'The backend restarted under this window.',
          actor: null,
          ref: {},
          read: false,
        },
      });
    };

    wsService.on('notification:hydrate', onHydrate);
    wsService.on('notification:new', onNew);
    wsService.on('notification:read', onRead);
    wsService.on('notification:dismissed', onDismissed);
    wsService.on('portal:established', onEstablished);
    wsService.on('storage:warning', onStorage);
    return () => {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      wsService.off('notification:hydrate', onHydrate);
      wsService.off('notification:new', onNew);
      wsService.off('notification:read', onRead);
      wsService.off('notification:dismissed', onDismissed);
      wsService.off('portal:established', onEstablished);
      wsService.off('storage:warning', onStorage);
    };
  }, [wsService, queueRead]);

  const markRead = useCallback((id) => queueRead([id]), [queueRead]);
  const markAllRead = useCallback(() => {
    const unreadIds = state.records.filter((rec) => !rec.read).map((rec) => rec.id);
    dispatch({ type: 'MARK_ALL_READ' });
    queueRead(unreadIds);
  }, [state.records, queueRead]);
  const dismiss = useCallback((id) => queueDismiss([id]), [queueDismiss]);
  const clear = useCallback(() => queueDismiss(state.records.map((rec) => rec.id)), [state.records, queueDismiss]);

  return useMemo(() => ({
    records: state.records,
    unread: state.unread,
    hydrated: state.hydrated,
    markRead,
    markAllRead,
    dismiss,
    clear,
    setFrontmostApp,
    targetFor: notificationTarget,
  }), [state.records, state.unread, state.hydrated, markRead, markAllRead, dismiss, clear, setFrontmostApp]);
};
