// TabPortalHost — parallel STREAMING for the sittings strip (#407, the first
// slice of #408).
//
// Design note, 2026-08-28: […]
//
// The backend's law is ONE SESSION PER CONNECTION, and the tear-out stream
// windows already proved the consequence: a second LIVE sitting is a second
// socket (StreamWindowHost). This host brings that same shape to the strip —
// each tab past the first owns a portal of its own, mounted for the tab's
// whole life, so a tab switch changes WHICH sitting the window frame shows
// and rebinds nothing. Nothing is interrupted because nothing is touched.
//
// ── THE ANCHOR TAB ──────────────────────────────────────────────────────────
// One tab rides the window's own portal — the desk's (or a stream window's
// own). Arrival and the ceremony handoff stream there, and its provider owns
// the HOUSE broadcast duties, so it must keep exactly one sitting on it. A
// focused tab that has never been portal-activated ADOPTS a free anchor with
// the old focus semantics (seat, then resume or mint) — run once, which is
// also what keeps the restart law: a restored strip binds only the tab the
// operator is looking at.
//
// ── ACTIVATION IS LAZY ──────────────────────────────────────────────────────
// A portal tab connects on its FIRST focus, not on mount — a restored
// background tab costs nothing until looked at ([…], Design note, 2026-07-30. Once activated it stays live in the
// background: tokens keep landing, and the strip wears its mid-turn mark.
//
// Voice is deliberately NOT interrupted on a tab switch — the interrupt lives
// in switchCompanion, which is a real change of being. Parallel sittings may
// speak in parallel; VOX is per-being where that is unwanted.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebSocketService } from '../../services/WebSocketService.js';
import { useConsciousnessStream } from './use-consciousness-stream.js';
import { useConsciousness, ConsciousnessProvider } from './consciousness-context.js';
import { CompositionContext, useCompositionEvent } from './composition-context.js';
import { useContextComposition } from './use-context-composition.js';
import { useTabs } from './tabs-context.js';
import { useProjects } from './projects/project-context.js';
import { sittingGround } from './desk-focus.js';
import { focusPlan, focusedComposition } from '../../../core/runtime/tabs-model.js';
import { TabActivityContext } from './tab-activity.js';
import { memberFor } from './StreamTabs.jsx';

/** Pure — is this sitting mid-turn? The strip's live mark reads this. */
const isBusy = (state) => Boolean(state?.thinking || state?.messages?.some((m) => m.streaming));

/**
 * One tab's own portal: its socket, its stream state, its voice — alive for
 * as long as the tab is, whether or not it is the one on screen. Renders
 * nothing: it LIFTS its live value to the host, which wraps the window frame
 * in whichever tab's value is focused — the frame itself never remounts on a
 * tab switch, it only reads a different sitting.
 */
const TabPortal = ({ tab, onActivity, onSession, onValue, onComposition }) => {
  // quiet: a tab's portal is background plumbing — it must never flash
  // "Portal established" (or any link status) across the desk's global badge
  // on a mere tab switch (Design note, 2026-08-28.
  const [wsService] = useState(() => new WebSocketService({ quiet: true }));
  const projects = useProjects();

  const consciousness = useConsciousnessStream(wsService, {
    // Background sittings retain their own folder; missing assignments stay null.
    focus: sittingGround(tab?.focus),
    projects: projects?.projects ?? null,
    onProjectChatCreated: projects?.refresh ?? null,
    house: false, // the window's own portal answers for the machine
  });

  useEffect(() => {
    wsService.connect();
    // Closing the tab closes its portal — the server aborts anything still in
    // flight on it, which is what closing a sitting means.
    return () => { try { wsService.disconnect(); } catch { /* already gone */ } };
  }, [wsService]);

  // Seat once: this portal holds ONE tab's being for its whole life. The same
  // arrival the tear-out window performs (StreamWindowHost) — the resume names
  // the exact sitting and wins over the switch's latest-thread load.
  const seated = useRef(false);
  const { switchCompanion, resumeSession } = consciousness;
  useEffect(() => {
    if (seated.current || !tab?.neumaId) return;
    seated.current = true;
    Promise.resolve(switchCompanion(memberFor(tab)))
      .catch((err) => console.warn('[tab-portal] could not seat this tab\'s being', err));
    if (tab.sessionId) {
      resumeSession({ neumaId: tab.neumaId, companionName: tab.name, sessionId: tab.sessionId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.neumaId]);

  // A session minted in the BACKGROUND still belongs to this tab — the strip's
  // own sync only watches the focused provider, so each portal reports its
  // own binding (a torn-out or restored tab must not lose a background mint).
  useEffect(() => {
    const sync = () => {
      const live = wsService.getSessionState?.();
      if (!live?.sessionId || live.neumaId !== tab.neumaId) return;
      if (live.sessionId !== tab.sessionId) onSession(tab.id, live.sessionId);
    };
    wsService.on('session:state', sync);
    wsService.on('consciousness:complete', sync);
    return () => { wsService.off('session:state', sync); wsService.off('consciousness:complete', sync); };
  }, [wsService, tab.id, tab.neumaId, tab.sessionId, onSession]);

  // The strip's live mark: report this sitting's mid-turn state up, and
  // withdraw the report when the tab closes.
  const busy = isBusy(consciousness.state);
  useEffect(() => {
    onActivity(tab.id, busy);
    return () => onActivity(tab.id, null);
  }, [tab.id, busy, onActivity]);

  // Lift the live value on every change — the hook mints a fresh object per
  // render, so this fires exactly when a consumer would need to re-read.
  useEffect(() => {
    onValue(tab.id, consciousness);
    return () => onValue(tab.id, null);
  }, [tab.id, consciousness, onValue]);

  // THIS SITTING'S OWN CONTEXT ANATOMY, on THIS sitting's socket.
  //
  // Design note, 2026-08-30: […]
  // The gauge used to be subscribed once, at desk level, and provided to every
  // pane at once — so four open sittings all read the anchor tab's numbers.
  // Not stale numbers: ANOTHER CHAT'S numbers, which is worse, because a gauge
  // that is merely behind still describes the thing you are looking at.
  //
  // The subscription belongs where the socket is. Each portal has its own
  // WebSocketService, and the hook already scopes to that socket's session, so
  // asking it here is the whole fix — the numbers cannot come from a
  // conversation this pane is not holding.
  const composition = useContextComposition(wsService, tab.neumaId || null);
  useEffect(() => {
    onComposition(tab.id, composition);
    return () => onComposition(tab.id, null);
  }, [tab.id, composition, onComposition]);

  return null;
};

/**
 * The window-frame wrapper: decides which portal each tab lives on, keeps
 * every activated portal mounted, and wraps `children` (the WHOLE frame —
 * title, controls, body) in the FOCUSED tab's provider.
 */
export const TabPortalHost = ({ children }) => {
  const tabs = useTabs();
  const anchor = useConsciousness();
  // The anchor tab rides this WINDOW's portal, not one of its own, so its
  // anatomy is whatever the enclosing host already provides — the desk's, or
  // this stream window's. Exactly the fallback `anchor` is for the value.
  const anchorComposition = useCompositionEvent();
  // Which tab rides this window's own portal. Owned by the tabs hook
  // (session-only there) so the DESK can read the anchor's ground when it
  // builds the window's own stream — the fix for the anchor riding the bare
  // window lens. The house tab designation can migrate on close, but a
  // sitting must never silently change sockets under a conversation.
  const anchorTabId = tabs?.anchorTabId ?? null;
  const setAnchorTabId = tabs?.setAnchorTab ?? (() => {});
  // Portal tabs activated by a first focus — Set identity changes on growth
  // only, so render math stays cheap.
  const [activated, setActivated] = useState(() => new Set());
  const [busyByTab, setBusyByTab] = useState({});
  // Each activated portal's live value, lifted per change — the focused one
  // wraps the window frame below.
  const [valueByTab, setValueByTab] = useState({});
  // …and each one's context anatomy, lifted the same way and for the same
  // reason: the frame must read the FOCUSED sitting's numbers, never a
  // sibling's.
  const [compositionByTab, setCompositionByTab] = useState({});
  const adoptedRef = useRef(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const withdrawOrSet = (m, id, v) => {
    if (v === null) {
      if (!(id in m)) return m;
      const { [id]: _gone, ...rest } = m;
      return rest;
    }
    return m[id] === v ? m : { ...m, [id]: v };
  };

  const onActivity = useCallback((id, busy) => {
    setBusyByTab((m) => withdrawOrSet(m, id, busy));
  }, []);

  const onValue = useCallback((id, value) => {
    setValueByTab((m) => withdrawOrSet(m, id, value));
  }, []);

  const onComposition = useCallback((id, composition) => {
    setCompositionByTab((m) => withdrawOrSet(m, id, composition));
  }, []);

  const onSession = useCallback((id, sessionId) => {
    tabsRef.current?.bind?.(id, sessionId);
  }, []);

  const list = tabs?.tabs ?? [];
  const focusedId = tabs?.focusedId ?? null;

  // A closed tab releases its claim: the anchor frees, and activated ids of
  // gone tabs are pruned so a later tab with a recycled focus can't inherit.
  useEffect(() => {
    if (anchorTabId && !list.some((t) => t.id === anchorTabId)) setAnchorTabId(null);
    setActivated((prev) => {
      const next = new Set([...prev].filter((id) => list.some((t) => t.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [list, anchorTabId]);

  // WHAT THIS WINDOW HAS CONNECTED — the anchor and every activated portal.
  const liveIds = useMemo(
    () => list.filter((t) => t.id === anchorTabId || activated.has(t.id)).map((t) => t.id),
    [list, anchorTabId, activated],
  );

  // FOCUS decides where a homeless tab lives: a free anchor adopts it (the
  // old focus semantics, exactly once); otherwise it activates its own portal.
  // A tab that already has a home — anchor or portal — is left untouched,
  // which IS the fix: focusing it shows its standing state and sends nothing.
  //
  // NO ACTIVATION GATE (Design note, 2026-10-15: […]). A
  // focused tab always connects its portal — a view of its sitting, its stream,
  // its flow. Generation is what the rig runs out of, and every turn waits its
  // place in the house's line at the measured width (substrate-lease.js).
  //
  useEffect(() => {
    if (!focusedId) return;
    const t = list.find((x) => x.id === focusedId);
    if (!t) return;
    if (focusedId === anchorTabId || activated.has(focusedId)) return;
    if (anchorTabId !== null) {
      setActivated((prev) => new Set(prev).add(focusedId));
      return;
    }
    setAnchorTabId(focusedId);
    if (adoptedRef.current === focusedId) return;
    adoptedRef.current = focusedId;
    const plan = focusPlan(t, anchor.activeCompanion?.neumaId ?? null);
    const live = anchor.wsService?.getSessionState?.() ?? null;
    if (plan.seat) {
      Promise.resolve(anchor.switchCompanion(memberFor(t)))
        .catch((err) => console.warn('[tab-portal] could not seat the adopted tab\'s being', err));
    }
    if (plan.resume) {
      // The seed tab arrives already bound to the sitting on screen — adopting
      // it must never look like a switch (re-resuming would clear the stream).
      if (plan.resume !== live?.sessionId) {
        anchor.resumeSession({ neumaId: t.neumaId, companionName: t.name, sessionId: plan.resume });
      }
    } else if (plan.mint && !plan.seat && live?.sessionId) {
      anchor.newSession();
    }
  }, [focusedId, list, anchorTabId, activated, anchor]);

  const portalTabs = list.filter((t) => t.id !== anchorTabId && activated.has(t.id));
  const anchorBusy = isBusy(anchor.state);

  const activity = useMemo(() => ({
    byTab: { ...busyByTab, ...(anchorTabId ? { [anchorTabId]: anchorBusy } : {}) },
    anchorTabId,
    liveIds,
  }), [busyByTab, anchorTabId, anchorBusy, liveIds]);

  // No strip on this surface → the window's own portal stands alone, as ever.
  if (!tabs) return children;

  // The frame reads the FOCUSED sitting: a portal tab's lifted value, or the
  // window's own portal for the anchor (and for a portal's first commit,
  // before its value lands). ONE stable provider position — a tab switch
  // swaps the value, so the frame re-reads and never remounts.
  const focusedValue = (focusedId && valueByTab[focusedId]) || anchor;
  // Whose numbers the frame shows — see `focusedComposition` for why a tab
  // that reported null keeps its null instead of borrowing the anchor's.
  const shownComposition = focusedComposition(focusedId, compositionByTab, anchorComposition);

  return (
    <TabActivityContext.Provider value={activity}>
      {portalTabs.map((t) => (
        <TabPortal
          key={t.id}
          tab={t}
          onActivity={onActivity}
          onSession={onSession}
          onValue={onValue}
          onComposition={onComposition}
        />
      ))}
      <ConsciousnessProvider value={focusedValue}>
        <CompositionContext.Provider value={shownComposition}>
          {children}
        </CompositionContext.Provider>
      </ConsciousnessProvider>
    </TabActivityContext.Provider>
  );
};
