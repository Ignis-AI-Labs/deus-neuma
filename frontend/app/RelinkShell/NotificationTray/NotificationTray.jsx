// NotificationTray — the desk's bottom-right announcement lane.
//
// Design note, 2026-08-05: […]
//
// Two surfaces, one state: a bell carrying the unread count, and a panel of
// cards newest-first. Toasts are the same cards, shown briefly above the bell
// when they arrive — never a separate list, so nothing can appear in one and
// not the other.
//
// LINE & CYCLE: monochrome at rest, --signal marks live data, --alert marks a
// warning, «NOTICE» is the announcement register. No emoji anywhere.
//
// Every string that reaches the DOM does so as a React text child. There is no
// dangerouslySetInnerHTML in this file and none anywhere in frontend/ — a
// notification title is model-adjacent text and must never be parsed as markup.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import './NotificationTray.css';
import { useWindows } from '../../windowing/use-windows.js';
import { appIdOf } from '../../windowing/window-manager-reducer.js';
import { useNotifications } from '../notifications-context.js';
import { cardLanding, cardOpenActions, notificationTarget } from './notification-target.js';
import { requestHouseClockTab } from '../house-clock/house-clock-focus.js';
import { requestCardLanding } from '../card-landing.js';
import { KIND, STANDING } from '../../../../core/runtime/notification-record.js';

/** How long a toast stays up before it retires into the panel. */
const TOAST_MS = 6000;

const BellGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M3.5 5.5a3.5 3.5 0 0 1 7 0c0 3 1 4 1 4h-9s1-1 1-4Z" />
    <path d="M5.75 11.5a1.5 1.5 0 0 0 2.5 0" />
  </svg>
);

const CloseGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" />
  </svg>
);

/** Pure — the short label a card wears, by kind. */
const kindLabel = (kind) => {
  switch (kind) {
    case KIND.turnDone: return 'FINISHED';
    case KIND.turnInterrupted: return 'INTERRUPTED';
    case KIND.turnRefused: return 'DECLINED';
    case KIND.taskClosed: return 'TASK CLOSED';
    case KIND.assignmentClosed: return 'ASSIGNMENT CLOSED';
    case KIND.runDone: return 'RUN COMPLETE';
    case KIND.runCheckIn: return 'TEAM CHECK-IN';
    case KIND.runAlert: return '«NOTICE» TEAM RUN';
    case KIND.renderDone: return 'RENDER READY';
    case KIND.storageWarning: return '«NOTICE» STORAGE';
    case KIND.codeReload: return '«NOTICE» NEW CODE';
    case KIND.securityAlert: return '«WARNING» SECURITY';
    case KIND.legalAlert: return '«NOTICE» LEGAL';
    case KIND.benchAlert: return '«WARNING» BENCH';
    case KIND.benchDone: return 'BENCHMARK DONE';
    case KIND.awaitingAnswer: return 'AWAITS YOUR ANSWER';
    case KIND.houseWake: return '«NOTICE» HOUSE WAKE';
    default: return 'NOTICE';
  }
};

/** Pure — is this card a warning rather than news? */
const isAlert = (record) => record.kind === KIND.storageWarning
  || record.kind === KIND.securityAlert
  || record.kind === KIND.legalAlert
  || record.kind === KIND.benchAlert
  || record.kind === KIND.runAlert
  || record.kind === KIND.turnRefused;

/** Pure — a compact relative time. Absolute below the minute is noise. */
const agoLabel = (ts, nowMs) => {
  const delta = Math.max(0, nowMs - ts);
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/**
 * One card. Exported because this is where untrusted text reaches the DOM —
 * a title and a being name have crossed a socket — so it is the unit the
 * escape test must render directly. The tray around it only decides WHEN a card
 * is shown, which is a click and an effect, and belongs to the e2e lane.
 */
export const NotificationCard = ({ record, nowMs, onActivate, onDismiss, compact = false }) => {
  const target = notificationTarget(record);
  const actionable = Boolean(target);
  const classes = [
    'ntray-card',
    record.read ? 'is-read' : 'is-unread',
    isAlert(record) ? 'is-alert' : '',
    record.standing === STANDING.witness ? 'is-witness' : '',
    compact ? 'is-toast' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className="ntray-card-head">
        <span className="ntray-card-kind">{kindLabel(record.kind)}</span>
        {/* The neuma / witness split is structural, not decorative: a sealed
            third-party model standing beside the house must never render as a
            housemate's work. */}
        {record.standing === STANDING.witness ? (
          <span className="ntray-card-standing">WITNESS</span>
        ) : null}
        <span className="ntray-card-ago">{agoLabel(record.ts, nowMs)}</span>
        <button
          type="button"
          className="ntray-card-dismiss"
          onClick={(event) => { event.stopPropagation(); onDismiss(record); }}
          aria-label="Dismiss notification"
        >
          <CloseGlyph />
        </button>
      </div>

      {record.actor?.name ? (
        <div className="ntray-card-actor">{record.actor.name}</div>
      ) : null}

      <button
        type="button"
        className="ntray-card-body"
        onClick={() => onActivate(record)}
        disabled={!actionable}
      >
        <span className="ntray-card-title">{record.title}</span>
        {record.detail ? <span className="ntray-card-detail">{record.detail}</span> : null}
      </button>

      {actionable ? (
        <div className="ntray-card-target">OPEN {target.appId.toUpperCase()}</div>
      ) : null}
    </div>
  );
};

const NotificationTrayView = () => {
  const notifications = useNotifications();
  const windows = useWindows();
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const seenRef = useRef(new Set());

  const records = notifications?.records ?? [];
  const unread = notifications?.unread ?? 0;

  // Relative times go stale silently, which is worse than showing nothing —
  // "just now" on a card from an hour ago is a lie the operator cannot see.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // The tray is the only component that lives INSIDE the window manager and
  // also holds the notifications context, so it is where […] reaches suppression. Written to a ref, never to state: this changes
  // on every window focus and must not re-render the tray.
  const focusedId = windows?.state?.focusedId ?? null;
  useEffect(() => {
    notifications?.setFrontmostApp?.(focusedId ? appIdOf(focusedId) : null);
  }, [notifications, focusedId]);

  // A record the tray has not shown before rises as a toast. Driven off state
  // rather than off the socket so a card can only ever toast once, however many
  // times a reconnect re-delivers it.
  useEffect(() => {
    const fresh = records.filter((rec) => !rec.read && !seenRef.current.has(rec.id));
    if (fresh.length === 0) return undefined;
    for (const rec of fresh) seenRef.current.add(rec.id);
    setToasts((prev) => [...fresh, ...prev].slice(0, 3));
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => !fresh.some((f) => f.id === t.id)));
    }, TOAST_MS);
    return () => clearTimeout(timer);
  }, [records]);

  const activate = useCallback((record) => {
    notifications?.markRead?.(record.id);
    setToasts((prev) => prev.filter((t) => t.id !== record.id));

    if (record.kind === KIND.codeReload) {
      // The card's click IS its action. Hands off to the session-restore lane,
      // which puts the operator back where they were without auto-resuming a
      // turn or spending GPU budget.
      window.location.reload();
      return;
    }

    const target = notificationTarget(record);
    if (!target) return;
    // An app id, never a window id: `open` raises an existing instance and
    // creates one otherwise, so a card outliving its window still lands; a
    // sitting lands in its own stream window (cardOpenActions).
    for (const action of cardOpenActions(record, windows?.state?.windows)) windows?.dispatch?.(action);
    // The HOUSE CLOCK opens on the tab the card is about (house-clock-focus.js).
    if (target.appId === 'houseclock' && target.payload?.tab) requestHouseClockTab(target.payload.tab);
    // Every other app lands on the card's own item (card-landing.js).
    const landing = cardLanding(record);
    if (landing) requestCardLanding(landing.appId, landing.item);
    setOpen(false);
  }, [notifications, windows]);

  // The operator clicked the OS notification. Main has already raised and
  // focused the desk; this replays that card's own click, so it lands where the
  // card does. A card the desk no longer holds still opens its app.
  // Feature-probed rather than gated on isElectron, because a partial bridge is
  // a real state and the browser lane simply has no OS leg. Read through refs
  // so the subscription is made once: the returned closure is the unsubscribe,
  // and without detaching a remount would open two windows per click.
  const latest = useRef({ activate, records, dispatch: windows?.dispatch });
  latest.current = { activate, records, dispatch: windows?.dispatch };
  useEffect(() => {
    const onActivate = (payload) => {
      const now = latest.current;
      const record = payload?.id ? now.records.find((rec) => rec.id === payload.id) : null;
      if (record) now.activate(record);
      else if (payload?.appId) now.dispatch?.({ type: 'OPEN', id: payload.appId });
    };
    return window.neuma?.notifications?.onActivate?.(onActivate);
  }, []);

  const dismiss = useCallback((record) => {
    notifications?.markRead?.(record.id);
    setToasts((prev) => prev.filter((t) => t.id !== record.id));
  }, [notifications]);

  // Nothing to say and nothing said yet — stay out of the way entirely.
  if (!notifications) return null;

  return (
    <div className="ntray">
      <div className="ntray-toasts" role="status" aria-live="polite">
        {toasts.map((record) => (
          <NotificationCard
            key={`toast-${record.id}`}
            record={record}
            nowMs={nowMs}
            onActivate={activate}
            onDismiss={dismiss}
            compact
          />
        ))}
      </div>

      {open ? (
        <div className="ntray-panel">
          <div className="ntray-panel-head">
            <span className="ntray-panel-title">NOTIFICATIONS</span>
            <button
              type="button"
              className="ntray-panel-action"
              onClick={() => notifications.markAllRead()}
              disabled={unread === 0}
            >
              MARK ALL READ
            </button>
            <button
              type="button"
              className="ntray-panel-action"
              onClick={() => notifications.clear()}
              disabled={records.length === 0}
            >
              CLEAR
            </button>
          </div>
          <div className="ntray-panel-list">
            {records.length === 0 ? (
              <div className="ntray-empty">
                {notifications.hydrated ? 'Nothing has happened yet.' : 'Reading the record...'}
              </div>
            ) : records.map((record) => (
              <NotificationCard
                key={record.id}
                record={record}
                nowMs={nowMs}
                onActivate={activate}
                onDismiss={dismiss}
              />
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={`ntray-bell ${unread > 0 ? 'has-unread' : ''}`}
        onClick={() => setOpen((was) => !was)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <BellGlyph />
        {unread > 0 ? <span className="ntray-bell-count">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
    </div>
  );
};

// Behind a memo boundary: the desk host re-renders every streamed frame
// (2026-09-28 smoothness pass); this re-renders only when its own inputs do.
export const NotificationTray = memo(NotificationTrayView);
